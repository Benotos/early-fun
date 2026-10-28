import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmtMult, fmtPct, fmtSol, fmtUsd } from '../../shared/format';
import { api } from '../lib/api';
import { copyText } from '../lib/share';

interface Payout {
  rank: number;
  wallet: string;
  symbol: string;
  mint: string;
  sol: number;
  mult?: number;
  entryMcUsd?: number;
  peakMcUsd?: number;
  lossSol?: number;
  lossPct?: number;
  capped?: boolean;
}
interface AdminRes {
  ok: true;
  day: string;
  final: boolean;
  updatedAt: number;
  coins: number;
  warning: string | null;
  pool: number;
  winners: Payout[];
  losers: Payout[];
  totals: { winnersSol: number; losersSol: number; unspentSol: number };
  rules: { winnersShare: number; lossCapPct: number; weights: number[] };
}

const csv = (rows: Payout[]) => 'rank,wallet,sol\n' + rows.map((r) => `${r.rank},${r.wallet},${r.sol.toFixed(6)}`).join('\n');

export default function Admin() {
  const [sp] = useSearchParams();
  const key = sp.get('key') || '';
  const [day, setDay] = useState(sp.get('day') || '');
  const [pool, setPool] = useState(sp.get('pool') || '');
  const [data, setData] = useState<AdminRes | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!key) {
      setError('Add ?key=YOUR_ADMIN_KEY to the URL');
      return;
    }
    setError('');
    try {
      const q = new URLSearchParams({ key });
      if (day) q.set('day', day);
      if (pool) q.set('pool', pool);
      setData(await api<AdminRes>('/api/admin?' + q.toString()));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }, [key, day, pool]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    load();
  };
  const copy = async (t: string, label: string) => {
    setMsg((await copyText(t)) ? `${label} copied` : 'Copy failed');
    setTimeout(() => setMsg(''), 1500);
  };

  return (
    <section className="section">
      <div className="wrap">
        <div className="eyebrow mono">ADMIN</div>
        <h2>Payout view</h2>
        <form className="admin-form" onSubmit={onSubmit}>
          <label>
            <span className="mono small dim">DAY (UTC)</span>
            <input className="mono" value={day} onChange={(e) => setDay(e.target.value)} placeholder="yesterday" />
          </label>
          <label>
            <span className="mono small dim">POOL (SOL)</span>
            <input className="mono" value={pool} onChange={(e) => setPool(e.target.value)} placeholder="0" inputMode="decimal" />
          </label>
          <button className="btn btn-primary" type="submit">
            Load
          </button>
        </form>
        {error && <div className="panel empty err">{error}</div>}
        {data && (
          <>
            <div className={'banner ' + (data.final ? 'ok' : 'warn')}>
              <b>{data.day}</b> · {data.coins} coins · {data.final ? 'FINAL, safe to pay' : data.warning}
            </div>
            <p className="dim small">
              Split {Math.round(data.rules.winnersShare * 100)}% winners and {Math.round((1 - data.rules.winnersShare) * 100)}% losers. Loser payouts are capped at{' '}
              {Math.round(data.rules.lossCapPct * 100)}% of the realized loss. Unspent: {fmtSol(data.totals.unspentSol)} SOL. Pay the trading wallet shown, nobody else.
            </p>
            {msg && <div className="toast">{msg}</div>}
            <div className="admin-grid">
              <div className="panel">
                <div className="admin-h">
                  <h4 className="win">Winners · {fmtSol(data.totals.winnersSol)} SOL</h4>
                  <button className="btn small-btn" onClick={() => copy(csv(data.winners), 'Winners CSV')}>
                    Copy CSV
                  </button>
                </div>
                {data.winners.map((r) => (
                  <div className="arow" key={r.wallet}>
                    <span className="mono rk">{r.rank}</span>
                    <div className="who">
                      <button className="addr-btn mono" onClick={() => copy(r.wallet, 'Wallet')} title="Copy wallet">
                        {r.wallet}
                      </button>
                      <span className="dim small mono">
                        ${r.symbol.toUpperCase()} · {fmtUsd(r.entryMcUsd || 0)} → {fmtUsd(r.peakMcUsd || 0)} · {fmtMult(r.mult || 0)}
                      </span>
                    </div>
                    <span className="mono sol">{r.sol.toFixed(4)}</span>
                  </div>
                ))}
                {data.winners.length === 0 && <p className="dim small">No verified winners for this day.</p>}
              </div>
              <div className="panel">
                <div className="admin-h">
                  <h4 className="loss">Losers · {fmtSol(data.totals.losersSol)} SOL</h4>
                  <button className="btn small-btn" onClick={() => copy(csv(data.losers), 'Losers CSV')}>
                    Copy CSV
                  </button>
                </div>
                {data.losers.map((r) => (
                  <div className="arow" key={r.wallet}>
                    <span className="mono rk">{r.rank}</span>
                    <div className="who">
                      <button className="addr-btn mono" onClick={() => copy(r.wallet, 'Wallet')} title="Copy wallet">
                        {r.wallet}
                      </button>
                      <span className="dim small mono">
                        ${r.symbol.toUpperCase()} · lost {fmtSol(r.lossSol || 0)} SOL (-{fmtPct(r.lossPct || 0)}){r.capped ? ' · capped' : ''}
                      </span>
                    </div>
                    <span className="mono sol">{r.sol.toFixed(4)}</span>
                  </div>
                ))}
                {data.losers.length === 0 && <p className="dim small">No verified losers for this day.</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
