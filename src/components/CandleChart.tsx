import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, CrosshairMode, IChartApi, ISeriesApi, PriceScaleMode, UTCTimestamp, createChart } from 'lightweight-charts';
import { fmtUsd } from '../../shared/format';

type Candle = [number, number, number, number, number];

const TFS: { s: number; label: string }[] = [
  { s: 15, label: '15s' },
  { s: 60, label: '1m' },
  { s: 300, label: '5m' },
  { s: 900, label: '15m' },
  { s: 3600, label: '1h' },
];

/** finest spacing between stored bars, in seconds */
function baseRes(c: Candle[]): number {
  let m = Infinity;
  for (let i = 1; i < c.length; i++) {
    const d = c[i][0] - c[i - 1][0];
    if (d > 0 && d < m) m = d;
  }
  return Number.isFinite(m) ? m : 60;
}

/** groups bars into candles of `step` seconds */
function group(c: Candle[], step: number): Candle[] {
  const out: Candle[] = [];
  for (const k of c) {
    const t = Math.floor(k[0] / step) * step;
    const cur = out[out.length - 1];
    if (cur && cur[0] === t) {
      cur[2] = Math.max(cur[2], k[2]);
      cur[3] = Math.min(cur[3], k[3]);
      cur[4] = k[4];
    } else out.push([t, k[1], k[2], k[3], k[4]]);
  }
  return out;
}

/** DEX style candlestick chart of market cap in USD. */
export default function CandleChart({ candles: raw, mig }: { candles: Candle[]; mig: number }) {
  const base = baseRes(raw);
  const usable = TFS.filter((x) => x.s >= base);
  const auto = (usable.find((x) => (raw.length ? (raw[raw.length - 1][0] - raw[0][0]) / x.s : 0) <= 400) || usable[usable.length - 1] || TFS[1]).s;
  const [tf, setTf] = useState<number | null>(null);
  const step = tf ?? auto;
  const candles = useMemo(() => group(raw, step), [raw, step]);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [log, setLog] = useState(true);
  const [hover, setHover] = useState<Candle | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || candles.length < 2) return;
    const c = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8e88ad', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', mode: PriceScaleMode.Logarithmic, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => fmtUsd(p) },
      handleScroll: true,
      handleScale: true,
    });
    const s = c.addCandlestickSeries({
      upColor: '#3dffa2',
      downColor: '#ff4d6a',
      borderVisible: false,
      wickUpColor: '#3dffa2',
      wickDownColor: '#ff4d6a',
      priceLineColor: '#8b5cff',
      priceFormat: { type: 'custom', formatter: (p: number) => fmtUsd(p), minMove: 0.01 },
    });
    s.setData(candles.map(([t, o, h, l, cl]) => ({ time: t as UTCTimestamp, open: o, high: h, low: l, close: cl })));

    // markers: migration and the peak
    let peak = 0;
    candles.forEach((k, i) => {
      if (k[2] > candles[peak][2]) peak = i;
    });
    const markers: Parameters<typeof s.setMarkers>[0] = [];
    const migIdx = candles.findIndex((k, i) => k[0] <= mig && (i === candles.length - 1 || candles[i + 1][0] > mig));
    if (mig > candles[0][0] && migIdx >= 0) markers.push({ time: candles[migIdx][0] as UTCTimestamp, position: 'belowBar', color: '#b79cff', shape: 'arrowUp', text: 'migrated' });
    markers.push({ time: candles[peak][0] as UTCTimestamp, position: 'aboveBar', color: '#3dffa2', shape: 'arrowDown', text: 'peak ' + fmtUsd(candles[peak][2]) });
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    s.setMarkers(markers);
    c.timeScale().fitContent();

    const byTime = new Map(candles.map((k) => [k[0], k]));
    c.subscribeCrosshairMove((p) => setHover(p.time !== undefined ? byTime.get(p.time as number) || null : null));

    const ro = new ResizeObserver(() => c.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    chart.current = c;
    series.current = s;
    return () => {
      ro.disconnect();
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [candles, mig]);

  useEffect(() => {
    chart.current?.applyOptions({ rightPriceScale: { mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal } });
  }, [log]);

  if (raw.length < 6)
    return <div className="chart-empty dim">Still reading this coin's trades. The chart fills in as the scanner catches up, check back in a few minutes.</div>;
  const last = candles[candles.length - 1];
  const k = hover || last;
  const up = k[4] >= k[1];
  return (
    <div className="cc">
      <div className="cc-bar mono">
        <span className="dim">{new Date(k[0] * 1000).toISOString().slice(5, 16).replace('T', ' ')} UTC</span>
        <span>
          O <b>{fmtUsd(k[1])}</b>
        </span>
        <span>
          H <b className="win">{fmtUsd(k[2])}</b>
        </span>
        <span>
          L <b className="loss">{fmtUsd(k[3])}</b>
        </span>
        <span>
          C <b className={up ? 'win' : 'loss'}>{fmtUsd(k[4])}</b>
        </span>
        <span className="cc-tog">
          {usable.map((x) => (
            <button key={x.s} className={step === x.s ? 'on' : ''} onClick={() => setTf(x.s)}>
              {x.label}
            </button>
          ))}
        </span>
        <span className="cc-tog cc-tog2">
          <button className={log ? 'on' : ''} onClick={() => setLog(true)}>
            log
          </button>
          <button className={!log ? 'on' : ''} onClick={() => setLog(false)}>
            linear
          </button>
        </span>
      </div>
      <div className="cc-box" ref={box} />
    </div>
  );
}