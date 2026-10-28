import { RawTx, txKeys } from './chain';
import { TOKEN_DECIMALS, WSOL } from './env';
import { Trade } from './trades';

/**
 * Infer SOL quoted swaps for one wallet from its own transaction history.
 * The result is limited to coin mints that EARLY.FUN is already tracking.
 * Transfers without a corresponding SOL/WSOL outflow are not counted as buys.
 */
export function walletTradesFromTransactions(
  wallet: string,
  txs: RawTx[],
  trackedMints: Set<string>,
  since: number,
): Trade[] {
  const trades: Trade[] = [];
  const ordered = [...txs]
    .filter((tx) => tx.meta && !tx.meta.err && (tx.blockTime ?? 0) >= since)
    .sort((a, b) => a.slot - b.slot || (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0));

  for (const tx of ordered) {
    const meta = tx.meta;
    if (!meta) continue;
    const keys = txKeys(tx);
    const walletIndex = keys.indexOf(wallet);
    if (walletIndex < 0 || walletIndex >= meta.preBalances.length || walletIndex >= meta.postBalances.length) continue;

    const pre = new Map<string, number>();
    const post = new Map<string, number>();
    const decimals = new Map<string, number>();
    const add = (target: Map<string, number>, mint: string, amount: string, d: number) => {
      target.set(mint, (target.get(mint) || 0) + Number(amount));
      decimals.set(mint, d);
    };
    for (const b of meta.preTokenBalances || []) {
      if (b.owner === wallet) add(pre, b.mint, b.uiTokenAmount.amount, b.uiTokenAmount.decimals);
    }
    for (const b of meta.postTokenBalances || []) {
      if (b.owner === wallet) add(post, b.mint, b.uiTokenAmount.amount, b.uiTokenAmount.decimals);
    }

    const wrappedDelta = (post.get(WSOL) || 0) - (pre.get(WSOL) || 0);
    let cashDeltaSol: number;
    if (wrappedDelta !== 0) {
      cashDeltaSol = wrappedDelta / 1e9;
    } else {
      const nativeDelta = (meta.postBalances[walletIndex] - meta.preBalances[walletIndex]) / 1e9;
      const feeSol = keys[0] === wallet ? (Number(meta.fee) || 0) / 1e9 : 0;
      // Add the network fee back to recover the swap's approximate gross SOL
      // movement. For a first buy this can still include account rent; it is
      // deliberately conservative about transfers and ignores fee-sized moves.
      cashDeltaSol = nativeDelta + feeSol;
    }

    if (!Number.isFinite(cashDeltaSol) || Math.abs(cashDeltaSol) < 0.005) continue;

    const discoveredMints = new Set<string>(trackedMints);
    // Pump.fun token mints conventionally end in "pump". Discover these directly
    // from wallet transactions too, so an unindexed coin can still appear on the
    // wallet profile before the global coin backfill reaches it.
    for (const mint of new Set([...pre.keys(), ...post.keys()])) {
      if (mint !== WSOL && mint.endsWith('pump') && decimals.get(mint) === TOKEN_DECIMALS) discoveredMints.add(mint);
    }

    const candidates: { mint: string; delta: number; preBalance?: number }[] = [];
    for (const mint of discoveredMints) {
      if (mint === WSOL) continue;
      const d = (post.get(mint) || 0) - (pre.get(mint) || 0);
      if (!d || decimals.get(mint) !== TOKEN_DECIMALS) continue;
      if ((d > 0 && cashDeltaSol < -0.005) || (d < 0 && cashDeltaSol > 0.005)) {
        candidates.push({ mint, delta: d, ...(pre.has(mint) ? { preBalance: pre.get(mint)! } : {}) });
      }
    }
    // A SOL quote should normally pair with exactly one tracked token mint. If a
    // transaction moves several tracked tokens, do not assign the same SOL twice.
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    const side = candidate.delta > 0 ? 'buy' : 'sell';
    const tokens = Math.abs(candidate.delta);
    const sol = Math.abs(cashDeltaSol);
    const wholeTokens = tokens / 10 ** TOKEN_DECIMALS;
    if (!(wholeTokens > 0) || !(sol > 0)) continue;

    trades.push({
      sig: tx.transaction.signatures[0] || '',
      mint: candidate.mint,
      slot: tx.slot,
      time: tx.blockTime ?? 0,
      wallet,
      side,
      sol,
      tokens,
      price: sol / wholeTokens,
      ...(side === 'sell' && candidate.preBalance !== undefined
        ? { walletTokenBalanceBefore: candidate.preBalance }
        : {}),
    });
  }

  return trades;
}


/** True when a stored symbol is just a mint-address fallback, not a ticker. */
export function needsTickerLookup(symbol: string | null | undefined, mint: string): boolean {
  const value = (symbol || '').trim();
  if (!value || value === mint) return true;
  if (value.toUpperCase() === mint.slice(0, 4).toUpperCase()) return true;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/** Resolve to real metadata where possible; never display a mint address as a ticker. */
export function resolveWalletTicker(
  mint: string,
  existing: string | null | undefined,
  metadata: string | null | undefined,
): string {
  // A metadata API result is authoritative, even if its real ticker coincidentally
  // matches the first four characters of the mint.
  const meta = (metadata || '').trim();
  if (meta && meta !== mint && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(meta)) {
    return meta.toUpperCase().slice(0, 12);
  }
  const value = (existing || '').trim();
  if (
    value &&
    value !== mint &&
    value.toUpperCase() !== mint.slice(0, 4).toUpperCase() &&
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
  ) return value.toUpperCase().slice(0, 12);
  return 'UNKNOWN';
}
