import { useId } from 'react';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic identicon from a wallet address. */
export default function Avatar({ address, size = 56 }: { address: string; size?: number }) {
  const id = useId().replace(/:/g, '');
  const h = hash(address);
  const hue = h % 360;
  const hue2 = (hue + 70 + ((h >> 9) % 110)) % 360;
  const cells: JSX.Element[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (hash(address + ':' + x + ',' + y) & 1) {
        cells.push(<rect key={`${x}${y}`} x={x * 6 + 5} y={y * 6 + 5} width="6" height="6" rx="1.4" />);
        if (x < 2) cells.push(<rect key={`m${x}${y}`} x={(4 - x) * 6 + 5} y={y * 6 + 5} width="6" height="6" rx="1.4" />);
      }
    }
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="avatar">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 85% 58%)`} />
          <stop offset="1" stopColor={`hsl(${hue2} 80% 42%)`} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id})`} />
      <g fill="rgba(255,255,255,0.92)">{cells}</g>
    </svg>
  );
}