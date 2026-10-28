import { Link } from 'react-router-dom';
import { fmtMult, fmtSol, shortAddr } from '../../shared/format';
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
  const w = data?.wins.filter((x) => x.day === today).sort((a, b) => b.mult - a.mult)[0];
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
                <span className="dim">best entry today</span> <b className="win">{fmtMult(w.mult)}</b> <span className="dim">${w.symbol.toUpperCase()}</span>{' '}
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