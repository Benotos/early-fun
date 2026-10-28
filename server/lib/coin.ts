import { gunzipSync, gzipSync } from 'node:zlib';
import { Rules } from './env';
import { Trade } from './trades';

export interface BuyCand {
  slot: number;
  time: number;
  price: number;
  sol: number;
  sig: string;
}

/** bs/ss: SOL bought/sold. bt/st: raw tokens bought/sold. fb/lb/ls: first buy, last buy, last sell time. sn: sniper flag */
export interface WalletPnl {
  bs: number;
  ss: number;
  bt: number;
  st: number;
  fb: number;
  lb: number;
  ls: number;
  sn?: 1;
  /** number of trades by this wallet on the coin, bots trade far more than people */
  n?: number;
  /** Remaining purchased-token inventory and its average-cost basis. */
  inventoryTokens?: number;
  inventoryCostSol?: number;
  /** Sell quantity, cost basis, and proceeds matched to tokens this wallet actually bought. */
  matchedSoldTokens?: number;
  matchedSoldCostSol?: number;
  matchedSoldProceedsSol?: number;
}

export type Bar = [number, number, number, number?, number?];

export interface CoinState {
  v: 1;
  mint: string;
  symbol: string;
  name: string;
  curve: string;
  pool: string | null;
  dev: string | null;
  createSlot: number;
  createTime: number;
  migTime: number;
  migSig: string;
  day: string;
  dayEnd: number;
  /** suffix maxima staircase: [slot, price, time], price strictly decreasing */
  stair: [number, number, number][];
  buys: Record<string, BuyCand[]>;
  pnl: Record<string, WalletPnl>;
  curveTok: string | null;
  curveSlot: number; // lower bound (exclusive) of the current query chain
  curveSeen: number; // highest slot seen in the current chain
  curveDone: boolean;
  poolTok: string | null;
  poolSlot: number;
  poolSeen: number;
  poolDone: boolean;
  trades: number;
  /** highest bonding curve trade price, SOL per token (absent on old states) */
  cpk?: number;
  /** global fees paid by traders on this coin, SOL (network fees plus Jito tips) */
  gf?: number;
  /** pump.fun Mayhem Mode coin (undefined until checked) */
  mh?: boolean;
  /** rules version this state was last replayed under */
  rv?: number;
  /** score version this state was last published under; can be upgraded without replaying chain history */
  sv?: number;
  /** Existing published result is retained until the bonding curve has been replayed. */
  rebuildPending?: boolean;
  /** Bypasses age based scan backoff until a historical accounting replay is final. */
  replayAccounting?: boolean;
  /** price path: [bucket, close, high, open, low] in SOL per token (open and low absent on old states) */
  ser: Bar[];
  /** seconds per price bucket, absent on old states (60) */
  sres?: number;
  capped: boolean;
  final: boolean;
  lastScan: number;
}

export const MAX_WALLETS_PER_COIN = 7000;
const MAX_CANDS_PER_WALLET = 8;

export function newCoin(p: {
  mint: string;
  curve: string;
  pool: string | null;
  migTime: number;
  migSig: string;
  day: string;
  dayEnd: number;
  symbol?: string;
  name?: string;
}): CoinState {
  return {
    v: 1,
    mint: p.mint,
    symbol: p.symbol || p.mint.slice(0, 4).toUpperCase(),
    name: p.name || '',
    curve: p.curve,
    pool: p.pool,
    dev: null,
    createSlot: 0,
    createTime: 0,
    migTime: p.migTime,
    migSig: p.migSig,
    day: p.day,
    dayEnd: p.dayEnd,
    stair: [],
    buys: {},
    pnl: {},
    curveTok: null,
    curveSlot: 0,
    curveSeen: 0,
    curveDone: false,
    poolTok: null,
    poolSlot: 0,
    poolSeen: 0,
    poolDone: false,
    trades: 0,
    gf: 0,
    ser: [],
    sres: 1,
    capped: false,
    final: false,
    lastScan: 0,
  };
}

/** Feeds trades (ascending order) into the coin state. */
export function applyTrades(s: CoinState, trades: Trade[], r: Rules): void {
  for (const t of trades) {
    if (t.time >= s.dayEnd) continue; // outside this board's window
    s.trades++;
    {
      const ser = (s.ser ||= []);
      const b = Math.floor(t.time / (s.sres || 60));
      const last = ser[ser.length - 1];
      if (last && last[0] === b) {
        last[4] = Math.min(last[4] ?? last[1], t.price);
        last[1] = t.price;
        if (t.price > last[2]) last[2] = t.price;
      } else {
        const open = last ? last[1] : t.price; // candles open at the previous close, like a DEX chart
        ser.push([b, t.price, Math.max(open, t.price), open, Math.min(open, t.price)]);
        if (ser.length > 5000) {
          const merged: Bar[] = [];
          for (let i = 0; i < ser.length; i += 2) {
            const a = ser[i];
            const c = ser[i + 1];
            merged.push(c ? [a[0], c[1], Math.max(a[2], c[2]), a[3] ?? a[1], Math.min(a[4] ?? a[1], c[4] ?? c[1])] : a);
          }
          s.ser = merged;
        }
      }
    }
    const inSkip = s.createSlot > 0 && t.slot <= s.createSlot + r.skipSlots;
    if (inSkip) {
      if (t.side === 'buy') {
        const p = (s.pnl[t.wallet] ||= blank());
        p.sn = 1;
      }
      continue;
    }

    // staircase of suffix maxima
    const st = s.stair;
    while (st.length && st[st.length - 1][1] <= t.price) st.pop();
    st.push([t.slot, t.price, t.time]);

    if (s.dev && t.wallet === s.dev) continue;

    const known = t.wallet in s.pnl;
    if (!known && Object.keys(s.pnl).length >= MAX_WALLETS_PER_COIN) {
      s.capped = true;
      continue;
    }
    const p = (s.pnl[t.wallet] ||= blank());
    p.n = (p.n || 0) + 1;
    if (t.side === 'buy') {
      p.bs += t.sol;
      p.bt += t.tokens;
      p.inventoryTokens = (p.inventoryTokens || 0) + t.tokens;
      p.inventoryCostSol = (p.inventoryCostSol || 0) + t.sol;
      if (!p.fb) p.fb = t.time;
      p.lb = t.time;
      if (t.sol >= r.minBuySol) {
        const list = (s.buys[t.wallet] ||= []);
        const last = list[list.length - 1];
        if (!last || t.price < last.price) {
          list.push({ slot: t.slot, time: t.time, price: t.price, sol: t.sol, sig: t.sig });
          if (list.length > MAX_CANDS_PER_WALLET) list.shift();
        }
      }
    } else {
      p.ss += t.sol;
      p.st += t.tokens;
      p.ls = t.time;

      // Count only the portion of a sale that can be matched to tokens previously
      // bought by this wallet through the tracked venue. Any excess sale quantity
      // may have come from a transfer and must not generate fabricated profit.
      const inventoryTokens = p.inventoryTokens || 0;
      const inventoryCostSol = p.inventoryCostSol || 0;
      if (inventoryTokens > 0 && t.tokens > 0) {
        const matchedTokens = Math.min(t.tokens, inventoryTokens);
        const matchedCost = inventoryCostSol * (matchedTokens / inventoryTokens);
        const matchedProceeds = t.sol * (matchedTokens / t.tokens);
        p.matchedSoldTokens = (p.matchedSoldTokens || 0) + matchedTokens;
        p.matchedSoldCostSol = (p.matchedSoldCostSol || 0) + matchedCost;
        p.matchedSoldProceedsSol = (p.matchedSoldProceedsSol || 0) + matchedProceeds;
        p.inventoryTokens = Math.max(0, inventoryTokens - matchedTokens);
        p.inventoryCostSol = Math.max(0, inventoryCostSol - matchedCost);
      }
    }
  }
}

function blank(): WalletPnl {
  return {
    bs: 0, ss: 0, bt: 0, st: 0, fb: 0, lb: 0, ls: 0,
    inventoryTokens: 0,
    inventoryCostSol: 0,
    matchedSoldTokens: 0,
    matchedSoldCostSol: 0,
    matchedSoldProceedsSol: 0,
  };
}

export interface WalletCoinLedger {
  pnl: WalletPnl;
  buys: BuyCand[];
}

/**
 * Accumulate one wallet independently from the compact coin state.
 * This ledger is persisted separately so size limits on a coin's main state
 * cannot silently erase a wallet's trade history.
 */
export function applyWalletLedgerTrades(
  s: Pick<CoinState, 'dayEnd' | 'createSlot' | 'dev'>,
  record: WalletCoinLedger,
  trades: Trade[],
  r: Rules
): void {
  const p = record.pnl;
  for (const t of trades) {
    if (t.time >= s.dayEnd || (s.dev && t.wallet === s.dev)) continue;
    const inSkip = s.createSlot > 0 && t.slot <= s.createSlot + r.skipSlots;
    if (inSkip) {
      if (t.side === 'buy') p.sn = 1;
      continue;
    }

    p.n = (p.n || 0) + 1;
    if (t.side === 'buy') {
      p.bs += t.sol;
      p.bt += t.tokens;
      p.inventoryTokens = (p.inventoryTokens || 0) + t.tokens;
      p.inventoryCostSol = (p.inventoryCostSol || 0) + t.sol;
      if (!p.fb) p.fb = t.time;
      p.lb = t.time;
      if (t.sol >= r.minBuySol) {
        const last = record.buys[record.buys.length - 1];
        if (!last || t.price < last.price) {
          record.buys.push({ slot: t.slot, time: t.time, price: t.price, sol: t.sol, sig: t.sig });
          if (record.buys.length > MAX_CANDS_PER_WALLET) record.buys.shift();
        }
      }
    } else {
      p.ss += t.sol;
      p.st += t.tokens;
      p.ls = t.time;
      const inventoryTokens = p.inventoryTokens || 0;
      const inventoryCostSol = p.inventoryCostSol || 0;
      if (inventoryTokens > 0 && t.tokens > 0) {
        const matchedTokens = Math.min(t.tokens, inventoryTokens);
        const matchedCost = inventoryCostSol * (matchedTokens / inventoryTokens);
        const matchedProceeds = t.sol * (matchedTokens / t.tokens);
        p.matchedSoldTokens = (p.matchedSoldTokens || 0) + matchedTokens;
        p.matchedSoldCostSol = (p.matchedSoldCostSol || 0) + matchedCost;
        p.matchedSoldProceedsSol = (p.matchedSoldProceedsSol || 0) + matchedProceeds;
        p.inventoryTokens = Math.max(0, inventoryTokens - matchedTokens);
        p.inventoryCostSol = Math.max(0, inventoryCostSol - matchedCost);
      }
    }
  }
}

/** Highest price at or after the given slot. */
export function peakAfter(s: CoinState, slot: number): { price: number; time: number } | null {
  for (const e of s.stair) if (e[0] >= slot) return { price: e[1], time: e[2] };
  return null;
}

export function packState(s: CoinState): string {
  return gzipSync(Buffer.from(JSON.stringify(s)), { level: 6 }).toString('base64');
}

export function unpackState(b64: string): CoinState {
  return JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')) as CoinState;
}

/** Downsamples the price path into n time bins, value is the high of each bin. Times in unix seconds. */
export function seriesBins(s: CoinState, n: number): [number, number][] {
  const ser = s.ser || [];
  if (!ser.length) return [];
  const R = s.sres || 60;
  if (ser.length <= n) return ser.map((e) => [e[0] * R, e[2]] as [number, number]);
  const t0 = ser[0][0] * R;
  const t1 = ser[ser.length - 1][0] * R + R;
  const step = (t1 - t0) / n;
  const out: [number, number][] = [];
  let j = 0;
  let last = ser[0][1];
  for (let i = 0; i < n; i++) {
    const hi = t0 + (i + 1) * step;
    let m = 0;
    while (j < ser.length && ser[j][0] * R < hi) {
      m = Math.max(m, ser[j][2]);
      last = ser[j][1];
      j++;
    }
    out.push([Math.round(t0 + (i + 0.5) * step), m > 0 ? m : last]);
  }
  return out;
}

/** 0..1 log scaled sparkline values. */
export function sparkOf(s: CoinState, n = 32): number[] {
  const b = seriesBins(s, n);
  if (b.length < 2) return [];
  const lg = b.map((x) => Math.log(x[1]));
  const min = Math.min(...lg);
  const max = Math.max(...lg);
  if (max - min < 1e-9) return lg.map(() => 0.5);
  return lg.map((v) => Math.round(((v - min) / (max - min)) * 1000) / 1000);
}

/** OHLC candles [time, open, high, low, close] in SOL per token, at most n of them, on a fixed time grid. */
export function candleBins(s: CoinState, n: number): [number, number, number, number, number][] {
  const ser = s.ser || [];
  if (!ser.length) return [];
  const R = s.sres || 60;
  const t0 = ser[0][0] * R;
  const t1 = ser[ser.length - 1][0] * R + R;
  // pick a round candle size that gives at most n candles, never finer than the stored buckets
  const sizes = [1, 5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].filter((x) => x >= R);
  const step = sizes.find((x) => (t1 - t0) / x <= n) ?? sizes[sizes.length - 1];
  const out: [number, number, number, number, number][] = [];
  let prevClose = ser[0][3] ?? ser[0][1];
  let cur: [number, number, number, number, number] | null = null;
  for (const e of ser) {
    const t = Math.floor((e[0] * R) / step) * step;
    const o = e[3] ?? prevClose;
    const h = Math.max(e[2], o);
    const l = Math.min(e[4] ?? Math.min(o, e[1]), o);
    if (!cur || cur[0] !== t) {
      if (cur) out.push(cur);
      cur = [t, o, h, l, e[1]];
    } else {
      cur[2] = Math.max(cur[2], h);
      cur[3] = Math.min(cur[3], l);
      cur[4] = e[1];
    }
    prevClose = e[1];
  }
  if (cur) out.push(cur);
  return out.slice(-n);
}

/** Every stored bucket as a candle [time, open, high, low, close], SOL per token. The page groups them into timeframes. */
export function rawBars(s: CoinState): [number, number, number, number, number][] {
  const R = s.sres || 60;
  const out: [number, number, number, number, number][] = [];
  let prev: number | null = null;
  for (const e of s.ser || []) {
    const o = e[3] ?? prev ?? e[1];
    out.push([e[0] * R, o, Math.max(e[2], o), Math.min(e[4] ?? Math.min(o, e[1]), o), e[1]]);
    prev = e[1];
  }
  return out;
}