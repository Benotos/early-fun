import { describe, expect, it } from 'vitest';
import { fmtPct } from '../shared/format';

describe('fmtPct', () => {
  it('keeps normal gain and loss percentages readable', () => {
    expect(fmtPct(65)).toBe('65%');
    expect(fmtPct(96)).toBe('96%');
    expect(fmtPct(1.25)).toBe('1.3%');
  });

  it('does not cap large realized gains at 100 percent', () => {
    expect(fmtPct(34226.7)).toBe('34,227%');
  });

  it('handles non finite values safely', () => {
    expect(fmtPct(Number.NaN)).toBe('0%');
  });
});
