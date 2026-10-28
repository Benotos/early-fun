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

  it('calculates net realized SOL after subtracting losses', () => {
    const response: WalletResponse = {
      ok: true,
      address: 'wallet',
      wins: [win('winner', 1.017, 0.004)],
      losses: [{
        wallet: 'wallet',
        mint: 'loss-mint',
        symbol: 'loss',
        buyMcUsd: 100,
        sellMcUsd: 90,
        lossSol: 0.03,
        lossPct: 10,
        buySol: 0.3,
        sellSol: 0.27,
        lastSellTime: 1,
        day: '2026-10-28',
        rank: 1,
        total: 1,
        onBoard: false,
      }],
    };
    expect(walletStats(response).netRealizedSol).toBeCloseTo(-0.026, 8);
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
