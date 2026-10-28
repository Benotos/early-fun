import { describe, expect, it } from 'vitest';
import { K, coinSummaries, trackedCoinResults } from '../server/lib/boards';
import { refreshLiveCoinSummaries } from '../server/lib/scanner';
import { MemoryStore } from '../server/lib/store';
import type { CoinResult } from '../server/lib/scoring';
import { rules } from '../server/lib/env';

function coin(mint: string, gf: number, junk = false): CoinResult {
  return {
    mint,
    symbol: mint.slice(0, 4).toUpperCase(),
    day: '2026-10-28',
    dev: null,
    w: [],
    l: [],
    at: 1,
    fin: true,
    ...(junk ? { jk: 1 as const } : {}),
    gf,
    mig: 1,
    pk: 0,
    tr: 100,
    sp: [],
  };
}

describe('tracked coin eligibility', () => {
  it('counts every migrated coin that reaches the global fee threshold, independent of board quality gates', () => {
    const rows = [
      coin('eligible', 1.25),
      coin('exact-threshold', 1),
      coin('below-threshold', 0.999),
      coin('junk-but-fee-qualified', 1.8, true),
      coin('blocked', 9),
    ];
    const got = trackedCoinResults(rows, { ...rules(), minGlobalFeesSol: 1 }, new Set(['blocked']));
    expect(got.map((x) => x.mint)).toEqual([
      'eligible',
      'exact-threshold',
      'junk-but-fee-qualified',
    ]);
  });

  it('updates coin card sparklines and pulse immediately after a scan, without rebuilding the board', async () => {
    const store = new MemoryStore();
    const day = '2026-10-28';
    const mint = 'tracked-mint';
    const old = coin(mint, 1.1);
    old.symbol = 'OLD';
    old.pk = 100;
    old.sp = [1, 2, 3];
    const current = coin(mint, 1.4);
    current.symbol = 'NEW';
    current.pk = 200;
    current.sp = [1, 3, 5];
    current.tr = 220;

    await store.set('solusd', JSON.stringify({ p: 100 }));
    await store.set(K.coinsum(day), JSON.stringify(coinSummaries([old], 100)));
    await refreshLiveCoinSummaries(store, new Map([[mint, current]]), [day], { ...rules(), minGlobalFeesSol: 1 }, 1793229000);

    const rows = JSON.parse((await store.get(K.coinsum(day))!) as string);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('NEW');
    expect(rows[0].peakMcUsd).toBe(20000);
    expect(rows[0].trades).toBe(220);
    expect(rows[0].spark).toEqual([1, 3, 5]);

    const pulse = JSON.parse((await store.get(K.pulse)) as string);
    expect(pulse.updatedAt).toBe(1793229000);
    expect(pulse.coins).toHaveLength(1);
    expect(pulse.coins[0].symbol).toBe('NEW');
    expect(pulse.coins[0].spark).toEqual([1, 3, 5]);
  });

  it('removes a coin from live tracked summaries if it falls below the global fee threshold', async () => {
    const store = new MemoryStore();
    const day = '2026-10-28';
    const mint = 'falling-below-threshold';
    const old = coin(mint, 1.2);
    await store.set('solusd', JSON.stringify({ p: 100 }));
    await store.set(K.coinsum(day), JSON.stringify(coinSummaries([old], 100)));

    await refreshLiveCoinSummaries(store, new Map([[mint, coin(mint, 0.8)]]), [day], { ...rules(), minGlobalFeesSol: 1 }, 1793229001);
    expect(JSON.parse((await store.get(K.coinsum(day))!) as string)).toEqual([]);
    expect(JSON.parse((await store.get(K.pulse)) as string).coins).toEqual([]);
  });
});
