/**
 * Pump.fun's official coin page supplies the live chart and its own timeframe
 * controls. Using the provider chart avoids freezing at the locally stored peak
 * and follows the token through its Pump.fun/AMM lifecycle.
 */
export default function CandleChart({ mint }: { mint: string; candles?: [number, number, number, number, number][]; mig?: number }) {
  const src = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
  return (
    <div className="cc pump-live-chart">
      <div className="cc-bar mono">
        <span className="live"><i /> PUMP.FUN LIVE</span>
        <span className="dim small">Official live chart · use the chart's timeframe controls</span>
        <a className="btn small-btn" href={src} target="_blank" rel="noopener noreferrer">Open Pump.fun ↗</a>
      </div>
      <div className="pump-live-frame" style={{ height: 430, minHeight: 320, position: 'relative', overflow: 'hidden', borderRadius: 10 }}>
        <iframe
          key={mint}
          title={`Pump.fun live chart for ${mint}`}
          src={src}
          loading="eager"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
          className="pump-live-iframe"
          style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#080810' }}
        />
      </div>
    </div>
  );
}
