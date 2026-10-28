import { gunzipSync, gzipSync } from 'node:zlib';
import { LossEntry, WinEntry } from '../../shared/types';
import { CoinState, peakAfter, sparkOf } from './coin';
import { Rules, TOKEN_DECIMALS, TOTAL_SUPPLY, blockedMints } from './env';

/** Market caps here are in SOL, converted to USD only when a board is built. */
export interface WinRow {
  wallet: string;
  mult: number;
  entryMc: number;
  peakMc: number;
  buySol: number;
  buyTime: number;
  sig: string;
  /** realized SOL profit on the coin, absent if nothing sold */
  pnl?: number;
  /** total SOL spent and received on the coin, and 1 while still holding part of the bag */
  in?: number;
  out?: number;
  hold?: 1;
  /** realized row: entryMc is the average buy, peakMc the average sell */
  rz?: 1;
}
export interface LossRow {
  wallet: string;
  lossSol: number;
  lossPct: number;
  buyMc: number;
  sellMc: number;
  buySol: number;
  sellSol: number;
  lastSell: number;
}
export interface CoinResult {
  mint: string;
  symbol: string;
  day: string;
  dev: string | null;
  w: WinRow[];
  l: LossRow[];
  at: number;
  fin: boolean;
  /** coin failed the quality gate, kept off boards and coin lists */
  jk?: 1;
  /** estimated Pump.fun global/protocol fees generated, SOL */
  gf?: number;
  /** migration time, peak market cap in SOL, trades seen, sparkline */
  mig: number;
  pk: number;
  tr: number;
  sp: number[];
}

const mcSol = (price: number) => price * TOTAL_SUPPLY;
const ROW_CAP = 1500;

/**
 * Board entries must be a closed, self-funded trade: tokens sold must match tokens
 * bought, allowing only 0.1% for tiny rounding/dust differences. Selling extra tokens
 * received by transfer is an anti-abuse failure, even if part of the sale matches
 * the wallet's tracked purchases.
 */
export function tokenFlowBalanced(p: CoinState['pnl'][string], tolerance = 0.001): boolean {
  if (!p || p.foreignInventory || !(p.bt > 0) || !(p.st > 0)) return false;
  const ratio = p.st / p.bt;
  if (!Number.isFinite(ratio) || ratio < 1 - tolerance || ratio > 1 + tolerance) return false;
  if (typeof p.matchedSoldTokens === 'number') {
    const matchedRatio = p.matchedSoldTokens / p.bt;
    if (!Number.isFinite(matchedRatio) || matchedRatio < 1 - tolerance || matchedRatio > 1 + tolerance) return false;
  }
  return true;
}

function tokenFlowExplanation(p: CoinState['pnl'][string]): string {
  if (p.foreignInventory) {
    return 'sold while holding tokens not accounted for by this wallet\'s tracked buys; transferred or airdropped tokens do not count';
  }
  const scale = 10 ** TOKEN_DECIMALS;
  const bought = p.bt / scale;
  const sold = p.st / scale;
  const ratio = p.bt > 0 ? (p.st / p.bt) * 100 : 0;
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: TOKEN_DECIMALS });
  return `token amounts must match within 0.1%: bought ${fmt(bought)}, sold ${fmt(sold)} (${ratio.toFixed(3)}% out)`;
}

/**
 * WINNERS score = peak market cap after the buy / market cap at the buy.
 * One best entry per wallet per coin. Only buys that passed the filters
 * (not in the creation window, not the dev, at least MIN_BUY_SOL) are candidates.
 */
export function winnerRows(s: CoinState, r: Rules): WinRow[] {
  if (r.winMode === 'realized') return realizedRows(s, r);
  const out: WinRow[] = [];
  for (const [wallet, cands] of Object.entries(s.buys)) {
    if ((s.pnl[wallet]?.n || 0) > r.maxWalletTrades) continue; // volume bot
    const p = s.pnl[wallet];
    // Any wallet that sells must sell only the quantity it bought, even when
    // peak mode is configured to allow holders.
    if (p && p.st > 0 && !tokenFlowBalanced(p)) continue;
    if (r.winRequireSell && (!p || !tokenFlowBalanced(p))) continue; // must sell the purchased amount, not a transferred bag
    if (r.winRequireSell && !((p?.ss || 0) > 0)) continue; // must have taken profit, not just held
    let best: { c: (typeof cands)[number]; mult: number; peak: number } | null = null;
    for (const c of cands) {
      if (mcSol(c.price) < r.minEntryMcSol) continue; // below any real pump.fun start, a price glitch
      const pk = peakAfter(s, c.slot);
      if (!pk) continue;
      const mult = pk.price / c.price;
      if (!best || mult > best.mult || (mult === best.mult && c.slot < best.c.slot)) best = { c, mult, peak: pk.price };
    }
    if (!best || best.mult < r.minMult) continue;
    const pnl = p && tokenFlowBalanced(p) ? p.ss - p.bs * Math.min(1, p.st / p.bt) : undefined;
    out.push({
      ...(pnl !== undefined ? { pnl: Math.round(pnl * 1e4) / 1e4 } : {}),
      ...(p ? { in: Math.round(p.bs * 1e4) / 1e4, out: Math.round(p.ss * 1e4) / 1e4, ...(p.st < p.bt * 0.98 ? { hold: 1 as const } : {}) } : {}),
      wallet,
      mult: best.mult,
      entryMc: mcSol(best.c.price),
      peakMc: mcSol(best.peak),
      buySol: best.c.sol,
      buyTime: best.c.time,
      sig: best.c.sig,
    });
  }
  return out.sort((a, b) => b.mult - a.mult || a.buyTime - b.buyTime).slice(0, ROW_CAP);
}

/** wallet x coin profit facts, shared by the realized board and the wallet checker */
export function realizedOf(s: CoinState, wallet: string) {
  const p = s.pnl[wallet];
  if (!p || p.bt <= 0 || p.st <= 0 || p.ss <= 0) return null;
  // Require a full closed round trip. A transferred token sold by the wallet makes
  // total token out exceed tracked token in and must never produce a board result.
  if (!tokenFlowBalanced(p)) return null;

  // New states carry transaction-by-transaction inventory matching. For legacy
  // states, the fallback is conservative until the scanner replays their history.
  const hasMatchedLedger = typeof p.matchedSoldTokens === 'number';
  const matchedTokens = hasMatchedLedger ? (p.matchedSoldTokens || 0) : Math.min(p.bt, p.st);
  if (!(matchedTokens > 0)) return null;
  const cost = hasMatchedLedger
    ? (p.matchedSoldCostSol || 0)
    : p.bs * (matchedTokens / p.bt);
  const proceeds = hasMatchedLedger
    ? (p.matchedSoldProceedsSol || 0)
    : p.ss * (matchedTokens / p.st);
  if (!(cost > 0) || !(proceeds > 0)) return null;
  const matchedMarketTokens = matchedTokens / 1e6;
  return {
    cost,
    proceeds,
    matchedTokens,
    pnl: proceeds - cost,
    mult: proceeds / cost,
    buyMc: mcSol(cost / matchedMarketTokens),
    sellMc: mcSol(proceeds / matchedMarketTokens),
  };
}

/**
 * WINNERS (realized): what the wallet sold for against what those tokens cost.
 * Multiple = sell value / cost, ranked by SOL profit. Holders never count.
 * Same guards as before: no snipers, no dev, no bots, minimum buy size, real entry price.
 */
export function realizedRows(s: CoinState, r: Rules): WinRow[] {
  const out: WinRow[] = [];
  for (const [wallet, p] of Object.entries(s.pnl)) {
    if (p.sn || wallet === s.dev) continue;
    if ((p.n || 0) > r.maxWalletTrades) continue;
    if (p.bs < r.minBuySol) continue;
    const x = realizedOf(s, wallet);
    if (!x || x.pnl <= 0 || x.mult < r.minRealizedMult) continue;
    if (x.buyMc < r.minEntryMcSol) continue;
    const firstBuy = s.buys[wallet]?.[0];
    out.push({
      wallet,
      mult: x.mult,
      entryMc: x.buyMc,
      peakMc: x.sellMc,
      buySol: x.cost,
      buyTime: p.fb || firstBuy?.time || 0,
      sig: firstBuy?.sig || '',
      pnl: Math.round(x.pnl * 1e4) / 1e4,
      in: Math.round(x.cost * 1e4) / 1e4,
      out: Math.round(x.proceeds * 1e4) / 1e4,
      ...((p.inventoryTokens ?? Math.max(0, p.bt - p.st)) > p.bt * 0.02 ? { hold: 1 as const } : {}),
      rz: 1,
    });
  }
  return out.sort((a, b) => (b.pnl || 0) - (a.pnl || 0) || b.mult - a.mult).slice(0, ROW_CAP);
}

/**
 * LOSERS score = realized loss in SOL (buy cost minus sell proceeds) on a coin the wallet fully exited.
 * Guards: not a sniper, not the dev, buy size >= MIN_BUY_SOL, exited 90 to 102 percent of what it bought,
 * held at least MIN_HOLD_SECONDS between its last buy and its last sell.
 */
export function loserRows(s: CoinState, r: Rules): LossRow[] {
  const out: LossRow[] = [];
  for (const [wallet, p] of Object.entries(s.pnl)) {
    if (p.sn || wallet === s.dev) continue;
    if ((p.n || 0) > r.maxWalletTrades) continue; // volume bot
    if (p.bt <= 0 || p.bs < r.minBuySol) continue;
    const x = realizedOf(s, wallet);
    const matchedSoldTokens = typeof p.matchedSoldTokens === 'number' ? p.matchedSoldTokens : Math.min(p.bt, p.st);
    if (matchedSoldTokens < p.bt * 0.9 || matchedSoldTokens > p.bt * 1.02) continue;
    if (!x) continue;
    const lossSol = x.cost - x.proceeds;
    if (lossSol < r.minLossSol) continue;
    if (p.ls - p.lb < r.minHoldSeconds) continue;
    out.push({
      wallet,
      lossSol,
      lossPct: (lossSol / x.cost) * 100,
      buyMc: x.buyMc,
      sellMc: x.sellMc,
      buySol: x.cost,
      sellSol: x.proceeds,
      lastSell: p.ls,
    });
  }
  return out.sort((a, b) => b.lossSol - a.lossSol).slice(0, ROW_CAP);
}

/** thin or blocked coins never reach the boards */
/** Every quality check a coin fails, in plain words. Empty means the coin counts. */
export function junkReasons(s: CoinState, r: Rules): string[] {
  const why: string[] = [];
  if (blockedMints().has(s.mint)) why.push('blocked by the admin');
  if (!s.curveDone) why.push('bonding curve not fully read yet');
  // a real pump.fun migration always ends the curve near 410 SOL market cap
  let cpk = s.cpk;
  if (cpk === undefined) {
    cpk = 0;
    const R = s.sres || 60;
    for (const e of s.ser || []) if (e[0] * R + R <= s.migTime) cpk = Math.max(cpk, e[2]);
  }
  if (s.curveDone && cpk * TOTAL_SUPPLY < r.minCurveMcSol) why.push(`bonding curve only reached ${Math.round(cpk * TOTAL_SUPPLY)} SOL market cap, a real migration ends near 410`);
  if (s.mh && r.hideMayhem) why.push('pump.fun Mayhem Mode coin');
  if (s.gf !== undefined && s.gf < r.minGlobalFeesSol) why.push(`estimated Pump.fun global fees are ${s.gf.toFixed(2)} SOL, minimum is ${r.minGlobalFeesSol}`);
  if (s.trades < r.minCoinTrades) why.push(`only ${s.trades} trades, minimum is ${r.minCoinTrades}`);
  const wallets = new Set([...Object.keys(s.pnl), ...Object.keys(s.buys)]).size;
  if (wallets < r.minCoinWallets) why.push(`only ${wallets} wallets traded it, minimum is ${r.minCoinWallets}`);
  return why;
}

export function coinIsJunk(s: CoinState, r: Rules): boolean {
  return junkReasons(s, r).length > 0;
}

export interface Check {
  ok: boolean;
  text: string;
}

/** Explains, rule by rule, whether a wallet counts as a winner and as a loser on one coin. */
export function explainWallet(s: CoinState, r: Rules, wallet: string): { winner: Check[]; loser: Check[]; found: boolean } {
  const p = s.pnl[wallet];
  if (!p) return { winner: [], loser: [], found: false };
  const f = (n: number) => n.toFixed(n >= 10 ? 1 : 3);
  const base: Check[] = [
    { ok: wallet !== s.dev, text: wallet === s.dev ? 'this wallet created the coin, devs never count' : 'not the dev wallet' },
    { ok: !p.sn, text: p.sn ? 'bought in the first seconds after launch (sniper window)' : 'not a launch sniper' },
    { ok: (p.n || 0) <= r.maxWalletTrades, text: `${p.n || 0} trades on this coin${(p.n || 0) > r.maxWalletTrades ? `, over ${r.maxWalletTrades} looks like a bot` : ''}` },
    { ok: p.bs >= r.minBuySol, text: `bought ${f(p.bs)} SOL in total${p.bs < r.minBuySol ? `, minimum is ${r.minBuySol}` : ''}` },
  ];
  const x = realizedOf(s, wallet);
  const balanced = tokenFlowBalanced(p);
  const winner: Check[] = [...base];
  winner.push({ ok: balanced, text: balanced ? 'tokens bought and sold match' : tokenFlowExplanation(p) });
  if (r.winMode === 'realized') {
    winner.push({ ok: p.ss > 0, text: p.ss > 0 ? `sold for ${f(p.ss)} SOL` : 'has not sold yet, holders do not count' });
    if (x) {
      winner.push({ ok: x.pnl > 0, text: `realized ${x.pnl >= 0 ? '+' : ''}${f(x.pnl)} SOL on what was sold` });
      winner.push({ ok: x.mult >= r.minRealizedMult, text: `${x.mult.toFixed(2)}x on the sold part${x.mult < r.minRealizedMult ? `, minimum is ${r.minRealizedMult}x` : ''}` });
      winner.push({ ok: x.buyMc >= r.minEntryMcSol, text: `average buy at ${Math.round(x.buyMc)} SOL market cap` });
    }
  }
  const loser: Check[] = [...base];
  const exited = p.bt > 0 ? p.st / p.bt : 0;
  loser.push({ ok: balanced, text: balanced ? 'tokens bought and sold match' : tokenFlowExplanation(p) });
  const loss = x ? x.cost - x.proceeds : 0;
  if (exited >= 0.9) loser.push({ ok: !!x && loss >= r.minLossSol, text: !x ? 'no sold tokens matched to tracked purchases' : loss > 0 ? `lost ${f(loss)} SOL${loss < r.minLossSol ? `, minimum is ${r.minLossSol}` : ''}` : 'made money on this coin, not a loss' });
  const held = p.ls && p.lb ? p.ls - p.lb : 0;
  loser.push({ ok: held >= r.minHoldSeconds, text: `held ${Math.round(held / 60)} min between last buy and last sell${held < r.minHoldSeconds ? `, minimum is ${Math.round(r.minHoldSeconds / 60)} min` : ''}` });
  return { winner, loser, found: true };
}

export function computeResult(s: CoinState, r: Rules, at: number): CoinResult {
  const junk = coinIsJunk(s, r);
  return {
    mint: s.mint,
    symbol: s.symbol,
    day: s.day,
    dev: s.dev, w: junk ? [] : winnerRows(s, r),
    l: junk ? [] : loserRows(s, r),
    at,
    fin: s.final,
    ...(junk ? { jk: 1 as const } : {}),
    gf: s.gf || 0,
    mig: s.migTime,
    pk: s.stair.length ? s.stair[0][1] * TOTAL_SUPPLY : 0,
    tr: s.trades,
    sp: sparkOf(s),
  };
}

export function packResult(x: CoinResult): string {
  return gzipSync(Buffer.from(JSON.stringify(x)), { level: 6 }).toString('base64');
}
export function unpackResult(b64: string): CoinResult {
  return JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')) as CoinResult;
}

/** Merges all coin results of one day into full ranked lists, one best entry per wallet. */
export function mergeDay(results: CoinResult[], solUsd: number, maxPerCoin = 0): { winners: WinEntry[]; losers: LossEntry[] } {
  const w = new Map<string, WinEntry>();
  const l = new Map<string, LossEntry>();
  for (const c of results) {
    for (const x of c.w) {
      const e: WinEntry = {
        wallet: x.wallet,
        mint: c.mint,
        symbol: c.symbol,
        entryMcUsd: x.entryMc * solUsd,
        peakMcUsd: x.peakMc * solUsd,
        mult: x.mult,
        buySol: x.buySol,
        buyTime: x.buyTime,
        sig: x.sig,
        day: c.day,
        ...(x.pnl !== undefined ? { pnlSol: x.pnl } : {}),
        ...(x.in !== undefined ? { inSol: x.in, outSol: x.out || 0, holding: !!x.hold } : {}),
        ...(x.rz ? { realized: true } : {}),
      };
      const cur = w.get(x.wallet);
      if (!cur || winBetter(e, cur)) w.set(x.wallet, e);
    }
    for (const x of c.l) {
      const e: LossEntry = {
        wallet: x.wallet,
        mint: c.mint,
        symbol: c.symbol,
        buyMcUsd: x.buyMc * solUsd,
        sellMcUsd: x.sellMc * solUsd,
        lossSol: x.lossSol,
        lossPct: x.lossPct,
        buySol: x.buySol,
        sellSol: x.sellSol,
        lastSellTime: x.lastSell,
        day: c.day,
      };
      const cur = l.get(x.wallet);
      if (!cur || lossBetter(e, cur)) l.set(x.wallet, e);
    }
  }
  const cap = <T extends { mint: string }>(list: T[]): T[] => {
    if (!(maxPerCoin > 0)) return list;
    const n = new Map<string, number>();
    return list.filter((e) => {
      const c = (n.get(e.mint) || 0) + 1;
      n.set(e.mint, c);
      return c <= maxPerCoin;
    });
  };
  return { winners: cap(sortWinners([...w.values()])), losers: cap(sortLosers([...l.values()])) };
}

/** realized entries rank by SOL profit, peak entries by multiple */
export const winKey = (e: WinEntry) => (e.realized ? e.pnlSol ?? 0 : e.mult);
export const winBetter = (a: WinEntry, b: WinEntry) => winKey(a) > winKey(b) || (winKey(a) === winKey(b) && a.buyTime < b.buyTime);
export const lossBetter = (a: LossEntry, b: LossEntry) => a.lossSol > b.lossSol;

export function sortWinners(w: WinEntry[]): WinEntry[] {
  return [...w].sort((a, b) => winKey(b) - winKey(a) || b.mult - a.mult || a.buyTime - b.buyTime || (a.wallet < b.wallet ? -1 : 1));
}
export function sortLosers(l: LossEntry[]): LossEntry[] {
  return [...l].sort((a, b) => b.lossSol - a.lossSol || b.lossPct - a.lossPct || (a.wallet < b.wallet ? -1 : 1));
}

/** Rank weights normalised over the entries that exist. */
export function weightsFor(count: number, weights: number[]): number[] {
  const w = weights.slice(0, count);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / sum);
}