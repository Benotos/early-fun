import { useMemo, useState } from 'react';
import CoinCard from '../components/CoinCard';
import { todayUtc } from '../lib/fx';
import { usePulse } from '../lib/pulse';
import { play } from '../lib/sfx';

type Sort = 'new' | 'peak' | 'entry';
type Win = 'today' | 'yesterday' | 'week';

export default function Coins() {
  const { data, error } = usePulse();
  const [sort, setSort] = useState<Sort>('new');
  const [win, setWin] = useState<Win>('today');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const today = todayUtc();
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let c = data?.coins || [];
    if (win === 'today') c = c.filter((x) => x.day === today);
    if (win === 'yesterday') c = c.filter((x) => x.day === y);
    const s = q.trim().toLowerCase();
    if (s) c = c.filter((x) => x.symbol.toLowerCase().includes(s));
    return [...c].sort((a, b) => (sort === 'new' ? b.mig - a.mig : sort === 'peak' ? b.peakMcUsd - a.peakMcUsd : b.topMult - a.topMult));
  }, [data, sort, win, q]);

  return (
    <section className="section">
      <div className="wrap">
        <div className="eyebrow mono">EVERY COIN WE TRACK</div>
        <h2>Coins</h2>
        <p className="dim sub-lede">Every tracked Pump.fun migration that has accrued at least 1 SOL in global fees. Leaderboard entries still have separate trade-quality and anti-abuse checks.</p>
        <div className="toolbar">
          <div className="chips">
            {(['today', 'yesterday', 'week'] as Win[]).map((w) => (
              <button key={w} className={'chip' + (win === w ? ' on' : '')} onClick={() => { play('tab'); setWin(w); }}>
                {w === 'week' ? 'This week' : w[0].toUpperCase() + w.slice(1)}
              </button>
            ))}
          </div>
          <div className="chips">
            {([['new', 'Newest'], ['peak', 'Biggest peak'], ['entry', 'Best entry']] as [Sort, string][]).map(([id, l]) => (
              <button key={id} className={'chip' + (sort === id ? ' on' : '')} onClick={() => { play('tab'); setSort(id); }}>
                {l}
              </button>
            ))}
          </div>
          <input className="search mono" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol" aria-label="Search coins by symbol" />
        </div>
        {error && !data && <div className="panel empty err">{error}</div>}
        {!data && !error && (
          <div className="coin-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="coin skel-card" key={i}>
                <div className="skel" />
              </div>
            ))}
          </div>
        )}
        {data && list.length === 0 && (
          <div className="panel empty">
            <b>No coins here yet.</b>
            <span>Coins appear once they migrate and the scanner picks them up.</span>
          </div>
        )}
        <div className="coin-grid">
          {list.map((c) => (
            <CoinCard key={c.mint} c={c} />
          ))}
        </div>
        {list.some((c) => !c.verified && c.topMult > 0) && <p className="dim small foot-note">~ marks a best entry that has not passed the funding checks yet.</p>}
      </div>
    </section>
  );
}