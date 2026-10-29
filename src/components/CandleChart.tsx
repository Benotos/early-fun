import { useEffect, useMemo, useRef, useState } from 'react';

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

export default function CandleChart({ mint }: { mint: string; candles?: [number, number, number, number, number][]; mig?: number }) {
  const [resolvedPair, setResolvedPair] = useState<{ mint: string; pair: DexPair } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [interval, setInterval] = useState<string>('1');
  const [reload, setReload] = useState(0);
  const pairRef = useRef<{ mint: string; pair: DexPair } | null>(null);
  const pair = resolvedPair?.mint === mint ? resolvedPair.pair : null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const alreadyResolved = pairRef.current?.mint === mint;
    if (!alreadyResolved) {
      setLoading(true);
      setError('');
    }

    async function resolvePair() {
      try {
        // This dedicated endpoint returns just the pools containing the token and
        // has a higher rate allowance than token metadata/profile endpoints.
        const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`Market lookup returned HTTP ${response.status}`);
        const payload = await response.json() as DexPair[] | { pairs?: DexPair[] | null };
        const candidates = Array.isArray(payload) ? payload : (payload.pairs ?? []);
        const token = mint.toLowerCase();
        const found = candidates
          .filter((p) => p.chainId?.toLowerCase() === 'solana' && Boolean(p.pairAddress))
          .filter((p) => p.baseToken?.address?.toLowerCase() === token || p.quoteToken?.address?.toLowerCase() === token)
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        if (!active) return;

        if (found.length) {
          const best = found[0];
          const current = pairRef.current;
          // Keep the existing pair object when nothing changed. This prevents
          // an unnecessary iframe remount during background pair refreshes.
          if (current?.mint !== mint || current.pair.pairAddress !== best.pairAddress) {
            pairRef.current = { mint, pair: best };
            setResolvedPair({ mint, pair: best });
          }
          setError('');
        } else if (pairRef.current?.mint !== mint) {
          setError('No indexed live Solana market pair was found for this coin yet.');
        }
      } catch (e) {
        if (!active || (e instanceof DOMException && e.name === 'AbortError')) return;
        // Do not discard a chart that is already live just because a background
        // refresh request failed temporarily.
        if (pairRef.current?.mint !== mint) {
          setError(e instanceof Error ? e.message : 'Could not resolve a live market pair.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void resolvePair();
    return () => {
      active = false;
      controller.abort();
    };
  }, [mint, reload]);

  // Refresh pair discovery in the background, without removing the live iframe.
  useEffect(() => {
    const timer = window.setInterval(() => setReload((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
  }, [pair?.pairAddress, interval]);

  const pumpUrl = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
  const dexUrl = pair
    ? `https://dexscreener.com/solana/${encodeURIComponent(pair.pairAddress)}`
    : `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;

  return (
    <div className="cc pump-live-chart">
      <div className="cc-bar mono" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="live"><i /> LIVE MARKET CHART</span>
        <span className="dim small">{pair ? `${pair.dexId} · auto-refreshing market pair` : 'Finding live market…'}</span>
        <span className="cc-tog" aria-label="Chart timeframe">
          {FRAMES.map((frame) => (
            <button key={frame.interval} className={interval === frame.interval ? 'on' : ''} onClick={() => setInterval(frame.interval)}>{frame.label}</button>
          ))}
        </span>
        <a className="btn small-btn" href={pumpUrl} target="_blank" rel="noopener noreferrer">Pump.fun ↗</a>
        <a className="btn small-btn" href={dexUrl} target="_blank" rel="noopener noreferrer">Open live chart ↗</a>
      </div>
      <div className="pump-live-frame" style={{ height: 430, minHeight: 320, position: 'relative', overflow: 'hidden', borderRadius: 10, background: '#080810' }}>
        {pair && (
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
        {!pair && loading && (
          <div className="chart-empty dim" style={{ padding: 24 }}>
            Finding the live market pair…
          </div>
        )}
        {!pair && !loading && (
          <div className="chart-empty dim" style={{ padding: 24 }}>
            <p>{error || 'The live pair is not available yet.'}</p>
            <p><a href={pumpUrl} target="_blank" rel="noopener noreferrer">Open this coin on Pump.fun ↗</a></p>
            <p><a href={dexUrl} target="_blank" rel="noopener noreferrer">Check live DEX market data ↗</a></p>
            <button className="btn small-btn" onClick={() => setReload((n) => n + 1)}>Retry market lookup</button>
          </div>
        )}
      </div>
    </div>
  );
}
