export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [v, s] of units) {
    if (n >= v) {
      const x = n / v;
      return '$' + (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + s;
    }
  }
  return '$' + n.toFixed(0);
}

export function fmtMult(n: number): string {
  if (!Number.isFinite(n)) return '0x';
  if (n >= 100) return Math.round(n).toLocaleString('en-US') + 'x';
  if (n >= 10) return n.toFixed(1) + 'x';
  return n.toFixed(2) + 'x';
}

export function fmtSol(n: number): string {
  return n.toFixed(n >= 10 ? 1 : 2);
}

/** +1.23 SOL / -0.40 SOL */
export function fmtPnl(n: number): string {
  return (n >= 0 ? '+' : '-') + fmtSol(Math.abs(n)) + ' SOL';
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US') + '%';
  return n.toFixed(Math.abs(n) >= 10 ? 0 : 1) + '%';
}

export function shortAddr(a: string): string {
  return a.length > 10 ? a.slice(0, 4) + '...' + a.slice(-4) : a;
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58ByteLength(s: string): number {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return -1;
    n = n * 58n + BigInt(i);
  }
  let bytes = 0;
  while (n > 0n) {
    bytes++;
    n >>= 8n;
  }
  let zeros = 0;
  for (const ch of s) {
    if (ch === '1') zeros++;
    else break;
  }
  return bytes + zeros;
}

export function isSolAddress(s: string): boolean {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  return base58ByteLength(s) === 32;
}

export function dayKey(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export function dayStart(day: string): number {
  return Math.floor(Date.parse(day + 'T00:00:00Z') / 1000);
}

export function nextResetAt(nowSec: number): number {
  return dayStart(dayKey(nowSec)) + 86400;
}

export function addDays(day: string, delta: number): string {
  return dayKey(dayStart(day) + delta * 86400);
}

/** SOL line under a winner: what the wallet spent, what it sold for, and whether it still holds */
export function winSol(e: { pnlSol?: number; buySol: number; inSol?: number; outSol?: number; holding?: boolean }): { text: string; cls: 'win' | 'loss' | 'dim' } {
  if (e.inSol !== undefined) {
    const spent = fmtSol(e.inSol) + ' SOL';
    if (!e.outSol) return { text: `spent ${spent} · not sold yet`, cls: 'dim' };
    const cls = e.outSol >= e.inSol ? 'win' : 'loss';
    const pnl = e.pnlSol !== undefined ? fmtPnl(e.pnlSol) + ' · ' : '';
    return { text: `${pnl}spent ${spent} → sold for ${fmtSol(e.outSol)} SOL${e.holding ? ' · still holding some' : ''}`, cls: e.holding && cls === 'loss' ? 'dim' : cls };
  }
  if (e.pnlSol !== undefined) return { text: fmtPnl(e.pnlSol) + ' profit', cls: e.pnlSol >= 0 ? 'win' : 'loss' };
  return { text: fmtSol(e.buySol) + ' SOL in · not sold yet', cls: 'dim' };
}

/** SOL line under a loser: what the wallet spent and what it got back */
export function lossSolText(e: { lossSol: number; buySol?: number; sellSol?: number }): string {
  if (e.buySol !== undefined && e.sellSol !== undefined) return `-${fmtSol(e.lossSol)} SOL · spent ${fmtSol(e.buySol)} → sold for ${fmtSol(e.sellSol)} SOL`;
  return `-${fmtSol(e.lossSol)} SOL`;
}