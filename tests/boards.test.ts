import { describe, expect, it } from 'vitest';
import { trackedCoinResults } from '../server/lib/boards';
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
});
