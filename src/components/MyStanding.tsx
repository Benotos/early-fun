import { Link } from 'react-router-dom';
import { fmtMult, fmtPct, fmtSol, shortAddr } from '../../shared/format';
import { walletStats } from '../../shared/stats';
import { tierFor } from '../../shared/tiers';
import { useWallet } from '../lib/api';
import { todayUtc } from '../lib/fx';
import { useMe } from '../lib/me';
import Avatar from './Avatar';

export default function MyStanding() {
  const [me, setMe] = useMe();
  const { data, error } = useWallet(me || '');
  if (!me) return null;
  const today = todayUtc();
  const winsToday = (data?.wins || []).filter((x) => x.day === today);
  const w = [...winsToday]
    .filter((x) => x.realized && x.pnlSol !== undefined && x.pnlSol > 0)
    .sort((a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0))[0] ??
    winsToday.sort((a, b) => b.mult - a.mult)[0];
  const l = data?.losses.filter((x) => x.day === today).sort((a, b) => b.lossSol - a.lossSol)[0];
  const st = data ? walletStats(data) : null;
  const tier = st ? tierFor(st.bestWin?.mult ?? 0, st.bestLoss?.lossSol ?? 0) : null;
  return (
    <div className="standing">
      <Avatar address={me} size={46} />
      <div className="standing-main">
        <div className="standing-h">
          <Link to={`/w/${me}`} className="mono">
            {shortAddr(me)}
          </Link>
          {tier && <span className={'tier ' + tier.tone}>{tier.name}</span>}
        </div>
        {error ? (
          <span className="dim small">Could not load your stats right now.</span>
        ) : !data ? (
          <span className="dim small">Checking the chain...</span>
        ) : w || l ? (
          <div className="standing-line mono">
            {w && (
              <span>
                <span className="dim">{w.pnlSol !== undefined ? 'best profit today' : 'best entry today'}</span>{' '}
                <b className="win">{w.pnlSol !== undefined ? '+' + fmtSol(w.pnlSol) + ' SOL' : fmtMult(w.mult)}</b>{' '}
                <span className="dim">${w.symbol.toUpperCase()}{w.pnlSol !== undefined ? ' · +' + fmtPct(Math.max(0, (w.mult - 1) * 100)) : ''}</span>{' '}
                <span className="badge on">{w.onBoard ? `#${w.rank} on board` : `rank ~${w.rank}`}</span>
              </span>
            )}
            {l && (
              <span>
                <span className="dim">biggest L today</span> <b className="loss">-{fmtSol(l.lossSol)} SOL</b> <span className="dim">${l.symbol.toUpperCase()}</span>{' '}
                <span className="badge on">{l.onBoard ? `#${l.rank} on board` : `rank ~${l.rank}`}</span>
              </span>
            )}
          </div>
        ) : (
          <span className="dim small">Nothing qualifying today yet. Keep trading, boards refresh every few minutes.</span>
        )}
      </div>
      <button className="btn small-btn" onClick={() => setMe(null)}>
        Forget
      </button>
    </div>
  );
}