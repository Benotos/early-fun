import { isSolAddress } from '../../shared/format';
import { CoinResponse, CoinLossRow, CoinWinRow } from '../../shared/types';
import { K } from '../lib/boards';
import { HttpError, route } from '../lib/http';
import { blockedMints, rules } from '../lib/env';
import { explainWallet, junkReasons, realizedLossRows, realizedOf, unpackResult } from '../lib/scoring';
import { loadCoin } from '../lib/scanner';
import { WalletCheckResponse } from '../../shared/types';
import { getStore } from '../lib/store';

function parse(raw: unknown): any {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default route(async ({ q }) => {
  const mint = (q.get('mint') || '').trim();
  if (!isSolAddress(mint)) throw new HttpError(400, 'bad_mint', 'That is not a valid coin address');
  const store = getStore();
  const wallet = (q.get('wallet') || '').trim();
  if (wallet) {
    if (!isSolAddress(wallet)) throw new HttpError(400, 'bad_wallet', 'That is not a valid wallet address');
    return { json: await checkWallet(store, mint, wallet) };
  }
  if (blockedMints().has(mint)) throw new HttpError(404, 'coin_blocked', 'This coin is hidden from EARLY.FUN.');
  const [rawRes, rawChart, rawSol, coinState] = await Promise.all([store.get(K.res(mint)), store.get(K.chart(mint)), store.get('solusd'), loadCoin(store, mint)]);
  if (!rawRes) throw new HttpError(404, 'coin_not_found', 'This coin is not tracked. Only pump.fun coins that migrated in the last few days are.');
  const solUsd = Number(parse(rawSol)?.p);
  if (!(solUsd > 0)) throw new HttpError(503, 'no_price', 'SOL price is not cached yet, try again in a minute');

  const res = unpackResult(rawRes);
  if (res.jk) throw new HttpError(404, 'coin_filtered', 'This coin is filtered out: it failed the quality checks (fake or bundled launch, too little real trading, or Mayhem Mode), so it never counts on the boards.');
  const needSell = rules().winRequireSell;
  const w = res.w.filter((x) => !needSell || (x.out || 0) > 0).slice(0, 15);
  // Coin detail shows all matched realized losses (including partial exits); the
  // stat above still counts only strict leaderboard-qualified losers.
  const l = (coinState ? realizedLossRows(coinState) : res.l).slice(0, 15);
  const got = w.length + l.length
    ? await store.run([...w.map((x) => ['HGET', K.win(res.day), x.wallet]), ...l.map((x) => ['HGET', K.loss(res.day), x.wallet])])
    : [];
  const onBoard = (raw: unknown) => {
    const e = parse(raw);
    return !!e && e.mint === mint && Number(e.r) > 0;
  };
  const winners: CoinWinRow[] = w.map((x, i) => ({
    wallet: x.wallet,
    mult: x.mult,
    entryMcUsd: x.entryMc * solUsd,
    peakMcUsd: x.peakMc * solUsd,
    buySol: x.buySol,
    buyTime: x.buyTime,
    onBoard: onBoard(got[i]),
    ...(x.pnl !== undefined ? { pnlSol: x.pnl } : {}),
    ...(x.in !== undefined ? { inSol: x.in, outSol: x.out || 0, holding: !!x.hold } : {}),
    ...(x.rz ? { realized: true } : {}),
  }));
  const losers: CoinLossRow[] = l.map((x, i) => ({
    wallet: x.wallet,
    lossSol: x.lossSol,
    lossPct: x.lossPct,
    buyMcUsd: x.buyMc * solUsd,
    sellMcUsd: x.sellMc * solUsd,
    buySol: x.buySol,
    sellSol: x.sellSol,
    onBoard: onBoard(got[w.length + i]),
  }));
  const chartRaw = parse(rawChart);
  // candles [t, o, h, l, c] in USD market cap; old charts stored [t, v] and become flat candles
  const chart: [number, number, number, number, number][] = Array.isArray(chartRaw)
    ? chartRaw.filter((p: number[]) => p.length >= 5).map((p: number[]) => [p[0], p[1] * solUsd, p[2] * solUsd, p[3] * solUsd, p[4] * solUsd])
    : []; // old line charts are skipped, the page shows a loading note until the coin is re-read
  const body: CoinResponse = {
    ok: true,
    coin: {
      mint,
      symbol: res.symbol,
      day: res.day,
      mig: res.mig ?? 0,
      dev: res.dev,
      peakMcUsd: (res.pk ?? 0) * solUsd,
      trades: res.tr ?? 0,
      final: !!res.fin,
      wCount: res.w.length,
      lCount: res.l.length,
    },
    chart,
    winners,
    losers,
  };
  // The chart page polls this endpoint while it is open. Serve the newest
  // scanner state instead of pinning an old candle response at the edge.
  return { json: body, cache: 'no-store' };
});

/** Rule by rule answer to "why is (or isn't) this wallet on the board for this coin". */
async function checkWallet(store: ReturnType<typeof getStore>, mint: string, wallet: string): Promise<WalletCheckResponse> {
  const r = rules();
  const s = await loadCoin(store, mint);
  const empty: WalletCheckResponse = { ok: true, tracked: false, coinIssues: [], scan: { trades: 0, complete: false }, found: false, winner: [], loser: [], winRank: null, lossRank: null, verdict: '' };
  if (!s) {
    return {
      ...empty,
      verdict: 'This coin is not tracked. Only pump.fun coins that migrated today or yesterday (UTC) are scanned. If it migrated in the last few minutes, the scanner may not have picked it up yet.',
    };
  }
  const coinIssues = junkReasons(s, r);
  const complete = s.curveDone && s.poolDone;
  const ex = explainWallet(s, r, wallet);
  const [wRaw, lRaw] = await store.run([
    ['HGET', K.win(s.day), wallet],
    ['HGET', K.loss(s.day), wallet],
  ]);
  const rank = (raw: unknown) => {
    const e = parse(raw);
    return e && e.mint === mint && Number(e.r) > 0 ? Number(e.r) : null;
  };
  const winRank = rank(wRaw);
  const lossRank = rank(lRaw);
  let verdict: string;
  if (!ex.found) {
    verdict = `No trades from this wallet in the ${s.trades.toLocaleString('en-US')} trades read on this coin so far.`;
    if (!complete) verdict += ' The scanner is still reading this coin, check again in a few minutes.';
    if (s.capped) verdict += ' This coin had so many wallets that very small ones were dropped.';
  } else if (coinIssues.length) {
    verdict = 'This coin is filtered out, so nothing on it counts: ' + coinIssues.join('; ') + '.';
  } else {
    const winOk = ex.winner.length > 0 && ex.winner.every((c) => c.ok);
    const lossOk = ex.loser.every((c) => c.ok);
    const x = realizedOf(s, wallet);
    if (winOk) {
      verdict = `Counts as a winner on this coin${x ? ` (+${x.pnl.toFixed(2)} SOL)` : ''}.`;
      verdict += winRank ? ` It is #${winRank} on the ${s.day} board.` : ' It is not in the verified top of the day board yet (boards refresh every 10 minutes, and wallets funded by the dev or sharing a funder are removed).';
    } else if (lossOk) {
      verdict = 'Counts as a loser on this coin.';
      verdict += lossRank ? ` It is #${lossRank} on the ${s.day} losers board.` : ' It is not in the verified top of the day board yet.';
    } else {
      const fail = [...ex.winner.filter((c) => !c.ok)].map((c) => c.text);
      verdict = 'Does not count as a winner: ' + (fail.length ? fail.join('; ') : 'see the checks below') + '.';
    }
    if (!complete) verdict += ' Still reading this coin, numbers can change.';
  }
  return { ok: true, tracked: true, symbol: s.symbol, coinIssues, scan: { trades: s.trades, complete }, found: ex.found, winner: ex.winner, loser: ex.loser, winRank, lossRank, verdict };
}