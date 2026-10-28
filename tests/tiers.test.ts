import { describe, expect, it } from 'vitest';
import { tierFor } from '../shared/tiers';

describe('wallet tier labels', () => {
  it('does not label a wallet exit liquidity when it has a qualifying win and a loss', () => {
    const tier = tierFor(1.32, 1);
    expect(tier.id).toBe('green');
    expect(tier.name).toBe('In Profit');
    expect(tier.tone).toBe('win');
  });

  it('keeps exit liquidity for a wallet with losses and no win', () => {
    const tier = tierFor(0, 1);
    expect(tier.id).toBe('liq');
    expect(tier.name).toBe('Exit Liquidity');
  });

  it('preserves existing higher winning tiers', () => {
    expect(tierFor(2.1, 1).id).toBe('ok');
    expect(tierFor(25, 1).id).toBe('bird');
  });
});
