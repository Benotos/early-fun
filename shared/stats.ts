import type { RankedLoss, RankedWin, WalletResponse } from './types';

export interface WalletStats {
  bestWin: RankedWin | null;
  bestLoss: RankedLoss | null;
  winDays: number;
  lossDays: number;
  totalLossSol: number;
  boardCount: number;
}

export function walletStats(w: WalletResponse): WalletStats {
  let bestWin: RankedWin | null = null;
  for (const x of w.wins) if (!bestWin || x.mult > bestWin.mult) bestWin = x;
  let bestLoss: RankedLoss | null = null;
  for (const x of w.losses) if (!bestLoss || x.lossSol > bestLoss.lossSol) bestLoss = x;
  return {
    bestWin,
    bestLoss,
    winDays: new Set(w.wins.map((x) => x.day)).size,
    lossDays: new Set(w.losses.map((x) => x.day)).size,
    totalLossSol: w.losses.reduce((a, b) => a + b.lossSol, 0),
    boardCount: w.wins.filter((x) => x.onBoard).length + w.losses.filter((x) => x.onBoard).length,
  };
}