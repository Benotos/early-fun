import { addDays, dayKey, dayStart } from '../../shared/format';
import { Chain, txKeys } from './chain';
import { CoinState, WalletCoinLedger, applyTrades, applyWalletLedgerTrades, newCoin, packState, rawBars, unpackState } from './coin';
import { Rules, TOTAL_SUPPLY, num, rules } from './env';
import { DayBoard, K, TTL_DAY, getSolUsd, readDayBoard, rebuildDay, writeSnapshots } from './boards';
import { curveAddress } from './pda';
import { CoinResult, computeResult, junkReasons, packResult, unpackResult } from './scoring';
import { Store } from './store';
import { Trade, describeTx, extractTrade, parseMigration, txFeesSol } from './trades';

export interface ScanReport {
  ok: boolean;
  status: 'ok' | 'aborted' | 'locked' | 'error';
  reason?: string;
  at: number;
  newCoins: number;
  coinsScanned: number;
  changed: number;
  pages: number;
  boardsBuilt: string[];
  errors: string[];
  elapsedMs: number;
}

export interface ScanOpts {
  store: Store;
  chain: Chain;
  budgetMs: number;
  now?: number;
  /** bypass the rebuild throttle (tests, manual runs) */
  forceRebuild?: boolean;
}

const COIN_TTL = 60 * 60 * 24 * 12;
const REBUILD_EVERY_SEC = 600;
const MAX_B64 = 600_000;

export async function loadCoin(store: Store, mint: string): Promise<CoinState | null> {
  const raw = await store.get(K.coin(mint));
  if (!raw) return null;
  try {
    return unpackState(raw);
  } catch {
    return null;
  }
}

export async function saveCoin(store: Store, s: CoinState): Promise<void> {
  let packed = packState(s);
  // keep requests under the Upstash size limit by dropping dust wallets first
  if (packed.length > MAX_B64) {
    s.capped = true;
    const entries = Object.entries(s.pnl).sort((a, b) => b[1].bs - a[1].bs);
    for (const keep of [4000, 2500, 1500, 800]) {
      const keepSet = new Set(entries.slice(0, keep).map((e) => e[0]));
      for (const w of Object.keys(s.pnl)) if (!keepSet.has(w)) delete s.pnl[w];
      for (const w of Object.keys(s.buys)) if (!keepSet.has(w)) delete s.buys[w];
      packed = packState(s);
      if (packed.length <= MAX_B64) break;
    }
  }
  await store.set(K.coin(s.mint), packed, COIN_TTL);
}

const RULES_VERSION = 9;
const SCORING_VERSION = 12;
const WALLET_LEDGER_VERSION = 2;

/** seconds between re-reads of a coin, by how long ago it migrated */
function rescanEvery(ageSec: number): number {
  if (process.env.RESCAN_BACKOFF === '0') return 0;
  if (ageSec < 2 * 3600) return 0;
  if (ageSec < 6 * 3600) return 300;
  if (ageSec < 12 * 3600) return 900;
  return 1800;
}

/** Reset only derived trade state so legacy coins can be replayed with matched-token accounting. */
function resetTradeAccounting(s: CoinState): void {
  s.stair = [];
  s.buys = {};
  s.pnl = {};
  s.curveTok = null;
  s.curveSlot = 0;
  s.curveSeen = 0;
  s.curveDone = false;
  s.poolTok = null;
  s.poolSlot = 0;
  s.poolSeen = 0;
  s.poolDone = !s.pool;
  s.trades = 0;
  s.cpk = undefined;
  s.gf = 0;
  s.dev = null;
  s.createSlot = 0;
  s.createTime = 0;
  s.ser = [];
  s.sres = 1;
  s.capped = false;
  s.final = false;
  s.lastScan = 0;
  s.rebuildPending = true;
  s.replayAccounting = true;
}

function emptyWalletCoinLedger(): WalletCoinLedger {
  return {
    pnl: {
      bs: 0, ss: 0, bt: 0, st: 0, fb: 0, lb: 0, ls: 0,
      inventoryTokens: 0, inventoryCostSol: 0,
      matchedSoldTokens: 0, matchedSoldCostSol: 0, matchedSoldProceedsSol: 0,
    },
    buys: [],
  };
}

async function persistWalletLedgers(store: Store, s: CoinState, trades: Trade[], r: Rules): Promise<void> {
  const byWallet = new Map<string, Trade[]>();
  for (const t of trades) {
    if (t.wallet === s.dev) continue;
    const items = byWallet.get(t.wallet) || [];
    items.push(t);
    byWallet.set(t.wallet, items);
  }
  if (!byWallet.size) return;

  const wallets = [...byWallet.keys()];
  const key = K.walletCoin(s.mint);
  const previous = await store.run(wallets.map((wallet) => ['HGET', key, wallet]));
  const fields: (string | number)[] = [];
  wallets.forEach((wallet, i) => {
    let ledger = emptyWalletCoinLedger();
    if (typeof previous[i] === 'string') {
      try {
        const parsed = JSON.parse(previous[i] as string) as WalletCoinLedger;
        if (parsed?.pnl && Array.isArray(parsed.buys)) ledger = parsed;
      } catch {
        // A bad field must not interrupt scanning other wallets.
      }
    }
    applyWalletLedgerTrades(s, ledger, byWallet.get(wallet) || [], r);
    fields.push(wallet, JSON.stringify(ledger));
  });
  await store.run([
    ['HSET', key, ...fields],
    ['EXPIRE', key, COIN_TTL],
  ]);
}

/** coins that failed a check that can never change */
function deadForGood(s: CoinState, r: Rules): boolean {
  if (!s.curveDone) return false;
  if (s.mh && r.hideMayhem) return true;
  return junkReasons(s, r).some((x) => x.startsWith('bonding curve only reached'));
}

async function scanCoin(
  store: Store,
  chain: Chain,
  s: CoinState,
  r: Rules,
  now: number,
  deadline: number
): Promise<{ changed: boolean; pages: number }> {
  let pages = 0;
  let changed = false;

  // bonding curve venue
  while (!s.curveDone && pages < r.maxPagesPerCoin && Date.now() < deadline) {
    const start = s.curveSlot === 0 && !s.curveTok;
    const page = await chain.txsForAddress(s.curve, { sort: 'asc', token: s.curveTok, slotGt: s.curveSlot });
    pages++;
    if (start && s.dev === null && page.txs.length) {
      const t0 = page.txs[0];
      s.dev = txKeys(t0)[0];
      s.createSlot = t0.slot;
      s.createTime = t0.blockTime ?? 0;
    }
    const trades: Trade[] = [];
    for (const tx of page.txs) {
      const t = extractTrade(tx, { kind: 'curve', address: s.curve, mint: s.mint });
      if (!t) continue;
      trades.push(t);
      if (t.time < s.dayEnd) s.gf = (s.gf || 0) + txFeesSol(tx);
    }
    applyTrades(s, trades, r);
    await persistWalletLedgers(store, s, trades, r);
    for (const t of trades) if (t.time < s.dayEnd) s.cpk = Math.max(s.cpk || 0, t.price);
    if (page.txs.length) {
      changed = true;
      s.curveSeen = Math.max(s.curveSeen, page.txs[page.txs.length - 1].slot);
    }
    s.curveTok = page.next;
    if (!page.next) {
      s.curveSlot = Math.max(s.curveSlot, s.curveSeen);
      // nothing trades on the curve after migration
      if (now > s.migTime + 120) s.curveDone = true;
      break;
    }
  }

  // AMM pool venue (after migration)
  if (s.pool) {
    while (!s.poolDone && pages < r.maxPagesPerCoin && Date.now() < deadline) {
      const page = await chain.txsForAddress(s.pool, {
        sort: 'asc',
        token: s.poolTok,
        slotGt: s.poolSlot,
        blockTimeLt: s.dayEnd,
      });
      pages++;
      const trades: Trade[] = [];
      for (const tx of page.txs) {
        const t = extractTrade(tx, { kind: 'amm', address: s.pool!, mint: s.mint });
        if (!t) continue;
        trades.push(t);
        if (t.time < s.dayEnd) s.gf = (s.gf || 0) + txFeesSol(tx);
      }
      applyTrades(s, trades, r);
      await persistWalletLedgers(store, s, trades, r);
      if (page.txs.length) {
        changed = true;
        s.poolSeen = Math.max(s.poolSeen, page.txs[page.txs.length - 1].slot);
      }
      s.poolTok = page.next;
      if (!page.next) {
        s.poolSlot = Math.max(s.poolSlot, s.poolSeen);
        if (now >= s.dayEnd + 60) s.poolDone = true;
        break;
      }
    }
  } else {
    s.poolDone = true;
  }

  const wasFinal = s.final;
  s.final = s.curveDone && s.poolDone && now >= s.dayEnd + 60;
  if (s.final && !wasFinal) changed = true;
  s.lastScan = now;
  return { changed, pages };
}

export async function runScan(o: ScanOpts): Promise<ScanReport> {
  const { store, chain } = o;
  const started = Date.now();
  const deadline = started + o.budgetMs;
  (chain as unknown as { setDeadline?: (t: number) => void }).setDeadline?.(started + o.budgetMs + 8000);
  const r = rules();
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const report: ScanReport = {
    ok: true,
    status: 'ok',
    at: now,
    newCoins: 0,
    coinsScanned: 0,
    changed: 0,
    pages: 0,
    boardsBuilt: [],
    errors: [],
    elapsedMs: 0,
  };

  // sanity check first: a wrong key must never be allowed to change state
  const probe = await chain.probe();
  if (!probe.ok) {
    report.ok = false;
    report.status = 'aborted';
    report.reason = 'rpc sanity check failed: ' + probe.detail;
    report.elapsedMs = Date.now() - started;
    await store.set('scan:last', JSON.stringify(report), 86400 * 3);
    return report;
  }

  const locked = await store.setnx('scan:lock', String(started), Math.ceil(o.budgetMs / 1000) + 30);
  if (!locked) {
    report.ok = true;
    report.status = 'locked';
    report.reason = 'another scan is running';
    return report;
  }

  try {
    const today = dayKey(now);
    // Wallet profiles expose the last seven days. When scan rules change, replay
    // saved coin histories across that same window so stale profit/loss records
    // are corrected consistently, not just for today and yesterday.
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));

    // 1. discover new migrations
    const cursor = await store.get('mig:cursor');
    // only discover migrations from the start of today (BACKFILL_DAYS=1 adds yesterday), so today fills first
    const back = Math.max(0, Math.min(1, num('BACKFILL_DAYS', 0)));
    const rows = await chain.listMigrations({ untilSig: cursor, minTime: dayStart(addDays(today, -back)), maxPages: 5 });
    for (const row of rows.slice().reverse()) {
      if (Date.now() > Math.min(deadline - 2000, started + Math.floor(o.budgetMs * 0.45))) break;
      try {
        const tx = await chain.getTx(row.signature);
        if (!tx) {
          report.errors.push('tx not available yet ' + row.signature.slice(0, 8));
          break; // keep order, retry next scan
        }
        const mig = parseMigration(tx);
        if (!mig) {
          report.errors.push('unparsed migration ' + row.signature + ' ' + describeTx(tx));
          await store.set('mig:cursor', row.signature);
          continue;
        }
        const curve = curveAddress(mig.mint);
        if (!txKeys(tx).includes(curve)) {
          report.errors.push('curve mismatch ' + mig.mint.slice(0, 8));
          await store.set('mig:cursor', row.signature);
          continue;
        }
        const time = row.blockTime ?? tx.blockTime ?? now;
        const day = dayKey(time);
        if (!(await store.get(K.coin(mig.mint)))) {
          const meta = await chain.tokenMeta(mig.mint);
          const s = newCoin({
            mint: mig.mint,
            curve,
            pool: mig.pool,
            migTime: time,
            migSig: row.signature,
            day,
            dayEnd: dayStart(day) + 86400,
            symbol: meta?.symbol,
            name: meta?.name,
          });
          await saveCoin(store, s);
          await store.run([
            ['SADD', K.coins(day), mig.mint],
            ['HSET', K.idx(day), mig.mint, '0'],
            ['EXPIRE', K.idx(day), TTL_DAY],
            ['EXPIRE', K.coins(day), TTL_DAY],
          ]);
          report.newCoins++;
        }
        await store.set('mig:cursor', row.signature);
      } catch (e) {
        report.errors.push('discover ' + (e instanceof Error ? e.message : String(e)));
        break;
      }
    }

    // boards that need a rebuild this run. A rebuild gets the whole remaining time budget,
    // so on those runs coin scanning is skipped instead of starving the rebuild.
    const due: string[] = [];
    for (const d of days) {
      const prev: DayBoard | null = await readDayBoard(store, d);
      const flag = await store.get(K.dirty(d));
      const stale = !prev || now - prev.updatedAt >= REBUILD_EVERY_SEC;
      // a failed or cut off rebuild must not block scanning: retry at most every 10 minutes
      const tried = Number(await store.get('rebuild:at:' + d)) || 0;
      const cool = now - tried >= REBUILD_EVERY_SEC;
      if (o.forceRebuild || (flag && cool && (d !== today || stale))) due.push(d);
    }
    const skipScan = due.length > 0 && !o.forceRebuild;

    // 2. scan active coins, least recently scanned first. A small index hash per day
    // means we never read every coin state just to pick the next ones.
    const queue: { mint: string; day: string; last: number }[] = [];
    for (const d of days) {
      const [hlen, scard] = await store.run([['HLEN', K.idx(d)], ['SCARD', K.coins(d)]]);
      if (Number(scard) > Number(hlen)) {
        const all = await store.smembers(K.coins(d));
        const have = await store.hgetall(K.idx(d));
        const add: (string | number)[] = [];
        for (const m of all) if (!(m in have)) add.push(m, '0');
        for (let i = 0; i < add.length; i += 200) await store.cmd('HSET', K.idx(d), ...add.slice(i, i + 200));
        await store.cmd('EXPIRE', K.idx(d), TTL_DAY);
      }
      const h = await store.hgetall(K.idx(d));
      for (const [m, v] of Object.entries(h)) {
        if (v === `f|${RULES_VERSION}|${SCORING_VERSION}`) continue;
        if (v === 'f' || v.startsWith('f|')) {
          const parts = v.split('|');
          const rulesVersion = v === 'f' ? 0 : Number(parts[1]) || 0;
          const scoringVersion = v === 'f' ? 0 : Number(parts[2]) || 0;
          if (rulesVersion === RULES_VERSION && scoringVersion === SCORING_VERSION) continue;
          // Requeue old final entries for a score-only rebuild, or a history replay
          // when the stored scan rules themselves are old.
          queue.push({ mint: m, day: d, last: 0 });
          continue;
        }
        const [lastS, migS, mode] = String(v).split('|');
        const last = Number(lastS) || 0;
        const mig = Number(migS) || 0;
        // Historical accounting replays must make steady progress independent of
        // the normal age based backoff used to save RPC credits on old coins.
        if (mode !== 'r' && last > 0 && mig > 0 && now - last < rescanEvery(now - mig)) continue;
        queue.push({ mint: m, day: d, last });
      }
    }
    // least recently scanned first across both days, so yesterday's coins are never starved by today's
    queue.sort((a, b) => a.last - b.last || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    const dirty = new Set<string>();
    for (const q of skipScan ? [] : queue.slice(0, r.maxCoinsPerScan)) {
      if (Date.now() > deadline - 3000) break;
      const s = await loadCoin(store, q.mint);
      if (!s) {
        await store.cmd('HSET', K.idx(q.day), q.mint, `f|${RULES_VERSION}|${SCORING_VERSION}`);
        continue;
      }
      const needsReplay = s.rv !== RULES_VERSION || s.lv !== WALLET_LEDGER_VERSION;
      const needsRescore = s.sv !== SCORING_VERSION;
      if (s.final && !needsReplay && !needsRescore && !s.rebuildPending) {
        await store.cmd('HSET', K.idx(q.day), q.mint, `f|${RULES_VERSION}|${SCORING_VERSION}`);
        continue;
      }
      try {
        if (s.mh === undefined && chain.isMayhem) {
          const m = await chain.isMayhem(s.curve).catch(() => null);
          if (m !== null) s.mh = m;
        }
        if (needsReplay) {
          resetTradeAccounting(s);
          await store.cmd('DEL', K.walletCoin(s.mint));
        }
        if (needsReplay || needsRescore) {
          s.rv = RULES_VERSION;
          s.sv = SCORING_VERSION;
          s.lv = WALLET_LEDGER_VERSION;
        }
        const res = await scanCoin(store, chain, s, r, now, deadline);
        // Scoring changes can be applied to a saved ledger. Do not replay all
        // transactions when only eligibility rules changed.
        if (needsRescore) res.changed = true;
        // Keep the previously published result during replay until the bonding curve
        // history is complete; otherwise a partial replay would temporarily erase winners.
        if (s.rebuildPending && s.curveDone) {
          s.rebuildPending = false;
          res.changed = true;
        }
        if (!s.final && deadForGood(s, r)) {
          s.final = true; // fake launch or Mayhem: it can never count, stop spending credits on it
          res.changed = true;
        }
        if (s.final) s.replayAccounting = false;
        if (needsReplay) res.changed = true;
        report.pages += res.pages;
        report.coinsScanned++;
        await saveCoin(store, s);
        await store.cmd(
          'HSET',
          K.idx(s.day),
          s.mint,
          s.final
            ? `f|${RULES_VERSION}|${SCORING_VERSION}`
            : `${now}|${s.migTime}${s.replayAccounting ? '|r' : ''}`
        );
        if (res.changed && !s.rebuildPending) {
          report.changed++;
          await store.set(K.res(s.mint), packResult(computeResult(s, r, now)), COIN_TTL);
          const mc = (p: number) => Number((p * TOTAL_SUPPLY).toPrecision(6));
          const pts = rawBars(s).map(([t, o, h, l, c]) => [t, mc(o), mc(h), mc(l), mc(c)]);
          await store.set(K.chart(s.mint), JSON.stringify(pts), COIN_TTL);
          dirty.add(s.day);
        }
      } catch (e) {
        report.errors.push(`coin ${s.symbol} ` + (e instanceof Error ? e.message : String(e)));
      }
    }

    for (const d of dirty) await store.set(K.dirty(d), '1', TTL_DAY);

    // 3. rebuild boards (current day throttled, past days rebuilt as soon as they changed)
    if (due.length && Date.now() < deadline - 1000) {
      let solUsd = 0;
      try {
        solUsd = await getSolUsd(store, chain, now);
      } catch (e) {
        report.errors.push('sol price unavailable, boards not rebuilt');
      }
      if (solUsd > 0) {
        for (const d of due) {
          if (Date.now() > deadline - 1000) break;
          await store.set('rebuild:at:' + d, String(now), TTL_DAY);
          const mints = await store.smembers(K.coins(d));
          const raws: unknown[] = [];
          for (let i = 0; i < mints.length; i += 50) {
            // one MGET per 50 coins counts as a single Redis command
            const part = (await store.cmd('MGET', ...mints.slice(i, i + 50).map((m) => K.res(m)))) as unknown[];
            raws.push(...(part || []));
          }
          const results: CoinResult[] = [];
          for (const raw of raws) {
            if (typeof raw !== 'string') continue;
            try {
              results.push(unpackResult(raw));
            } catch {
              /* skip corrupt */
            }
          }
          await rebuildDay(store, chain, r, d, results, solUsd, now);
          await store.del(K.dirty(d));
          report.boardsBuilt.push(d);
        }
        if (report.boardsBuilt.length) await writeSnapshots(store, r, now);
      }
    }
  } catch (e) {
    report.ok = false;
    report.status = 'error';
    report.reason = e instanceof Error ? e.message : String(e);
  } finally {
    await store.del('scan:lock');
    await store.maintenance().catch(() => undefined);
    report.elapsedMs = Date.now() - started;
    await store.set('scan:last', JSON.stringify(report), 86400 * 3);
  }
  return report;
}