import { addDays, dayKey, dayStart, nextResetAt } from '../../shared/format';
import { BoardMeta, CoinSummary, LossEntry, PulseResponse, Range, Records, WinEntry } from '../../shared/types';
import { Chain } from './chain';
import { Rules, blockedMints, getEnv } from './env';
import { selectVerified } from './funding';
import { CoinResult, lossBetter, mergeDay, sortLosers, sortWinners, winBetter, winKey } from './scoring';
import { Store } from './store';

export const TTL_DAY = 60 * 60 * 24 * 21;

export const K = {
  coins: (d: string) => `day:${d}:coins`,
  idx: (d: string) => `day:${d}:idx`,
  dirty: (d: string) => `day:${d}:dirty`,
  board: (d: string) => `day:${d}:board`,
  win: (d: string) => `day:${d}:win`,
  loss: (d: string) => `day:${d}:loss`,
  zwin: (d: string) => `day:${d}:zwin`,
  zloss: (d: string) => `day:${d}:zloss`,
  coin: (m: string) => `coin:${m}`,
  /** all-wallet per-coin ledgers live separately so packed coin state pruning cannot hide random wallets */
  walletCoin: (m: string) => `coinwallets:${m}`,
  res: (m: string) => `res:${m}`,
  snap: (r: Range) => `snap:${r}`,
  coinsum: (d: string) => `day:${d}:coinsum`,
  chart: (m: string) => `chart:${m}`,
  hof: 'hof',
  pulse: 'snap:pulse',
};

export interface DayBoard {
  day: string;
  final: boolean;
  updatedAt: number;
  solUsd: number;
  coins: number;
  winners: WinEntry[];
  losers: LossEntry[];
  verify?: { checked: number; rejectedDev: number; rejectedCluster: number; errors: number };
}

export interface Snapshot {
  meta: BoardMeta;
  winners: WinEntry[];
  losers: LossEntry[];
}

const TABLE_SIZE = () => Number(getEnv('TABLE_SIZE') || 2000);

export async function getSolUsd(store: Store, chain: Chain, now: number): Promise<number> {
  const raw = await store.get('solusd');
  let cached: { p: number; t: number } | null = null;
  try {
    cached = raw ? JSON.parse(raw) : null;
  } catch {
    cached = null;
  }
  if (cached && now - cached.t < 120) return cached.p;
  try {
    const p = await chain.solUsd();
    await store.set('solusd', JSON.stringify({ p, t: now }), 86400 * 3);
    return p;
  } catch (e) {
    if (cached) return cached.p;
    throw e;
  }
}

/**
 * Coins displayed as tracked are those that have actually accrued the configured
 * Pump global/protocol fee amount. Other quality gates apply to leaderboard entries,
 * not whether a coin appears in the tracked-coins count/list.
 */
export function trackedCoinResults(
  results: CoinResult[],
  r: Rules,
  blocked: Set<string> = blockedMints()
): CoinResult[] {
  return results.filter((c) => !c.jk && !blocked.has(c.mint) && (c.gf ?? 0) >= r.minGlobalFeesSol);
}

export async function rebuildDay(
  store: Store,
  chain: Chain,
  r: Rules,
  day: string,
  results: CoinResult[],
  solUsd: number,
  now: number
): Promise<DayBoard> {
  const blocked = blockedMints();
  const trackedResults = trackedCoinResults(results, r, blocked);
  results = results.filter((c) => !c.jk && !blocked.has(c.mint));
  const { winners, losers } = mergeDay(results, solUsd, r.maxPerCoin);
  const dev = new Map(results.map((c) => [c.mint, c.dev]));
  const ctx = {
    chain,
    store,
    devOf: (m: string) => dev.get(m) ?? null,
    limit: r.boardSize,
    maxChecks: r.boardSize * 3,
  };
  // verify both lists side by side so losers are not starved while winners fill the cache
  const [vw, vl] = await Promise.all([selectVerified(winners, ctx), selectVerified(losers, ctx)]);
  const final = now >= dayStart(day) + 86400 && results.length > 0 && results.every((c) => c.fin);

  const board: DayBoard = {
    day,
    final,
    updatedAt: now,
    solUsd,
    coins: trackedResults.length,
    winners: vw.picked,
    losers: vl.picked,
    verify: {
      checked: vw.report.checked + vl.report.checked,
      rejectedDev: vw.report.rejectedDev + vl.report.rejectedDev,
      rejectedCluster: vw.report.rejectedCluster + vl.report.rejectedCluster,
      errors: vw.report.errors + vl.report.errors,
    },
  };

  await store.set(K.coinsum(day), JSON.stringify(coinSummaries(trackedResults, solUsd, board)), TTL_DAY);

  // wallet lookup tables: raw ranking, plus r = verified board rank (0 when not on the board)
  const onW = new Map(board.winners.map((x, i) => [x.wallet, i + 1]));
  const onL = new Map(board.losers.map((x, i) => [x.wallet, i + 1]));
  const tw = winners.slice(0, TABLE_SIZE());
  const tl = losers.slice(0, TABLE_SIZE());
  await store.replaceHash(
    K.win(day),
    Object.fromEntries(tw.map((e) => [e.wallet, JSON.stringify({ ...e, r: onW.get(e.wallet) ?? 0 })])),
    TTL_DAY
  );
  await store.replaceHash(
    K.loss(day),
    Object.fromEntries(tl.map((e) => [e.wallet, JSON.stringify({ ...e, r: onL.get(e.wallet) ?? 0 })])),
    TTL_DAY
  );
  await store.replaceZset(K.zwin(day), tw.map((e) => ({ score: winKey(e), member: e.wallet })), TTL_DAY);
  await store.replaceZset(K.zloss(day), tl.map((e) => ({ score: e.lossSol, member: e.wallet })), TTL_DAY);
  await store.set(K.board(day), JSON.stringify(board), TTL_DAY);
  if (board.final) await updateHof(store, board, now);
  return board;
}

export async function readDayBoard(store: Store, day: string): Promise<DayBoard | null> {
  const raw = await store.get(K.board(day));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DayBoard;
  } catch {
    return null;
  }
}

export function snapshotFromBoards(boards: DayBoard[], now: number, size: number): Snapshot {
  const w = new Map<string, WinEntry>();
  const l = new Map<string, LossEntry>();
  for (const b of boards) {
    for (const x of b.winners) {
      const c = w.get(x.wallet);
      if (!c || winBetter(x, c)) w.set(x.wallet, x);
    }
    for (const x of b.losers) {
      const c = l.get(x.wallet);
      if (!c || lossBetter(x, c)) l.set(x.wallet, x);
    }
  }
  const newest = boards.reduce((a, b) => Math.max(a, b.updatedAt), 0);
  return {
    meta: {
      updatedAt: newest,
      solUsd: boards[0]?.solUsd ?? 0,
      resetAt: nextResetAt(now),
      days: boards.map((b) => b.day),
      coins: boards.reduce((a, b) => a + b.coins, 0),
      final: boards.length > 0 && boards.every((b) => b.final),
    },
    winners: sortWinners([...w.values()]).slice(0, size),
    losers: sortLosers([...l.values()]).slice(0, size),
  };
}

/** Rewrites the three cached snapshots the public API serves. */
export async function writeSnapshots(store: Store, r: Rules, now: number): Promise<void> {
  const today = dayKey(now);
  const yest = addDays(today, -1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const boards = new Map<string, DayBoard>();
  for (const d of days) {
    const b = await readDayBoard(store, d);
    if (b) boards.set(d, b);
  }
  const pick = (ds: string[]) => ds.map((d) => boards.get(d)).filter(Boolean) as DayBoard[];
  const snaps: [Range, Snapshot][] = [
    ['today', snapshotFromBoards(pick([today]), now, r.boardSize)],
    ['yesterday', snapshotFromBoards(pick([yest]), now, r.boardSize)],
    ['week', snapshotFromBoards(pick(days), now, r.boardSize)],
  ];
  for (const [range, s] of snaps) await store.set(K.snap(range), JSON.stringify(s), 60 * 60 * 24 * 3);

  // pulse: recent coins for the ticker, coins page and records
  const coins: CoinSummary[] = [];
  for (const d of days) {
    const raw = await store.get(K.coinsum(d));
    if (!raw) continue;
    try {
      coins.push(...(JSON.parse(raw) as CoinSummary[]));
    } catch {
      /* skip corrupt */
    }
  }
  coins.sort((a, b) => b.mig - a.mig);
  const any = [...boards.values()][0];
  const pulse: Omit<PulseResponse, 'ok' | 'records'> = {
    updatedAt: [...boards.values()].reduce((a, b) => Math.max(a, b.updatedAt), 0),
    solUsd: any?.solUsd ?? 0,
    coins: coins.slice(0, 150),
  };
  await store.set(K.pulse, JSON.stringify(pulse), 60 * 60 * 24 * 3);
}

/** Prefers entries that passed verification (they are on the day board), falls back to the raw leader. */
export function coinSummaries(results: CoinResult[], solUsd: number, board?: Pick<DayBoard, 'winners' | 'losers'>): CoinSummary[] {
  return results.map((c) => {
    const vw = board?.winners.find((x) => x.mint === c.mint);
    const vl = board?.losers.find((x) => x.mint === c.mint);
    return {
      mint: c.mint,
      symbol: c.symbol,
      day: c.day,
      mig: c.mig ?? 0,
      peakMcUsd: (c.pk ?? 0) * solUsd,
      trades: c.tr ?? 0,
      wCount: c.w.length,
      topMult: vw ? vw.mult : c.w[0]?.mult ?? 0,
      topEntryMcUsd: vw ? vw.entryMcUsd : (c.w[0]?.entryMc ?? 0) * solUsd,
      lCount: c.l.length,
      topLossSol: vl ? vl.lossSol : c.l[0]?.lossSol ?? 0,
      verified: !!vw,
      spark: c.sp ?? [],
    };
  });
}

/** All time records. Only final boards feed it, so entries cannot be removed afterwards by later checks. */
export async function updateHof(store: Store, board: DayBoard, now: number): Promise<void> {
  let h: Records = { updatedAt: 0, win: [], loss: [] };
  try {
    const raw = await store.get(K.hof);
    if (raw) h = JSON.parse(raw) as Records;
  } catch {
    /* start fresh */
  }
  const key = (e: { wallet: string; mint: string; day: string }) => `${e.wallet}|${e.mint}|${e.day}`;
  const win = new Map(h.win.map((e) => [key(e), e]));
  const loss = new Map(h.loss.map((e) => [key(e), e]));
  for (const e of board.winners.slice(0, 25)) win.set(key(e), e);
  for (const e of board.losers.slice(0, 25)) loss.set(key(e), e);
  h.win = sortWinners([...win.values()]).slice(0, 25);
  h.loss = [...loss.values()].sort((a, b) => b.lossSol - a.lossSol).slice(0, 25);
  h.updatedAt = now;
  await store.set(K.hof, JSON.stringify(h));
}