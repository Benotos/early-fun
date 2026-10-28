import { useId, useRef, useState } from 'react';
import { fmtUsd } from '../../shared/format';

const W = 800;
const H = 320;
const PL = 10;
const PR = 10;
const PT = 18;
const PB = 28;

const fmtClock = (t: number) => new Date(t * 1000).toISOString().slice(11, 16) + ' UTC';

export default function PriceChart({ pts, mig }: { pts: [number, number][]; mig: number }) {
  const id = useId().replace(/:/g, '');
  const wrap = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return <div className="chart-empty dim">Not enough trades to draw a chart yet.</div>;

  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const lo = Math.min(...pts.map((p) => p[1]));
  const hi = Math.max(...pts.map((p) => p[1]));
  const llo = Math.log(lo);
  const lhi = Math.log(Math.max(hi, lo * 1.01));
  const X = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * (W - PL - PR);
  const Y = (v: number) => PT + (1 - (Math.log(v) - llo) / (lhi - llo)) * (H - PT - PB);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
  const area = `${line} L${X(t1).toFixed(1)} ${H - PB} L${X(t0).toFixed(1)} ${H - PB} Z`;
  let peak = 0;
  pts.forEach((p, i) => {
    if (p[1] > pts[peak][1]) peak = i;
  });

  const ticks: number[] = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) ticks.push(10 ** e);
  const migX = mig > t0 && mig < t1 ? X(mig) : null;

  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = wrap.current!.getBoundingClientRect();
    const tx = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(X(p[0]) - tx);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? pts[hover] : null;
  const hx = hp ? X(hp[0]) : 0;
  const hy = hp ? Y(hp[1]) : 0;
  const tipLeft = hx > W * 0.7;
  return (
    <svg ref={wrap} className="chart" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Market cap over time, log scale">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b5cff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#8b5cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke="#22223a" strokeDasharray="3 5" />
          <text x={PL + 4} y={Y(v) - 5} className="chart-t">
            {fmtUsd(v)}
          </text>
        </g>
      ))}
      {migX !== null && (
        <g>
          <line x1={migX} x2={migX} y1={PT} y2={H - PB} stroke="#3dffa2" strokeOpacity="0.55" strokeDasharray="4 4" />
          <text x={migX + 6} y={PT + 10} className="chart-t" fill="#3dffa2">
            migrated
          </text>
        </g>
      )}
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="#b79cff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(pts[peak][0])} cy={Y(pts[peak][1])} r="5" fill="#3dffa2" />
      <text x={Math.min(X(pts[peak][0]) + 10, W - 90)} y={Math.max(Y(pts[peak][1]) - 8, 12)} className="chart-t" fill="#3dffa2">
        peak {fmtUsd(pts[peak][1])}
      </text>
      <text x={PL} y={H - 8} className="chart-t">
        {fmtClock(t0)}
      </text>
      <text x={W - PR} y={H - 8} textAnchor="end" className="chart-t">
        {fmtClock(t1)}
      </text>
      {hp && (
        <g pointerEvents="none">
          <line x1={hx} x2={hx} y1={PT} y2={H - PB} stroke="#8c8aa8" strokeOpacity="0.5" />
          <circle cx={hx} cy={hy} r="4.5" fill="#fff" stroke="#8b5cff" strokeWidth="2" />
          <g transform={`translate(${tipLeft ? hx - 150 : hx + 12} ${Math.min(Math.max(hy - 22, 8), H - 70)})`}>
            <rect width="138" height="44" rx="8" fill="#0c0c16" stroke="#2e2e4c" />
            <text x="10" y="19" className="chart-tip">
              {fmtUsd(hp[1])}
            </text>
            <text x="10" y="35" className="chart-t">
              {fmtClock(hp[0])}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}