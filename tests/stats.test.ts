import { describe, expect, it } from 'vitest';
import { walletStats } from '../shared/stats';
import type { RankedWin, WalletResponse } from '../shared/types';

function win(wallet: string, mult: number, pnlSol: number): RankedWin {
  return {
    wallet,
    mint: 'mint',
    symbol: 'test',
    entryMcUsd: 100,
    peakMcUsd: 100 * mult,
    mult,
    buySol: 1,
    buyTime: 1,
    sig: 'sig',
    day: '2026-10-28',
    pnlSol,
    inSol: 1,
    outSol: 1 + pnlSol,
    realized: true,
    rank: 1,
    total: 2,
    onBoard: true,
  };
}

describe('wallet best win selection', () => {
  it('chooses the highest realized SOL profit instead of the highest multiple', () => {
    const response: WalletResponse = {
      ok: true,
      address: 'wallet',
      wins: [
        win('huge-multiple', 343, 0.4),
        win('best-profit', 22, 73.7),
      ],
      losses: [],
    };

    expect(walletStats(response).bestWin?.wallet).toBe('best-profit');
  });

  it('falls back to the highest multiple for legacy peak entries', () => {
    const highMultiple = { ...win('high-multiple', 25, 1), realized: false, pnlSol: undefined };
    const lowerMultiple = { ...win('lower-multiple', 5, 20), realized: false, pnlSol: undefined };
    const response: WalletResponse = {
      ok: true,
      address: 'wallet',
      wins: [lowerMultiple, highMultiple],
      losses: [],
    };

    expect(walletStats(response).bestWin?.wallet).toBe('high-multiple');
  });
});
