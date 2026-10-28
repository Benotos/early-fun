import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../lib/fx';

const COLORS = ['#8b5cff', '#b79cff', '#3dffa2', '#ffffff', '#ffd166'];

export default function Confetti({ fire }: { fire: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!fire || prefersReducedMotion()) return;
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = (c.width = window.innerWidth * dpr);
    const h = (c.height = window.innerHeight * dpr);
    const parts = Array.from({ length: 150 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.32,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (-Math.random() * 15 - 4) * dpr,
      s: (Math.random() * 7 + 4) * dpr,
      r: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      col: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      g.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.42 * dpr;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        g.save();
        g.globalAlpha = Math.max(0, 1 - t / 2400);
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.fillStyle = p.col;
        g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        g.restore();
      }
      if (t < 2400) raf = requestAnimationFrame(tick);
      else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      g.clearRect(0, 0, w, h);
    };
  }, [fire]);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}