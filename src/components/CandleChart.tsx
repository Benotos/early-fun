import { useState } from 'react';

const TFS = [
  { label: '1s', value: '1s' },
  { label: '5s', value: '5s' },
  { label: '15s', value: '15s' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
];

/**
 * Use Pump.fun's own coin chart rather than our locally reconstructed candles.
 * This chart is fed by Pump.fun's live market data and handles curve/AMM migration
 * in the provider UI. Timeframe controls are retained as visible shortcuts; the
 * embedded Pump.fun chart owns its own timeframe controls.
 */
export default function CandleChart({ mint }: { mint: string; candles?: [number, number, number, number, number][]; mig?: number }) {
  const [frame, setFrame] = useState('1m');
  const src = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
  return (
    <div className="cc pump-live-chart">
      <div className="cc-bar mono">
        <span className="live"><i /> PUMP.FUN LIVE</span>
        <span className="dim small">Official live coin chart · timeframe: {frame}</span>
        <span className="cc-tog" aria-label="Chart timeframe shortcuts">
          {TFS.map((tf) => (
            <button key={tf.value} className={frame === tf.value ? 'on' : ''} onClick={() => setFrame(tf.value)}>{tf.label}</button>
          ))}
        </span>
        <a className="btn small-btn" href={src} target="_blank" rel="noopener noreferrer">Open Pump.fun ↗</a>
      </div>
      <div className="pump-live-frame">
        <iframe
          key={mint}
          title={`Pump.fun live chart for ${mint}`}
          src={src}
          loading="eager"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
          className="pump-live-iframe"
        />
      </div>
    </div>
  );
}
