import { CSSProperties, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(target)) {
      from.current = target;
      setV(target);
      return;
    }
    const start = performance.now();
    const f0 = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const val = f0 + (target - f0) * e;
      from.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Mouse driven 3D tilt and light spot. Sets --rx --ry --mx --my on the element. */
export function useTilt<T extends HTMLElement>(max = 7) {
  const ref = useRef<T>(null);
  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      if (e.pointerType === 'touch') return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty('--rx', `${((0.5 - py) * max).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${((px - 0.5) * max).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    },
    [max]
  );
  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }, []);
  return { ref, onPointerMove, onPointerLeave };
}

/** Light spot that follows the pointer inside a section. */
export function usePointerGlow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const onPointerMove = useCallback((e: PointerEvent<T>) => {
    const el = ref.current;
    if (!el || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', `${e.clientX - r.left}px`);
    el.style.setProperty('--gy', `${e.clientY - r.top}px`);
  }, []);
  return { ref, onPointerMove };
}

export function stagger(i: number, step = 28): CSSProperties {
  return { animationDelay: `${Math.min(i, 24) * step}ms` };
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}