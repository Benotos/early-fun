import { describe, expect, it } from 'vitest';
import { RawTx, TokenBalance } from '../server/lib/chain';
import { WSOL } from '../server/lib/env';
import { needsTickerLookup, resolveWalletTicker, walletTradesFromTransactions } from '../server/lib/wallet-scan';
import { fakeKey } from '../server/testing/fakechain';

function balance(accountIndex: number, mint: string, owner: string, amount: number, decimals: number): TokenBalance {
  return { accountIndex, mint, owner, uiTokenAmount: { amount: String(amount), decimals } };
}

function swapTx(args: {
  wallet: string;
  mint: string;
  slot: number;
  time: number;
  side: 'buy' | 'sell';
  tokens: number;
  sol: number;
  walletTokenBefore?: number;
  tokenDeltaOnly?: boolean;
}): RawTx {
  const buy = args.side === 'buy';
  const preToken = args.walletTokenBefore ?? (buy ? 0 : args.tokens);
  const postToken = buy ? preToken + args.tokens : preToken - args.tokens;
  const preWsol = 5e9;
  const postWsol = buy ? preWsol - args.sol * 1e9 : preWsol + args.sol * 1e9;
  const base = {
    accountIndex: 0,
    mint: args.mint,
    owner: args.wallet,
    uiTokenAmount: { amount: String(Math.round(preToken)), decimals: 6 },
  } satisfies TokenBalance;
  const post = {
    ...base,
    uiTokenAmount: { amount: String(Math.round(postToken)), decimals: 6 },
  } satisfies TokenBalance;
  return {
    slot: args.slot,
    blockTime: args.time,
    transactionIndex: 0,
    transaction: { signatures: [`sig-${args.slot}`], message: { accountKeys: [args.wallet, fakeKey()] } },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10e9, 0],
      postBalances: [10e9 - 5000, 0],
      preTokenBalances: [
        balance(2, WSOL, args.wallet, preWsol, 9),
        ...(args.tokenDeltaOnly ? [] : [base]),
      ],
      postTokenBalances: [
        balance(2, WSOL, args.wallet, postWsol, 9),
        ...(args.tokenDeltaOnly ? [] : [post]),
      ],
    },
  };
}

describe('wallet on-demand transaction scan', () => {
  it('reconstructs SOL quoted buys and sells for a tracked mint', () => {
    const wallet = fakeKey();
    const mint = fakeKey();
    const txs = [
      swapTx({ wallet, mint, slot: 10, time: 100, side: 'buy', sol: 1, tokens: 1_000_000 }),
      swapTx({ wallet, mint, slot: 20, time: 200, side: 'sell', sol: 2, tokens: 1_000_000, walletTokenBefore: 1_000_000 }),
    ];
    const trades = walletTradesFromTransactions(wallet, txs, new Set([mint]), 0);
    expect(trades).toHaveLength(2);
    expect(trades.map((x) => x.side)).toEqual(['buy', 'sell']);
    expect(trades.map((x) => x.mint)).toEqual([mint, mint]);
    expect(trades[0].sol).toBeCloseTo(1, 9);
    expect(trades[1].sol).toBeCloseTo(2, 9);
    expect(trades[1].walletTokenBalanceBefore).toBe(1_000_000);
  });

  it('does not count an incoming token transfer as a purchase', () => {
    const wallet = fakeKey();
    const mint = fakeKey();
    const transfer: RawTx = {
      slot: 10,
      blockTime: 100,
      transaction: { signatures: ['transfer'], message: { accountKeys: [wallet, fakeKey()] } },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [10e9, 0],
        postBalances: [10e9 - 5000, 0],
        preTokenBalances: [],
        postTokenBalances: [balance(2, mint, wallet, 1_000_000, 6)],
      },
    };
    expect(walletTradesFromTransactions(wallet, [transfer], new Set([mint]), 0)).toEqual([]);
  });

  it('discovers a Pump.fun mint from wallet history before global indexing', () => {
    const wallet = fakeKey();
    const mint = 'AyFADPkMeLXJY9gUhwekAKQPf7hcyABKe6yDFZ5Upump';
    const tx = swapTx({ wallet, mint, slot: 10, time: 100, side: 'buy', sol: 1, tokens: 1_000_000 });
    const trades = walletTradesFromTransactions(wallet, [tx], new Set(), 0);
    expect(trades).toHaveLength(1);
    expect(trades[0].mint).toBe(mint);
  });

  it('recognizes a mint fragment as a missing ticker', () => {
    const mint = 'AyFADPkMeLXJY9gUhwekAKQPf7hcyABKe6yDFZ5Upump';
    expect(needsTickerLookup('AYFA', mint)).toBe(true);
    expect(resolveWalletTicker(mint, 'AYFA', 'AYFA')).toBe('AYFA');
    expect(resolveWalletTicker(mint, mint, null)).toBe('UNKNOWN');
  });
});
