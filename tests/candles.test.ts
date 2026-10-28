import { describe, expect, it } from 'vitest';
import { applyTrades, candleBins, newCoin } from '../server/lib/coin';
import { rules } from '../server/lib/env';

describe('candles', () => {
  it('builds OHLC that opens at the previous close', () => {
    const s = newCoin({ mint: 'm', curve: 'c', pool: null, migTime: 0, migSig: 'x', day: '2026-10-27', dayEnd: 1e12 });
    s.sres = 60; // old one minute buckets
    const tr = (time: number, price: number) => ({ sig: 's' + time, slot: time, time, wallet: 'w' + time, side: 'buy' as const, sol: 1, tokens: 1, price });
    applyTrades(s, [tr(60, 10), tr(70, 14), tr(80, 8), tr(90, 12), tr(130, 20), tr(150, 18)], rules());
    const k = candleBins(s, 100);
    expect(k).toEqual([
      [60, 10, 14, 8, 12],
      [120, 12, 20, 12, 18],
    ]);
  });
  it('groups into bigger candles when there are too many minutes', () => {
    const s = newCoin({ mint: 'm', curve: 'c', pool: null, migTime: 0, migSig: 'x', day: '2026-10-27', dayEnd: 1e12 });
    const trades = Array.from({ length: 600 }, (_, i) => ({ sig: 's' + i, slot: i, time: i * 60, wallet: 'w', side: 'buy' as const, sol: 1, tokens: 1, price: 1 + i }));
    applyTrades(s, trades, rules());
    const k = candleBins(s, 180);
    expect(k.length).toBeLessThanOrEqual(180);
    expect(k[0][1]).toBe(1);
    expect(k[k.length - 1][4]).toBe(600);
  });
});

import { winnerRows } from '../server/lib/scoring';

describe('winners must have sold', () => {
  it('drops holders and keeps wallets that sold', () => {
    const r = { ...rules(), winRequireSell: true, minEntryMcSol: 0, minBuySol: 0.1, skipSlots: 0 };
    const s = newCoin({ mint: 'm', curve: 'c', pool: null, migTime: 0, migSig: 'x', day: '2026-10-27', dayEnd: 1e12 });
    const t = (slot: number, wallet: string, side: 'buy' | 'sell', price: number) => ({ sig: 's' + slot, slot, time: slot, wallet, side, sol: 1, tokens: 1e6, price });
    applyTrades(s, [t(1, 'holder', 'buy', 1), t(2, 'seller', 'buy', 1), t(3, 'x', 'buy', 50), t(4, 'seller', 'sell', 40)], r);
    const w = winnerRows(s, r).map((x) => x.wallet);
    expect(w).toContain('seller');
    expect(w).not.toContain('holder');
  });
});

import { rawBars } from '../server/lib/coin';

describe('15 second bars', () => {
  it('new coins store 1 second buckets', () => {
    const s = newCoin({ mint: 'm', curve: 'c', pool: null, migTime: 0, migSig: 'x', day: '2026-10-28', dayEnd: 1e12 });
    const tr = (time: number, price: number) => ({ sig: 's' + time, slot: time, time, wallet: 'w', side: 'buy' as const, sol: 1, tokens: 1, price });
    applyTrades(s, [tr(0, 1), tr(5, 3), tr(16, 2), tr(40, 5)], rules());
    expect(rawBars(s)).toEqual([
      [0, 1, 1, 1, 1],
      [5, 1, 3, 1, 3],
      [16, 3, 3, 2, 2],
      [40, 2, 5, 2, 5],
    ]);
  });
});