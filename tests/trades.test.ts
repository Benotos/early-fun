import { describe, expect, it } from 'vitest';
import { findFunder, txKeys } from '../server/lib/chain';
import { applyTrades, newCoin } from '../server/lib/coin';
import { explainWallet, realizedOf, realizedRows, tokenFlowBalanced } from '../server/lib/scoring';
import { extractTrade, parseMigration, pumpGlobalFeeSolForTrade } from '../server/lib/trades';
import { rules, WSOL } from '../server/lib/env';
import { curveAddress } from '../server/lib/pda';
import { fakeKey, mkAmmTx, mkCreateTx, mkCurveTx, mkFundTx, mkMigrationTx, fakeSig } from '../server/testing/fakechain';

const mint = fakeKey();
const curve = curveAddress(mint);
const pool = fakeKey();
const wallet = fakeKey();
const base = { sig: 's', slot: 100, time: 1000, wallet, mint };

describe('Pump global fee accounting', () => {
  it('uses protocol fees rather than Solana network fees', () => {
    expect(pumpGlobalFeeSolForTrade({ sol: 10, price: 300 / 1_000_000_000 }, 'curve')).toBeCloseTo(0.095, 9);
    expect(pumpGlobalFeeSolForTrade({ sol: 10, price: 300 / 1_000_000_000 }, 'amm')).toBeCloseTo(0.093, 9);
    expect(pumpGlobalFeeSolForTrade({ sol: 10, price: 500 / 1_000_000_000 }, 'amm')).toBeCloseTo(0.005, 9);
  });

  it('ignores invalid trade values instead of inflating global fees', () => {
    expect(pumpGlobalFeeSolForTrade({ sol: -1, price: 1 }, 'curve')).toBe(0);
    expect(pumpGlobalFeeSolForTrade({ sol: 1, price: 0 }, 'amm')).toBe(0);
  });
});

describe('extractTrade', () => {
  it('reads a curve buy and computes price in SOL per token', () => {
    const tr = extractTrade(mkCurveTx({ ...base, address: curve, side: 'buy', sol: 1, tokens: 1_000_000e6 / 30 }), { kind: 'curve', address: curve, mint })!;
    expect(tr.side).toBe('buy');
    expect(tr.wallet).toBe(wallet);
    expect(tr.sol).toBeCloseTo(1, 9);
    // 1 SOL for 1e6/30 tokens => price 30/1e6 SOL per token, market cap 30 SOL on 1B supply
    expect(tr.price * 1e9).toBeCloseTo(30000, 3);
  });
  it('reads a curve sell', () => {
    const tr = extractTrade(mkCurveTx({ ...base, address: curve, side: 'sell', sol: 2, tokens: 5_000_000e6 }), { kind: 'curve', address: curve, mint })!;
    expect(tr.side).toBe('sell');
    expect(tr.sol).toBeCloseTo(2, 9);
    expect(tr.walletTokenBalanceBefore).toBe(5_000_000e6);
  });
  it('ignores create and migration transactions on the curve', () => {
    const create = mkCreateTx({ sig: 'c', slot: 1, time: 1, dev: wallet, mint, curve });
    const mig = mkMigrationTx({ sig: 'm', slot: 2, time: 2, mint, curve, pool });
    expect(extractTrade(create, { kind: 'curve', address: curve, mint })).toBeNull();
    expect(extractTrade(mig, { kind: 'curve', address: curve, mint })).toBeNull();
    expect(extractTrade(mig, { kind: 'amm', address: pool, mint })).toBeNull(); // liquidity add
  });
  it('reads AMM swaps in both directions', () => {
    const buy = extractTrade(mkAmmTx({ ...base, address: pool, side: 'buy', sol: 4, tokens: 1e12 }), { kind: 'amm', address: pool, mint })!;
    const sell = extractTrade(mkAmmTx({ ...base, address: pool, side: 'sell', sol: 4, tokens: 1e12 }), { kind: 'amm', address: pool, mint })!;
    expect(buy.side).toBe('buy');
    expect(sell.side).toBe('sell');
    expect(buy.price).toBeCloseTo(4 / 1e6, 12);
  });
  it('skips failed transactions', () => {
    const tx = mkCurveTx({ ...base, address: curve, side: 'buy', sol: 1, tokens: 1e9 });
    tx.meta!.err = { InstructionError: [0, 'Custom'] };
    expect(extractTrade(tx, { kind: 'curve', address: curve, mint })).toBeNull();
  });
  it('handles string keys with loaded addresses', () => {
    const tx = mkCurveTx({ ...base, address: curve, side: 'buy', sol: 1, tokens: 1e9 });
    const keys = txKeys(tx);
    tx.transaction.message.accountKeys = keys.slice(0, 2) as any;
    tx.meta!.loadedAddresses = { writable: keys.slice(2, 3), readonly: keys.slice(3) };
    expect(txKeys(tx)).toEqual(keys);
    expect(extractTrade(tx, { kind: 'curve', address: curve, mint })?.side).toBe('buy');
  });
});

describe('strict bought and sold token matching', () => {
  function coinFor(wallet: string) {
    const s = newCoin({
      mint,
      curve,
      pool,
      migTime: 1_699_999_000,
      migSig: 'migration',
      day: '2023-11-14',
      dayEnd: 1_700_100_000,
      symbol: 'TEST',
    });
    s.dev = fakeKey();
    return s;
  }

  it('rejects a sale when the wallet held more tokens than its tracked buys', () => {
    const trackedWallet = fakeKey();
    const s = coinFor(trackedWallet);
    applyTrades(s, [
      { sig: 'buy', slot: 100, time: 1_700_000_000, wallet: trackedWallet, side: 'buy', sol: 1, tokens: 1_000_000, price: 1 },
      {
        sig: 'sell', slot: 200, time: 1_700_000_300, wallet: trackedWallet,
        side: 'sell', sol: 2, tokens: 1_000_000, price: 2,
        walletTokenBalanceBefore: 1_010_000,
      },
    ], rules());

    // Total buy and sell amounts appear equal, but the seller's on-chain
    // pre-sell balance proves that extra tokens were present outside tracked buys.
    expect(s.pnl[trackedWallet].bt).toBe(s.pnl[trackedWallet].st);
    expect(s.pnl[trackedWallet].foreignInventory).toBe(1);
    expect(tokenFlowBalanced(s.pnl[trackedWallet])).toBe(false);
    expect(realizedOf(s, trackedWallet)).toBeNull();
    const checks = explainWallet(s, rules(), trackedWallet);
    expect(checks.winner.find((x) => !x.ok)?.text).toContain('transferred or airdropped tokens do not count');
  });

  it('rejects a wallet selling transferred tokens in addition to its purchases', () => {
    const trackedWallet = fakeKey();
    const s = coinFor(trackedWallet);

    applyTrades(s, [
      { sig: 'buy', slot: 100, time: 1_700_000_000, wallet: trackedWallet, side: 'buy', sol: 0.22, tokens: 1_000_000, price: 0.22 },
      { sig: 'sell-transferred-bag', slot: 200, time: 1_700_000_120, wallet: trackedWallet, side: 'sell', sol: 73.9, tokens: 10_000_000, price: 7.39 },
      { sig: 'sell-extra-transferred-bag', slot: 300, time: 1_700_000_180, wallet: trackedWallet, side: 'sell', sol: 5, tokens: 5_000_000, price: 1 },
    ], rules());

    expect(s.pnl[trackedWallet].bt).toBe(1_000_000);
    expect(s.pnl[trackedWallet].st).toBe(15_000_000);
    expect(tokenFlowBalanced(s.pnl[trackedWallet])).toBe(false);
    expect(realizedOf(s, trackedWallet)).toBeNull();
    expect(realizedRows(s, rules())).toEqual([]);
    const checks = explainWallet(s, rules(), trackedWallet);
    const mismatch = checks.winner.find((x) => !x.ok && x.text.includes('token amounts must match'));
    expect(mismatch).toBeTruthy();
    expect(mismatch!.text).toContain('bought 1, sold 15');
  });

  it('accepts a clean round trip when token amounts in and out match', () => {
    const trackedWallet = fakeKey();
    const s = coinFor(trackedWallet);

    applyTrades(s, [
      { sig: 'buy', slot: 100, time: 1_700_000_000, wallet: trackedWallet, side: 'buy', sol: 0.22, tokens: 1_000_000, price: 0.22 },
      { sig: 'sell', slot: 200, time: 1_700_000_300, wallet: trackedWallet, side: 'sell', sol: 0.739, tokens: 1_000_000, price: 0.739 },
    ], rules());

    expect(tokenFlowBalanced(s.pnl[trackedWallet])).toBe(true);
    expect(realizedOf(s, trackedWallet)?.cost).toBeCloseTo(0.22, 8);
    expect(realizedOf(s, trackedWallet)?.proceeds).toBeCloseTo(0.739, 8);
    expect(realizedOf(s, trackedWallet)?.pnl).toBeCloseTo(0.519, 8);
    expect(realizedRows(s, rules()).map((x) => x.wallet)).toEqual([trackedWallet]);
  });

  it('rejects even a small excess sale that could be transferred tokens', () => {
    const trackedWallet = fakeKey();
    const s = coinFor(trackedWallet);
    applyTrades(s, [
      { sig: 'buy', slot: 100, time: 1_700_000_000, wallet: trackedWallet, side: 'buy', sol: 1, tokens: 1_000_000, price: 1 },
      { sig: 'sell-with-extra', slot: 200, time: 1_700_000_300, wallet: trackedWallet, side: 'sell', sol: 2.02, tokens: 1_010_000, price: 2 },
    ], rules());

    expect(tokenFlowBalanced(s.pnl[trackedWallet])).toBe(false);
    expect(realizedOf(s, trackedWallet)).toBeNull();
    expect(realizedRows(s, rules())).toEqual([]);
  });

  it('rejects partial exits because bought and sold amounts do not match', () => {
    const trackedWallet = fakeKey();
    const s = coinFor(trackedWallet);

    applyTrades(s, [
      { sig: 'buy', slot: 100, time: 1_700_000_000, wallet: trackedWallet, side: 'buy', sol: 1, tokens: 10_000_000, price: 0.1 },
      { sig: 'partial-sell', slot: 200, time: 1_700_000_300, wallet: trackedWallet, side: 'sell', sol: 1.5, tokens: 5_000_000, price: 0.3 },
    ], rules());

    expect(tokenFlowBalanced(s.pnl[trackedWallet])).toBe(false);
    expect(realizedOf(s, trackedWallet)).toBeNull();
  });
});

describe('parseMigration and funding', () => {
  it('finds pool and mint, ignoring stray token accounts', () => {
    const m = parseMigration(mkMigrationTx({ sig: 'm', slot: 2, time: 2, mint, curve, pool }))!;
    expect(m.pool).toBe(pool);
    expect(m.mint).toBe(mint);
    expect(m.mint).not.toBe(WSOL);
  });
  it('findFunder picks the first inbound SOL transfer from someone else', () => {
    const funder = fakeKey();
    const txs = [mkFundTx({ sig: fakeSig(), slot: 1, time: 1, funder, wallet, sol: 2 })];
    expect(findFunder(wallet, txs)).toBe(funder);
    expect(findFunder(fakeKey(), txs)).toBeNull();
  });
});
