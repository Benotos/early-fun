import { PublicKey } from '@solana/web3.js';
import { Chain, RawTx, SigInfo, TokenBalance, TxPage, TxQuery, txKeys } from '../lib/chain';
import { MIGRATION_ACCOUNT, WSOL } from '../lib/env';
import { curveAddress } from '../lib/pda';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let counter = 0;
export function fakeKey(r: () => number = Math.random): string {
  const b = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) b[i] = Math.floor(r() * 256);
  b[0] = (counter++ & 0xff) | 1; // keep unique even with a tiny seed
  return new PublicKey(b).toBase58();
}
export const fakeSig = (r: () => number = Math.random) => fakeKey(r) + fakeKey(r).slice(0, 44);

const FEE = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM';
const SYS = '11111111111111111111111111111111';

const tb = (accountIndex: number, mint: string, owner: string, amount: number): TokenBalance => ({
  accountIndex,
  mint,
  owner,
  uiTokenAmount: { amount: String(Math.round(amount)), decimals: mint === WSOL ? 9 : 6 },
});

interface TradeOpts {
  sig: string;
  slot: number;
  time: number;
  wallet: string;
  mint: string;
  address: string; // curve or pool
  side: 'buy' | 'sell';
  sol: number;
  tokens: number; // raw units
  index?: number;
}

export function mkCurveTx(o: TradeOpts): RawTx {
  const lam = Math.round(o.sol * 1e9);
  const buy = o.side === 'buy';
  const keys = [o.wallet, o.address, FEE, SYS];
  const pre = [10e9, 5e9, 1e9, 1];
  const post = [buy ? 10e9 - lam - 5000 : 10e9 + lam - 5000, buy ? 5e9 + lam : 5e9 - lam, 1e9 + 100, 1];
  const cpre = 700_000_000e6;
  return {
    slot: o.slot,
    blockTime: o.time,
    transactionIndex: o.index ?? 0,
    transaction: { signatures: [o.sig], message: { accountKeys: keys.map((pubkey, i) => ({ pubkey, signer: i === 0 })) } },
    meta: {
      err: null,
      preBalances: pre,
      postBalances: post,
      preTokenBalances: [tb(4, o.mint, o.address, cpre), tb(5, o.mint, o.wallet, buy ? 0 : o.tokens)],
      postTokenBalances: [
        tb(4, o.mint, o.address, buy ? cpre - o.tokens : cpre + o.tokens),
        tb(5, o.mint, o.wallet, buy ? o.tokens : 0),
      ],
    },
  };
}

export function mkAmmTx(o: TradeOpts): RawTx {
  const lamQ = Math.round(o.sol * 1e9);
  const buy = o.side === 'buy';
  const keys = [o.wallet, o.address, FEE, SYS];
  const base = 200_000_000e6;
  const quote = 80e9;
  return {
    slot: o.slot,
    blockTime: o.time,
    transactionIndex: o.index ?? 0,
    transaction: { signatures: [o.sig], message: { accountKeys: keys.map((pubkey, i) => ({ pubkey, signer: i === 0 })) } },
    meta: {
      err: null,
      preBalances: [10e9, 1e6, 1e9, 1],
      postBalances: [10e9 - 5000, 1e6, 1e9, 1],
      preTokenBalances: [
        tb(4, o.mint, o.address, base),
        tb(5, WSOL, o.address, quote),
        tb(6, o.mint, o.wallet, buy ? 0 : o.tokens),
      ],
      postTokenBalances: [
        tb(4, o.mint, o.address, buy ? base - o.tokens : base + o.tokens),
        tb(5, WSOL, o.address, buy ? quote + lamQ : quote - lamQ),
        tb(6, o.mint, o.wallet, buy ? o.tokens : 0),
      ],
    },
  };
}

export function mkCreateTx(p: { sig: string; slot: number; time: number; dev: string; mint: string; curve: string }): RawTx {
  return {
    slot: p.slot,
    blockTime: p.time,
    transactionIndex: 0,
    transaction: { signatures: [p.sig], message: { accountKeys: [p.dev, p.curve, p.mint, SYS].map((pubkey, i) => ({ pubkey, signer: i === 0 })) } },
    meta: {
      err: null,
      preBalances: [5e9, 0, 0, 1],
      postBalances: [4e9, 2e6, 1e6, 1],
      preTokenBalances: [],
      postTokenBalances: [tb(4, p.mint, p.curve, 793_100_000e6)],
    },
  };
}

export function mkMigrationTx(p: { sig: string; slot: number; time: number; mint: string; curve: string; pool: string }): RawTx {
  const keys = [MIGRATION_ACCOUNT, p.curve, p.mint, p.pool, SYS];
  return {
    slot: p.slot,
    blockTime: p.time,
    transactionIndex: 0,
    transaction: { signatures: [p.sig], message: { accountKeys: keys.map((pubkey, i) => ({ pubkey, signer: i === 0 })) } },
    meta: {
      err: null,
      preBalances: [5e9, 85e9, 1, 0, 1],
      postBalances: [5e9, 2e6, 1, 1e6, 1],
      preTokenBalances: [tb(5, p.mint, p.curve, 206_900_000e6)],
      postTokenBalances: [
        tb(5, p.mint, p.curve, 0),
        tb(6, p.mint, p.pool, 206_900_000e6),
        tb(7, WSOL, p.pool, 80e9),
        tb(8, p.mint, MIGRATION_ACCOUNT, 0), // stray empty account, must not confuse the parser
      ],
    },
  };
}

export function mkFundTx(p: { sig: string; slot: number; time: number; funder: string; wallet: string; sol: number }): RawTx {
  return {
    slot: p.slot,
    blockTime: p.time,
    transactionIndex: 0,
    transaction: { signatures: [p.sig], message: { accountKeys: [p.funder, p.wallet, SYS].map((pubkey, i) => ({ pubkey, signer: i === 0 })) } },
    meta: {
      err: null,
      preBalances: [50e9, 0, 1],
      postBalances: [50e9 - Math.round(p.sol * 1e9) - 5000, Math.round(p.sol * 1e9), 1],
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
}

export class FakeChain implements Chain {
  txs: RawTx[] = [];
  migs: SigInfo[] = [];
  byMint = new Map<string, { symbol: string; name: string }>();
  funders = new Map<string, string | null>();
  hubs = new Set<string>();
  probeOk = true;
  price = 150;
  pageSize = 1000;
  fundingFails = false;
  calls = { txsForAddress: 0, firstFunder: 0 };

  addTx(tx: RawTx) {
    this.txs.push(tx);
  }

  async probe() {
    return this.probeOk ? { ok: true, detail: 'fake ok' } : { ok: false, detail: 'fake rpc broken' };
  }

  async listMigrations(o: { untilSig?: string | null; minTime: number; maxPages?: number }) {
    const sorted = [...this.migs].sort((a, b) => b.slot - a.slot);
    const out: SigInfo[] = [];
    for (const m of sorted) {
      if (o.untilSig && m.signature === o.untilSig) break;
      if ((m.blockTime ?? 0) < o.minTime) break;
      out.push(m);
    }
    return out;
  }

  async getTx(sig: string) {
    return this.txs.find((t) => t.transaction.signatures[0] === sig) || null;
  }

  async txsForAddress(address: string, q: TxQuery): Promise<TxPage> {
    this.calls.txsForAddress++;
    let list = this.txs.filter((t) => txKeys(t).includes(address));
    if (q.slotGt) list = list.filter((t) => t.slot > q.slotGt!);
    if (q.blockTimeLt !== undefined) list = list.filter((t) => (t.blockTime ?? 0) < q.blockTimeLt!);
    list.sort((a, b) => a.slot - b.slot || (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0));
    if (q.sort === 'desc') list.reverse();
    const off = q.token ? Number(q.token.split(':')[1]) : 0;
    const size = Math.min(q.limit ?? 1000, this.pageSize);
    const slice = list.slice(off, off + size);
    const next = off + size < list.length ? `p:${off + size}` : null;
    return { txs: slice, next };
  }

  async tokenMeta(mint: string) {
    return this.byMint.get(mint) || null;
  }
  async solUsd() {
    return this.price;
  }
  async firstFunder(wallet: string) {
    this.calls.firstFunder++;
    if (this.fundingFails) throw new Error('funding lookup failed');
    return this.funders.get(wallet) ?? null;
  }
  async isHub(a: string) {
    return this.hubs.has(a);
  }
}

export interface FakeCoin {
  mint: string;
  curve: string;
  pool: string;
  dev: string;
  symbol: string;
  createSlot: number;
  createTime: number;
  migTime: number;
  slotAt: (t: number) => number;
  buy: (wallet: string, sol: number, mcSol: number, t: number, venue?: 'curve' | 'amm') => void;
  sell: (wallet: string, sol: number, mcSol: number, t: number, venue?: 'curve' | 'amm') => void;
}

/** Builds synthetic coins on a FakeChain. mcSol is the market cap in SOL at the trade (price x 1e9). */
export function addCoin(
  chain: FakeChain,
  p: { symbol: string; dev?: string; createTime: number; migTime: number; seed?: number }
): FakeCoin {
  const r = rng(p.seed ?? 7);
  const mint = fakeKey(r);
  const curve = curveAddress(mint);
  const pool = fakeKey(r);
  const dev = p.dev ?? fakeKey(r);
  const baseSlot = 300_000_000 + Math.floor((p.createTime % 1_000_000) * 2.5);
  const slotAt = (t: number) => baseSlot + Math.round((t - p.createTime) * 2.5);
  chain.byMint.set(mint, { symbol: p.symbol, name: p.symbol + ' coin' });

  chain.addTx(mkCreateTx({ sig: fakeSig(r), slot: slotAt(p.createTime), time: p.createTime, dev, mint, curve }));
  const migSig = fakeSig(r);
  chain.addTx(mkMigrationTx({ sig: migSig, slot: slotAt(p.migTime), time: p.migTime, mint, curve, pool }));
  chain.migs.push({ signature: migSig, slot: slotAt(p.migTime), blockTime: p.migTime, err: null });
  // the curve account appears in the migration tx so the curve tx list contains it too (ignored as a trade)

  let idx = 1;
  const trade = (side: 'buy' | 'sell') => (wallet: string, sol: number, mcSol: number, t: number, venue?: 'curve' | 'amm') => {
    const v = venue ?? (t < p.migTime ? 'curve' : 'amm');
    const price = mcSol / 1e9; // SOL per whole token
    const tokens = (sol / price) * 1e6;
    const o: TradeOpts = {
      sig: fakeSig(r),
      slot: slotAt(t),
      time: t,
      wallet,
      mint,
      address: v === 'curve' ? curve : pool,
      side,
      sol,
      tokens,
      index: idx++,
    };
    chain.addTx(v === 'curve' ? mkCurveTx(o) : mkAmmTx(o));
  };
  return {
    mint,
    curve,
    pool,
    dev,
    symbol: p.symbol,
    createSlot: slotAt(p.createTime),
    createTime: p.createTime,
    migTime: p.migTime,
    slotAt,
    buy: trade('buy'),
    sell: trade('sell'),
  };
}
