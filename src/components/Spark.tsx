import { useId } from 'react';

export default function Spark({ data, tone }: { data: number[]; tone?: 'win' | 'loss' }) {
  const id = useId().replace(/:/g, '');
  if (data.length < 2) return <div className="spark-empty" />;
  const W = 120;
  const H = 44;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - 3 - v * (H - 8)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const up = tone ? tone === 'win' : data[data.length - 1] >= data[0];
  const col = up ? '#3dffa2' : '#ff4d6a';
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity="0.35" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}