import { addDays, dayKey, isSolAddress } from '../../shared/format';
import { LossEntry, RankedLoss, RankedWin, WalletResponse, WinEntry } from '../../shared/types';
import { K } from '../lib/boards';
import { HttpError, limited, route } from '../lib/http';
import { rules } from '../lib/env';
import { unpackState } from '../lib/coin';
import { realizedOf } from '../lib/scoring';
import { getStore } from '../lib/store';

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

const coinKey = (day: string, mint: string) => `${day}|${mint}`;
const solRound = (value: number) => Math.round(value * 1e4) / 1e4;

export default route(async ({ q, ip }) => {
  const address = (q.get('address') || '').trim();
  if (!isSolAddress(address)) throw new HttpError(400, 'bad_address', 'That is not a valid Solana wallet address');
  const store = getStore();
  if (await limited(store, 'wallet:' + ip, 60, 60)) throw new HttpError(429, 'rate_limited', 'Slow down a little');

  const cacheKey = `wallet:pnl:v3:${address}`;
  const cached = parse<WalletResponse>(await store.get(cacheKey));
  if (cached?.ok && cached.address === address) return { json: cached, cache: 'public, s-maxage=15, stale-while-revalidate=30' };

  const today = dayKey(Math.floor(Date.now() / 1000));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const cmds = days.flatMap((d) => [
    ['HGET', K.win(d), address],
    ['HGET', K.loss(d), address],
  ]);
  const res = await store.run(cmds);
  const wins: { d: string; e: WinEntry & { r?: number } }[] = [];
  const losses: { d: string; e: LossEntry & { r?: number } }[] = [];
  days.forEach((d, i) => {
    const w = parse<WinEntry & { r?: number }>(res[i * 2]);
    const l = parse<LossEntry & { r?: number }>(res[i * 2 + 1]);
    if (w) wins.push({ d, e: w });
    if (l) losses.push({ d, e: l });
  });

  const rankCmds = [
    ...wins.flatMap((x) => [['ZREVRANK', K.zwin(x.d), address], ['ZCARD', K.zwin(x.d)]]),
    ...losses.flatMap((x) => [['ZREVRANK', K.zloss(x.d), address], ['ZCARD', K.zloss(x.d)]]),
  ];
  const rr = rankCmds.length ? await store.run(rankCmds) : [];
  let k = 0;
  const outW: RankedWin[] = wins.map((x) => {
    const raw = Number(rr[k++]) + 1;
    const total = Number(rr[k++]);
    const { r, ...e } = x.e;
    return { ...e, rank: r ? r : (Number.isFinite(raw) ? raw : 1), total, onBoard: !!r };
  });
  const outL: RankedLoss[] = losses.map((x) => {
    const raw = Number(rr[k++]) + 1;
    const total = Number(rr[k++]);
    const { r, ...e } = x.e;
    return { ...e, rank: r ? r : (Number.isFinite(raw) ? raw : 1), total, onBoard: !!r };
  });

  // The public board tables intentionally contain only ranked candidates. Wallet
  // history must also show real realized P/L for addresses outside those tables.
  // Read the scanner's already stored coin states, never request new RPC scans.
  const winByCoin = new Map(outW.map((x) => [coinKey(x.day, x.mint), x]));
  const lossByCoin = new Map(outL.map((x) => [coinKey(x.day, x.mint), x]));
  const coinLists = await store.run(days.map((d) => ['SMEMBERS', K.coins(d)]));
  const seen = new Set<string>();
  const mints: string[] = [];
  for (const list of coinLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const mint = String(item);
      if (!seen.has(mint)) {
        seen.add(mint);
        mints.push(mint);
      }
    }
  }

  const solPrice = Number(parse<{ p?: number }>(await store.get('solusd'))?.p)
    || Number(parse<{ solUsd?: number }>(await store.get(K.board(today)))?.solUsd)
    || 0;
  const r = rules();
  const BATCH_SIZE = 12;
  const CONCURRENCY = 3;
  const groups: string[][] = [];
  for (let i = 0; i < mints.length; i += BATCH_SIZE) groups.push(mints.slice(i, i + BATCH_SIZE));

  if (solPrice > 0) {
    for (let i = 0; i < groups.length; i += CONCURRENCY) {
      const batches = await Promise.all(groups.slice(i, i + CONCURRENCY).map(async (group) => ({
        group,
        values: await store.cmd('MGET', ...group.map(K.coin)) as unknown[],
      })));
      for (const batch of batches) {
        batch.group.forEach((mint, index) => {
          const raw = batch.values[index];
          if (typeof raw !== 'string') return;
          try {
            const state = unpackState(raw);
            if (!days.includes(state.day)) return;
            const p = state.pnl[address];
            if (!p || p.sn || address === state.dev || (p.n || 0) > r.maxWalletTrades || p.bs < r.minBuySol) return;
            const x = realizedOf(state, address);
            if (!x || !Number.isFinite(x.pnl) || Math.abs(x.pnl) < 0.00005) return;
            const key = coinKey(state.day, mint);

            if (x.pnl > 0) {
              if (x.mult < r.minRealizedMult || x.buyMc < r.minEntryMcSol) return;
              if (winByCoin.has(key)) return;
              const firstBuy = state.buys[address]?.[0];
              winByCoin.set(key, {
                wallet: address,
                mint,
                symbol: state.symbol,
                entryMcUsd: x.buyMc * solPrice,
                peakMcUsd: x.sellMc * solPrice,
                mult: x.mult,
                buySol: x.cost,
                buyTime: p.fb || firstBuy?.time || state.migTime,
                sig: firstBuy?.sig || '',
                day: state.day,
                pnlSol: solRound(x.pnl),
                inSol: solRound(x.cost),
                outSol: solRound(x.proceeds),
                holding: (p.inventoryTokens ?? Math.max(0, p.bt - p.st)) > p.bt * 0.02,
                realized: true,
                rank: 0,
                total: 0,
                onBoard: false,
              });
              return;
            }

            const soldRatio = p.bt > 0
              ? (typeof p.matchedSoldTokens === 'number' ? p.matchedSoldTokens : Math.min(p.bt, p.st)) / p.bt
              : 0;
            if (soldRatio < 0.9 || soldRatio > 1.02 || p.ls - p.lb < r.minHoldSeconds) return;
            const lossSol = -x.pnl;
            if (lossSol < r.minLossSol || lossSol / x.cost > r.lossCapPct) return;
            if (lossByCoin.has(key)) return;
            lossByCoin.set(key, {
              wallet: address,
              mint,
              symbol: state.symbol,
              buyMcUsd: x.buyMc * solPrice,
              sellMcUsd: x.sellMc * solPrice,
              lossSol: solRound(lossSol),
              lossPct: (lossSol / x.cost) * 100,
              buySol: x.cost,
              sellSol: x.proceeds,
              lastSellTime: p.ls || p.lb || state.migTime,
              day: state.day,
              rank: 0,
              total: 0,
              onBoard: false,
            });
          } catch {
            // Ignore a single expired or corrupt coin state.
          }
        });
      }
    }
  }

  const finalWins = [...winByCoin.values()]
    .sort((a, b) => {
      const ar = a.realized && a.pnlSol !== undefined;
      const br = b.realized && b.pnlSol !== undefined;
      if (ar && br) return (b.pnlSol || 0) - (a.pnlSol || 0) || b.mult - a.mult;
      if (ar !== br) return ar ? -1 : 1;
      return b.mult - a.mult;
    })
    .slice(0, 100)
    .map((entry, index, all) => entry.onBoard ? entry : { ...entry, rank: index + 1, total: all.length });
  const finalLosses = [...lossByCoin.values()]
    .sort((a, b) => b.lossSol - a.lossSol)
    .slice(0, 100)
    .map((entry, index, all) => entry.onBoard ? entry : { ...entry, rank: index + 1, total: all.length });

  const body: WalletResponse = { ok: true, address, wins: finalWins, losses: finalLosses };
  await store.set(cacheKey, JSON.stringify(body), 20);
  return { json: body, cache: 'no-store' };
});
