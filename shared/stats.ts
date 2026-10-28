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
  // Realized wallets should be ranked by profit actually received, not just the
  // highest market-cap multiple. Keep multiple as a fallback for peak-mode data.
  const realizedWins = w.wins.filter((x) => x.realized && x.pnlSol !== undefined);
  const winCandidates = realizedWins.length ? realizedWins : w.wins;
  let bestWin: RankedWin | null = null;
  let bestWinScore = Number.NEGATIVE_INFINITY;
  for (const x of winCandidates) {
    const score = realizedWins.length ? (x.pnlSol ?? Number.NEGATIVE_INFINITY) : x.mult;
    if (
      !bestWin ||
      score > bestWinScore ||
      (score === bestWinScore && x.mult > bestWin.mult)
    ) {
      bestWin = x;
      bestWinScore = score;
    }
  }

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
