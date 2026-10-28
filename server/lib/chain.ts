import { PublicKey } from '@solana/web3.js';
import { getEnv, MIGRATION_ACCOUNT, PUMP_PROGRAM, WSOL } from './env';

const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface RawTx {
  slot: number;
  blockTime: number | null;
  transactionIndex?: number;
  transaction: {
    signatures: string[];
    message: { accountKeys: (string | { pubkey: string; signer?: boolean })[] };
  };
  meta: {
    err: unknown;
    fee?: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
}

export interface SigInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

export interface TxPage {
  txs: RawTx[];
  next: string | null;
}

export interface TxQuery {
  sort: 'asc' | 'desc';
  limit?: number;
  token?: string | null;
  slotGt?: number;
  blockTimeLt?: number;
}

export interface Chain {
  probe(): Promise<{ ok: boolean; detail: string }>;
  listMigrations(opts: { untilSig?: string | null; minTime: number; maxPages?: number }): Promise<SigInfo[]>;
  getTx(sig: string): Promise<RawTx | null>;
  txsForAddress(address: string, q: TxQuery): Promise<TxPage>;
  tokenMeta(mint: string): Promise<{ symbol: string; name: string } | null>;
  solUsd(): Promise<number>;
  /** earliest SOL funder of a wallet, null if none found */
  firstFunder(wallet: string): Promise<string | null>;
  /** true for exchange like or router like wallets with huge activity */
  isHub(address: string): Promise<boolean>;
  /** pump.fun Mayhem Mode flag from the bonding curve account, null if the account is unreadable */
  isMayhem?(curve: string): Promise<boolean | null>;
}

export class ChainError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HeliusChain implements Chain {
  private url: string;
  private lastCall = 0;
  private hardDeadline = 0;

  /** no RPC call or retry may run past this epoch ms */
  setDeadline(t: number) {
    this.hardDeadline = t;
  }

  constructor(apiKey?: string) {
    const key = apiKey || getEnv('HELIUS_API_KEY');
    if (!key) throw new ChainError('no_rpc_key', 'HELIUS_API_KEY is not set');
    this.url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  }

  private async rpc<T = any>(method: string, params: unknown, timeoutMs = 30000): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      // soft spacing so a free key does not trip 429 immediately
      let tmo = timeoutMs;
      if (this.hardDeadline) {
        const left = this.hardDeadline - Date.now();
        if (left < 1500) throw lastErr instanceof Error ? lastErr : new ChainError('rpc_deadline', 'scan time budget used up');
        tmo = Math.min(timeoutMs, left);
      }
      const gap = Date.now() - this.lastCall;
      if (gap < 120) await sleep(120 - gap);
      this.lastCall = Date.now();
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(tmo),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ChainError('rpc_http_' + res.status, `RPC ${method} returned ${res.status}`);
          await sleep(600 * (attempt + 1) ** 2);
          continue;
        }
        const json: any = await res.json();
        if (json.error) {
          throw new ChainError('rpc_error', `RPC ${method}: ${json.error.message || JSON.stringify(json.error)}`);
        }
        return json.result as T;
      } catch (e) {
        lastErr = e;
        if (e instanceof ChainError && e.code === 'rpc_error') throw e;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new ChainError('rpc_failed', `RPC ${method} failed`);
  }

  async probe() {
    try {
      const r: any = await this.rpc('getAccountInfo', [PUMP_PROGRAM, { encoding: 'base64' }], 12000);
      const ok = !!r?.value && r.value.executable === true;
      return { ok, detail: ok ? 'pump.fun program account found' : 'pump.fun program account not found, wrong key or network?' };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async listMigrations(opts: { untilSig?: string | null; minTime: number; maxPages?: number }) {
    const out: SigInfo[] = [];
    let before: string | undefined;
    for (let page = 0; page < (opts.maxPages ?? 5); page++) {
      const cfg: Record<string, unknown> = { limit: 1000, commitment: 'finalized' };
      if (before) cfg.before = before;
      if (opts.untilSig) cfg.until = opts.untilSig;
      const rows: SigInfo[] = await this.rpc('getSignaturesForAddress', [MIGRATION_ACCOUNT, cfg]);
      if (!rows.length) break;
      let reachedOld = false;
      for (const r of rows) {
        if (r.blockTime !== null && r.blockTime < opts.minTime) {
          reachedOld = true;
          break;
        }
        if (!r.err) out.push(r);
      }
      if (reachedOld || rows.length < 1000) break;
      before = rows[rows.length - 1].signature;
    }
    return out; // newest first
  }

  async getTx(sig: string) {
    const r = await this.rpc<RawTx | null>('getTransaction', [
      sig,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'finalized' },
    ]);
    return r || null;
  }

  async txsForAddress(address: string, q: TxQuery): Promise<TxPage> {
    const filters: Record<string, unknown> = { status: 'succeeded' };
    if (q.slotGt !== undefined && q.slotGt > 0) filters.slot = { gt: q.slotGt };
    if (q.blockTimeLt !== undefined) filters.blockTime = { lt: q.blockTimeLt };
    const cfg: Record<string, unknown> = {
      transactionDetails: 'full',
      sortOrder: q.sort,
      limit: q.limit ?? 1000,
      commitment: 'finalized',
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 1,
      filters,
    };
    if (q.token) cfg.paginationToken = q.token;
    const r: any = await this.rpc('getTransactionsForAddress', [address, cfg], 60000);
    const data: any[] = r?.data || [];
    return { txs: data as RawTx[], next: r?.paginationToken || null };
  }

  async tokenMeta(mint: string) {
    // Ask Helius DAS first because it may already have the off-chain token metadata indexed.
    try {
      const r: any = await this.rpc('getAsset', { id: mint }, 12000);
      const m = r?.content?.metadata;
      const symbol = String(m?.symbol || r?.token_info?.symbol || '').trim();
      if (symbol) return { symbol: symbol.replace(/\0/g, '').slice(0, 12), name: String(m?.name || symbol).trim().slice(0, 40) };
    } catch {
      // Fall back to the on-chain Metaplex metadata account below.
    }

    // Pump.fun coins can have valid on-chain Metaplex symbols before indexers
    // have populated their token tables. Derive the metadata PDA and read the
    // name/symbol strings directly from its binary account data.
    try {
      const metadataAddress = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
        TOKEN_METADATA_PROGRAM
      )[0].toBase58();
      const account: any = await this.rpc('getAccountInfo', [
        metadataAddress,
        { encoding: 'base64', commitment: 'finalized' },
      ], 8000);
      const encoded = account?.value?.data?.[0];
      if (typeof encoded !== 'string') return null;
      const data = Buffer.from(encoded, 'base64');
      // Key (1) + update authority (32) + mint (32), then Borsh strings.
      let offset = 65;
      if (data.length < offset + 4) return null;
      const nameLength = data.readUInt32LE(offset);
      offset += 4;
      if (nameLength > 512 || offset + nameLength + 4 > data.length) return null;
      const name = data.subarray(offset, offset + nameLength).toString('utf8').replace(/\0/g, '').trim();
      offset += nameLength;
      const symbolLength = data.readUInt32LE(offset);
      offset += 4;
      if (symbolLength > 128 || offset + symbolLength > data.length) return null;
      const symbol = data.subarray(offset, offset + symbolLength).toString('utf8').replace(/\0/g, '').trim();
      if (!symbol) return null;
      return { symbol: symbol.slice(0, 12), name: (name || symbol).slice(0, 40) };
    } catch {
      return null;
    }
  }

  async solUsd() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
        signal: AbortSignal.timeout(8000),
      });
      const j: any = await res.json();
      const p = Number(j?.solana?.usd);
      if (p > 1) return p;
    } catch {
      /* fall through */
    }
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`, { signal: AbortSignal.timeout(8000) });
    const j: any = await res.json();
    const p = Number(j?.[WSOL]?.usdPrice);
    if (!(p > 1)) throw new ChainError('no_sol_price', 'could not fetch SOL price');
    return p;
  }

  async firstFunder(wallet: string) {
    const page = await this.txsForAddress(wallet, { sort: 'asc', limit: 10 });
    return findFunder(wallet, page.txs);
  }

  async isMayhem(curve: string): Promise<boolean | null> {
    // BondingCurve: 8 discriminator, 5 x u64 reserves and supply, bool complete, 32 byte creator, bool is_mayhem_mode
    const r: any = await this.rpc('getAccountInfo', [curve, { encoding: 'base64' }], 12000);
    const b64 = r?.value?.data?.[0];
    if (typeof b64 !== 'string') return null;
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 82) return false; // older curves have no flag, never mayhem
    return buf[81] === 1;
  }

  async isHub(address: string) {
    const rows: any[] = await this.rpc('getSignaturesForAddress', [address, { limit: 1000, commitment: 'finalized' }]);
    return rows.length >= 1000;
  }
}

export function txKeys(tx: RawTx): string[] {
  const ks = tx.transaction.message.accountKeys;
  const base = ks.map((k) => (typeof k === 'string' ? k : k.pubkey));
  const la = tx.meta?.loadedAddresses;
  // jsonParsed already lists loaded addresses inline; json encoding does not
  if (la && ks.length && typeof ks[0] === 'string') return base.concat(la.writable || [], la.readonly || []);
  return base;
}

/** First transaction where the wallet's SOL balance went up and someone else signed. */
export function findFunder(wallet: string, txs: RawTx[]): string | null {
  for (const tx of txs) {
    if (!tx.meta || tx.meta.err) continue;
    const keys = txKeys(tx);
    const i = keys.indexOf(wallet);
    if (i < 0) continue;
    if (tx.meta.postBalances[i] > tx.meta.preBalances[i] && keys[0] !== wallet) return keys[0];
  }
  return null;
}