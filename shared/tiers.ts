export interface Tier {
  id: string;
  name: string;
  blurb: string;
  tone: 'gold' | 'win' | 'accent' | 'mute' | 'loss';
}

/** Title from the best verified multiple. Nobody pays for a title, it is only for fun. */
export function tierFor(bestMult: number, bestLossSol: number): Tier {
  if (bestMult >= 500) return { id: 'oracle', name: 'Oracle', blurb: 'Bought before anyone knew.', tone: 'gold' };
  if (bestMult >= 100) return { id: 'dayone', name: 'Day One', blurb: 'Genuinely early, on chain.', tone: 'win' };
  if (bestMult >= 25) return { id: 'bird', name: 'Early Bird', blurb: 'Caught a real runner early.', tone: 'win' };
  if (bestMult >= 5) return { id: 'sharp', name: 'Sharp Eye', blurb: 'Good entry on a coin that ran.', tone: 'accent' };
  if (bestMult >= 2) return { id: 'ok', name: 'Almost Early', blurb: 'Doubled up after your buy.', tone: 'accent' };
  if (bestLossSol > 0) return { id: 'liq', name: 'Exit Liquidity', blurb: 'The chain remembers your sells.', tone: 'loss' };
  return { id: 'none', name: 'Unranked', blurb: 'No qualifying trades in the last 7 days.', tone: 'mute' };
}

export function lossTag(lossSol: number): string | null {
  if (lossSol >= 50) return 'Rekt Royalty';
  if (lossSol >= 20) return 'Certified Rekt';
  if (lossSol >= 5) return 'Tuition Paid';
  return null;
}