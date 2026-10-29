import { useEffect, useMemo, useState } from 'react';

type DexPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  liquidity?: { usd?: number };
};

const FRAMES = [
  { label: '1m', interval: '1' },
  { label: '5m', interval: '5' },
  { label: '15m', interval: '15' },
  { label: '1h', interval: '60' },
  { label: '4h', interval: '240' },
  { label: '1d', interval: '1D' },
] as const;

/**
 * Pump.fun's coin page deliberately forbids third-party iframes (frame-ancestors
 * 'self'), so embedding that page directly renders blank. Resolve the live Solana
 * pair for this mint and use the embeddable, real-time DexScreener chart. The
 * Pump.fun link stays available for the original coin page and trading UI.
 */
export default function CandleChart({ mint }: { mint: string; candles?: [number, number, number, number, number][]; mig?: number }) {
  const [pairs, setPairs] = useState<DexPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [interval, setInterval] = useState<string>('1');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function resolvePair() {
      try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Market lookup returned HTTP ${response.status}`);
        const data = await response.json() as { pairs?: DexPair[] | null };
        const found = (data.pairs ?? [])
          .filter((p) => p.chainId?.toLowerCase() === 'solana' && Boolean(p.pairAddress))
          .filter((p) => {
            const m = mint.toLowerCase();
            return p.baseToken?.address?.toLowerCase() === m || p.quoteToken?.address?.toLowerCase() === m;
          })
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

        if (!active) return;
        setPairs(found);
        setError(found.length ? '' : 'No indexed live Solana pair was found for this coin yet.');
      } catch (e) {
        if (!active || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(e instanceof Error ? e.message : 'Could not resolve a live market pair.');
      } finally {
        if (active) setLoading(false);
      }
    }

    setLoading(true);
    void resolvePair();
    return () => {
      active = false;
      controller.abort();
    };
  }, [mint, reload]);

  // Prefer the deepest live market. The API resolver refreshes periodically so
  // newly migrated coins can pick up their PumpSwap pair without a page reload.
  useEffect(() => {
    const timer = window.setInterval(() => setReload((n) => n + 1), 45_000);
    return () => window.clearInterval(timer);
  }, []);

  const pair = pairs[0];
  const chartUrl = useMemo(() => {
    if (!pair) return '';
    const params = new URLSearchParams({
      embed: '1',
      loadChartSettings: '0',
      trades: '0',
      info: '0',
      chartLeftToolbar: '0',
      chartTheme: 'dark',
      theme: 'dark',
      chartStyle: '1',
      chartType: 'marketCap',
      interval,
    });
    return `https://dexscreener.com/solana/${encodeURIComponent(pair.pairAddress)}?${params.toString()}`;
  }, [pair, interval]);

  const pumpUrl = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
  const dexUrl = pair ? `https://dexscreener.com/solana/${encodeURIComponent(pair.pairAddress)}` : `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;

  return (
    <div className="cc pump-live-chart">
      <div className="cc-bar mono" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="live"><i /> LIVE MARKET CHART</span>
        <span className="dim small">{pair ? `${pair.dexId} · auto-refreshing market pair` : 'Resolving live coin market…'}</span>
        <span className="cc-tog" aria-label="Chart timeframe">
          {FRAMES.map((frame) => (
            <button key={frame.interval} className={interval === frame.interval ? 'on' : ''} onClick={() => setInterval(frame.interval)}>{frame.label}</button>
          ))}
        </span>
        <a className="btn small-btn" href={pumpUrl} target="_blank" rel="noopener noreferrer">Pump.fun ↗</a>
        <a className="btn small-btn" href={dexUrl} target="_blank" rel="noopener noreferrer">Open live chart ↗</a>
      </div>
      <div className="pump-live-frame" style={{ height: 430, minHeight: 320, position: 'relative', overflow: 'hidden', borderRadius: 10, background: '#080810' }}>
        {loading && (
          <div className="chart-empty dim" style={{ padding: 24 }}>
            Finding the live market pair for this coin…
          </div>
        )}
        {!loading && pair && (
          <iframe
            key={`${mint}:${pair.pairAddress}:${interval}`}
            title={`Live market chart for ${mint}`}
            src={chartUrl}
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="clipboard-read; clipboard-write"
            className="pump-live-iframe"
            style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#080810' }}
          />
        )}
        {!loading && !pair && (
          <div className="chart-empty dim" style={{ padding: 24 }}>
            <p>{error || 'The live pair is not available yet.'}</p>
            <p><a href={pumpUrl} target="_blank" rel="noopener noreferrer">Open this coin on Pump.fun ↗</a></p>
            <p><a href={dexUrl} target="_blank" rel="noopener noreferrer">Check DEX market data ↗</a></p>
            <button className="btn small-btn" onClick={() => setReload((n) => n + 1)}>Retry market lookup</button>
          </div>
        )}
      </div>
      <p className="dim small" style={{ marginTop: 8 }}>Chart data is supplied by the live DEX market. Pump.fun's own page blocks direct iframe embedding, so its link opens separately.</p>
    </div>
  );
}
