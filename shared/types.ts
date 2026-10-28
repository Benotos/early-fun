export type Range = 'today' | 'yesterday' | 'week';

export interface WinEntry {
  wallet: string;
  mint: string;
  symbol: string;
  entryMcUsd: number;
  peakMcUsd: number;
  mult: number;
  buySol: number;
  buyTime: number;
  sig: string;
  day: string;
  /** realized profit in SOL on this coin (sells minus the cost of what was sold), absent while still holding */
  pnlSol?: number;
  /** total SOL spent on the coin, total SOL received from sells, still holding part of the bag */
  inSol?: number;
  outSol?: number;
  holding?: boolean;
  /** realized entry: entryMcUsd is the average buy, peakMcUsd the average sell, mult = sold value / cost */
  realized?: boolean;
}

export interface LossEntry {
  wallet: string;
  mint: string;
  symbol: string;
  buyMcUsd: number;
  sellMcUsd: number;
  lossSol: number;
  lossPct: number; // 0..100
  buySol: number;
  sellSol: number;
  lastSellTime: number;
  day: string;
}

export interface BoardMeta {
  updatedAt: number;
  solUsd: number;
  resetAt: number;
  days: string[];
  coins: number;
  final: boolean;
}

export interface BoardResponse {
  ok: true;
  range: Range;
  meta: BoardMeta;
  winners: WinEntry[];
  losers: LossEntry[];
  warming?: boolean;
}

export interface RankedWin extends WinEntry {
  rank: number;
  total: number;
  onBoard: boolean;
}
export interface RankedLoss extends LossEntry {
  rank: number;
  total: number;
  onBoard: boolean;
}

export interface WalletResponse {
  ok: true;
  address: string;
  wins: RankedWin[];
  losses: RankedLoss[];
}

export interface ShareCard {
  id: string;
  type: 'win' | 'loss';
  win?: WinEntry;
  loss?: LossEntry;
  createdAt: number;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string; hint?: string };
}

export interface CoinSummary {
  mint: string;
  symbol: string;
  day: string;
  mig: number;
  peakMcUsd: number;
  trades: number;
  wCount: number;
  topMult: number;
  topEntryMcUsd: number;
  lCount: number;
  topLossSol: number;
  /** true when the top entry passed the funding checks, false when it is the raw leader */
  verified: boolean;
  spark: number[];
}

export interface Records {
  updatedAt: number;
  win: WinEntry[];
  loss: LossEntry[];
}

export interface PulseResponse {
  ok: true;
  updatedAt: number;
  solUsd: number;
  coins: CoinSummary[];
  records: Records | null;
}

export interface CoinWinRow {
  wallet: string;
  mult: number;
  entryMcUsd: number;
  peakMcUsd: number;
  buySol: number;
  buyTime: number;
  onBoard: boolean;
  pnlSol?: number;
  /** total SOL spent on the coin, total SOL received from sells, still holding part of the bag */
  inSol?: number;
  outSol?: number;
  holding?: boolean;
  /** realized entry: entryMcUsd is the average buy, peakMcUsd the average sell, mult = sold value / cost */
  realized?: boolean;
}
export interface CoinLossRow {
  wallet: string;
  lossSol: number;
  lossPct: number;
  buyMcUsd: number;
  sellMcUsd: number;
  buySol?: number;
  sellSol?: number;
  onBoard: boolean;
}
export interface CoinResponse {
  ok: true;
  coin: {
    mint: string;
    symbol: string;
    day: string;
    mig: number;
    dev: string | null;
    peakMcUsd: number;
    trades: number;
    final: boolean;
    wCount: number;
    lCount: number;
  };
  /** candles: [unix seconds, open, high, low, close] market cap in USD */
  chart: [number, number, number, number, number][];
  winners: CoinWinRow[];
  losers: CoinLossRow[];
}

export interface WalletCheck {
  ok: boolean;
  text: string;
}
export interface WalletCheckResponse {
  ok: true;
  tracked: boolean;
  symbol?: string;
  coinIssues: string[];
  scan: { trades: number; complete: boolean };
  found: boolean;
  winner: WalletCheck[];
  loser: WalletCheck[];
  winRank: number | null;
  lossRank: number | null;
  verdict: string;
}