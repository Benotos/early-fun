export function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function num(name: string, def: number): number {
  const v = getEnv(name);
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export interface UpstashEnv {
  url: string;
  token: string;
  prefix: string;
}

/** Finds Upstash REST credentials under any prefix Vercel may add. */
export function findUpstash(): UpstashEnv | null {
  const keys = Object.keys(process.env);
  const urlRe = /^(.*?)(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/;
  const tokRe = /^(.*?)(KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN)$/;
  const urls = keys.filter((k) => urlRe.test(k) && getEnv(k));
  const toks = keys.filter((k) => tokRe.test(k) && getEnv(k));
  for (const u of urls) {
    const prefix = u.replace(/(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/, '');
    const t = toks.find((k) => k.startsWith(prefix) && tokRe.exec(k)![1] === prefix);
    if (t) return { url: getEnv(u)!.replace(/\/$/, ''), token: getEnv(t)!, prefix };
  }
  if (urls[0] && toks[0]) {
    return { url: getEnv(urls[0])!.replace(/\/$/, ''), token: getEnv(toks[0])!, prefix: '?' };
  }
  return null;
}

/** Finds Turso credentials under any prefix Vercel may add. */
export function findTurso(): { url: string; token: string } | null {
  const keys = Object.keys(process.env);
  const u = keys.find((k) => /TURSO_DATABASE_URL$/.test(k) && getEnv(k));
  const t = keys.find((k) => /TURSO_AUTH_TOKEN$/.test(k) && getEnv(k));
  if (!u || !t) return null;
  // the web client speaks https, a libsql:// url is the same host
  return { url: getEnv(u)!.replace(/^libsql:\/\//, 'https://'), token: getEnv(t)! };
}

export interface Rules {
  minBuySol: number;
  skipSlots: number;
  minMult: number;
  minLossSol: number;
  minHoldSeconds: number;
  lossCapPct: number;
  payoutWeights: number[];
  winnersShare: number;
  boardSize: number;
  maxPagesPerCoin: number;
  maxCoinsPerScan: number;
  minCoinWallets: number;
  minCoinTrades: number;
  minCurveMcSol: number;
  maxPerCoin: number;
  minEntryMcSol: number;
  maxWalletTrades: number;
  minGlobalFeesSol: number;
  hideMayhem: boolean;
  winRequireSell: boolean;
  /** realized: score = sold value / cost, ranked by SOL profit. peak: buy vs coin peak after it */
  winMode: 'realized' | 'peak';
  minRealizedMult: number;
}

export function rules(): Rules {
  const w = (getEnv('PAYOUT_WEIGHTS') || '35,25,18,12,10')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
  return {
    minBuySol: num('MIN_BUY_SOL', 0.1),
    skipSlots: num('SKIP_SLOTS', 12),
    minMult: num('MIN_MULT', 2),
    minLossSol: num('MIN_LOSS_SOL', 0.1),
    minHoldSeconds: num('MIN_HOLD_SECONDS', 300),
    lossCapPct: num('LOSS_CAP_PCT', 0.25),
    payoutWeights: w.length ? w : [1],
    winnersShare: Math.min(1, Math.max(0, num('WINNERS_SHARE', 0.5))),
    boardSize: num('BOARD_SIZE', 100),
    maxPagesPerCoin: num('MAX_PAGES_PER_COIN_PER_SCAN', 3),
    maxCoinsPerScan: num('MAX_COINS_PER_SCAN', 40),
    minCoinWallets: num('MIN_COIN_WALLETS', 25),
    minCoinTrades: num('MIN_COIN_TRADES', 60),
    minCurveMcSol: num('MIN_CURVE_MC_SOL', 250),
    maxPerCoin: num('MAX_PER_COIN', 3),
    minEntryMcSol: num('MIN_ENTRY_MC_SOL', 20),
    maxWalletTrades: num('MAX_WALLET_TRADES', 40),
    minGlobalFeesSol: num('MIN_GLOBAL_FEES_SOL', 1),
    hideMayhem: getEnv('HIDE_MAYHEM') !== '0',
    winRequireSell: getEnv('WIN_REQUIRE_SELL') !== '0',
    winMode: getEnv('WIN_MODE') === 'peak' ? 'peak' : 'realized',
    minRealizedMult: num('MIN_REALIZED_MULT', 1.2),
  };
}

export const TOTAL_SUPPLY = 1_000_000_000;
export const TOKEN_DECIMALS = 6;
export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const MIGRATION_ACCOUNT = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
export const WSOL = 'So11111111111111111111111111111111111111112';

/** comma separated mint list in BLOCKED_MINTS hides coins from every board */
export function blockedMints(): Set<string> {
  return new Set(
    (getEnv('BLOCKED_MINTS') || '')
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
  );
}