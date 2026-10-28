import { addDays, dayKey, isSolAddress } from '../../shared/format';
import { LossEntry, RankedLoss, RankedWin, WalletResponse, WinEntry } from '../../shared/types';
import { K } from '../lib/boards';
import { HeliusChain, RawTx } from '../lib/chain';
import { HttpError, limited, route } from '../lib/http';
import { rules } from '../lib/env';
import { applyWalletLedgerTrades, CoinState, newCoin, WalletCoinLedger, unpackState } from '../lib/coin';
import { junkReasons, realizedOf } from '../lib/scoring';
import { needsTickerLookup, pumpTickerFromResponse, resolveWalletTicker, walletTradesFromTransactions } from '../lib/wallet-scan';
import { getStore } from '../lib/store';

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

const coinKey = (day: string, mint: string) => `${day}|${mint}`;
const solRound = (value: number) => Math.round(value * 1e4) / 1e4;

export default route(async ({ q, ip }) => {
  const routeStartedAt = Date.now();
  const address = (q.get('address') || '').trim();
  if (!isSolAddress(address)) throw new HttpError(400, 'bad_address', 'That is not a valid Solana wallet address');
  const store = getStore();
  if (await limited(store, 'wallet:' + ip, 60, 60)) throw new HttpError(429, 'rate_limited', 'Slow down a little');

  const cacheKey = `wallet:pnl:v6:${address}`;
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

  const stateByMint = new Map<string, CoinState>();
  const solPrice = Number(parse<{ p?: number }>(await store.get('solusd'))?.p)
    || Number(parse<{ solUsd?: number }>(await store.get(K.board(today)))?.solUsd)
    || 0;
  const r = rules();
  const BATCH_SIZE = 12;
  const CONCURRENCY = 3;
  const groups: string[][] = [];
  for (let i = 0; i < mints.length; i += BATCH_SIZE) groups.push(mints.slice(i, i + BATCH_SIZE));

  for (let i = 0; i < groups.length; i += CONCURRENCY) {
      const batches = await Promise.all(groups.slice(i, i + CONCURRENCY).map(async (group) => {
        const [values, ledgers] = await Promise.all([
          store.cmd('MGET', ...group.map(K.coin)) as Promise<unknown[]>,
          store.run(group.map((mint) => ['HGET', K.walletCoin(mint), address])),
        ]);
        return { group, values, ledgers };
      }));
      for (const batch of batches) {
        batch.group.forEach((mint, index) => {
          const raw = batch.values[index];
          if (typeof raw !== 'string') return;
          try {
            const state = unpackState(raw);
            if (!days.includes(state.day)) return;
            stateByMint.set(mint, state);
            const storedLedger = parse<WalletCoinLedger>(batch.ledgers[index]);
            const p = storedLedger?.pnl || state.pnl[address];
            const buys = storedLedger?.buys || state.buys[address] || [];
            if (!p || p.sn || address === state.dev || (p.n || 0) > r.maxWalletTrades || p.bs < r.minBuySol) return;
            // Use the complete per-wallet ledger when the compact coin state
            // pruned this wallet to stay under its storage size cap.
            const walletState = storedLedger
              ? { ...state, pnl: { ...state.pnl, [address]: p }, buys: { ...state.buys, [address]: buys } }
              : state;
            if (junkReasons(walletState, r).length) return;
            const x = realizedOf(walletState, address);
            if (!x || !Number.isFinite(x.pnl) || Math.abs(x.pnl) < 0.00005) return;
            const key = coinKey(state.day, mint);

            if (x.pnl > 0) {
              if (x.mult < r.minRealizedMult || x.buyMc < r.minEntryMcSol) return;
              if (winByCoin.has(key)) return;
              const firstBuy = buys[0];
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

            const soldRatio = p.bt > 0 ? p.st / p.bt : 0;
            if (soldRatio < 0.98 || soldRatio > 1.02 || p.ls - p.lb < r.minHoldSeconds) return;
            const lossSol = -x.pnl;
            if (lossSol < r.minLossSol) return;
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

  // If either side is empty, do a bounded on-demand scan of the wallet's
  // own recent transactions and reconstruct trades for coins EARLY.FUN knows.
  // This avoids making a wallet profile depend entirely on the background ledger
  // backfill. Results remain limited to the same seven-day window and known coins.
  if (!winByCoin.size || !lossByCoin.size) {
    try {
      const chain = new HeliusChain();
      const scanDeadline = Date.now() + 8500;
      (chain as unknown as { setDeadline?: (t: number) => void }).setDeadline?.(scanDeadline);
      const since = Math.floor(Date.now() / 1000) - 7 * 86400;
      const transactions: RawTx[] = [];
      let token: string | null = null;
      for (let pageNo = 0; pageNo < 5 && Date.now() < scanDeadline - 1000; pageNo++) {
        const page = await chain.txsForAddress(address, { sort: 'desc', limit: 1000, token });
        if (!page.txs.length) break;
        transactions.push(...page.txs.filter((tx) => (tx.blockTime ?? 0) >= since));
        const reachedWindowStart = page.txs.some((tx) => (tx.blockTime ?? 0) < since);
        if (!page.next || reachedWindowStart) break;
        token = page.next;
      }

      const directTrades = walletTradesFromTransactions(address, transactions, new Set(mints), since);
      const tradesByMint = new Map<string, typeof directTrades>();
      for (const trade of directTrades) {
        const list = tradesByMint.get(trade.mint || '') || [];
        list.push(trade);
        tradesByMint.set(trade.mint || '', list);
      }

      for (const [mint, trades] of tradesByMint) {
        const metadataState = stateByMint.get(mint);
        if (!metadataState && !mint.endsWith('pump')) continue;
        const firstTime = trades.find((trade) => trade.side === 'buy')?.time || trades[0]?.time || since;
        const lastTime = Math.max(...trades.map((trade) => trade.time));
        const profileDay = dayKey(firstTime);
        const profileState: CoinState = {
          ...(metadataState || newCoin({
            mint,
            curve: '',
            pool: null,
            migTime: firstTime,
            migSig: '',
            day: profileDay,
            dayEnd: Math.max(Math.floor(firstTime / 86400) * 86400 + 86400, lastTime + 1),
            symbol: mint.slice(0, 4).toUpperCase(),
          })),
          // Wallet P/L covers the full seven-day window, even when the token's
          // original board day has ended.
          day: profileDay,
          dayEnd: Math.max(Math.floor(firstTime / 86400) * 86400 + 86400, lastTime + 1),
        };
        if (!days.includes(profileState.day)) continue;
        const state = metadataState || profileState;
        const ledger: WalletCoinLedger = {
          pnl: {
            bs: 0, ss: 0, bt: 0, st: 0, fb: 0, lb: 0, ls: 0,
            inventoryTokens: 0, inventoryCostSol: 0,
            matchedSoldTokens: 0, matchedSoldCostSol: 0, matchedSoldProceedsSol: 0,
          },
          buys: [],
        };
        applyWalletLedgerTrades(profileState, ledger, trades, r);
        const walletState: CoinState = {
          ...profileState,
          pnl: { ...state.pnl, [address]: ledger.pnl },
          buys: { ...state.buys, [address]: ledger.buys },
        };
        const x = realizedOf(walletState, address);
        if (!x || !Number.isFinite(x.pnl) || Math.abs(x.pnl) < 0.00005) continue;
        const key = coinKey(profileState.day, mint);

        if (x.pnl > 0 && !winByCoin.has(key)) {
          const firstBuy = ledger.buys[0];
          winByCoin.set(key, {
            wallet: address,
            mint,
            symbol: state.symbol || mint.slice(0, 4).toUpperCase(),
            entryMcUsd: x.buyMc * solPrice,
            peakMcUsd: x.sellMc * solPrice,
            mult: x.mult,
            buySol: x.cost,
            buyTime: ledger.pnl.fb || firstBuy?.time || state.migTime,
            sig: firstBuy?.sig || '',
            day: profileState.day,
            pnlSol: solRound(x.pnl),
            inSol: solRound(x.cost),
            outSol: solRound(x.proceeds),
            holding: false,
            realized: true,
            rank: 0,
            total: 0,
            onBoard: false,
          });
        } else if (x.pnl < 0 && !lossByCoin.has(key)) {
          lossByCoin.set(key, {
            wallet: address,
            mint,
            symbol: state.symbol || mint.slice(0, 4).toUpperCase(),
            buyMcUsd: x.buyMc * solPrice,
            sellMcUsd: x.sellMc * solPrice,
            lossSol: solRound(-x.pnl),
            lossPct: (-x.pnl / x.cost) * 100,
            buySol: x.cost,
            sellSol: x.proceeds,
            lastSellTime: ledger.pnl.ls || ledger.pnl.lb || state.migTime,
            day: profileState.day,
            rank: 0,
            total: 0,
            onBoard: false,
          });
        }
      }
    } catch {
      // Keep existing indexed results available when the on-demand RPC scan
      // cannot complete within the serverless time budget.
    }
  }

  // Replace fallback mint fragments with real token metadata. Cache known
  // symbols so profiles with the same token do not repeatedly hit the RPC.
  const allEntries = [...winByCoin.values(), ...lossByCoin.values()];
  const unresolvedMints = [...new Set(allEntries
    .filter((entry) => needsTickerLookup(entry.symbol, entry.mint))
    .map((entry) => entry.mint))];
  const metaCacheRows = unresolvedMints.length
    ? await store.run(unresolvedMints.map((mint) => ['GET', `ticker:${mint}`]))
    : [];
  const symbolByMint = new Map<string, string>();
  const toFetch: string[] = [];
  unresolvedMints.forEach((mint, index) => {
    const cachedSymbol = typeof metaCacheRows[index] === 'string' ? String(metaCacheRows[index]) : '';
    if (cachedSymbol && !needsTickerLookup(cachedSymbol, mint)) symbolByMint.set(mint, cachedSymbol);
    else toFetch.push(mint);
  });

  // Prefer Pump.fun's coin record for Pump mints, then fall back to Helius DAS.
  // Keep both providers bounded by the serverless response budget.
  if (toFetch.length > 0) {
    try {
      const availableMs = Math.max(0, 9000 - (Date.now() - routeStartedAt));
      const canFetch = availableMs > 1800;
      const deadline = Date.now() + Math.min(3500, Math.max(0, availableMs - 300));
      const metadataChain = new HeliusChain();
      if (canFetch) metadataChain.setDeadline(deadline);
      const lookups = canFetch ? toFetch.slice(0, 12) : [];
      const resolved = await Promise.all(lookups.map(async (mint) => {
        let symbol: string | null = null;
        const left = deadline - Date.now();
        if (left > 500) {
          try {
            const response = await fetch(`https://frontend-api-v3.pump.fun/coins/${encodeURIComponent(mint)}?sync=true`, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(Math.min(1200, left - 200)),
            });
            if (response.ok) symbol = pumpTickerFromResponse(await response.json(), mint);
          } catch {
            // Some Pump.fun responses require auth or can be temporarily unavailable.
          }
        }
        if (!symbol && deadline - Date.now() > 1500) {
          const meta = await metadataChain.tokenMeta(mint);
          if (meta?.symbol && !needsTickerLookup(meta.symbol, mint)) {
            symbol = resolveWalletTicker(mint, undefined, meta.symbol);
          }
        }
        return [mint, symbol] as const;
      }));
      const save: [string, string][] = [];
      for (const [mint, symbol] of resolved) {
        if (!symbol) continue;
        symbolByMint.set(mint, symbol);
        save.push([`ticker:${mint}`, symbol]);
      }
      if (save.length) await store.run(save.map(([key, value]) => ['SET', key, value]));
    } catch {
      // Show UNKNOWN rather than exposing a mint address if both metadata providers fail.
    }
  }

  for (const [key, entry] of winByCoin) {
    winByCoin.set(key, { ...entry, symbol: resolveWalletTicker(entry.mint, entry.symbol, symbolByMint.get(entry.mint)) });
  }
  for (const [key, entry] of lossByCoin) {
    lossByCoin.set(key, { ...entry, symbol: resolveWalletTicker(entry.mint, entry.symbol, symbolByMint.get(entry.mint)) });
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
