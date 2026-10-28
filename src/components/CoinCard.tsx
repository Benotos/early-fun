import { Link } from 'react-router-dom';
import { fmtMult, fmtSol, fmtUsd } from '../../shared/format';
import type { CoinSummary } from '../../shared/types';
import { ago } from '../lib/time';
import Spark from './Spark';

export default function CoinCard({ c }: { c: CoinSummary }) {
  return (
    <Link to={`/c/${c.mint}`} className="coin">
      <div className="coin-top">
        <b className="coin-sym">${c.symbol.toUpperCase()}</b>
        <span className="mono dim small">{ago(c.mig)}</span>
      </div>
      <Spark data={c.spark} />
      <div className="coin-stats">
        <div>
          <span className="dim">peak</span>
          <b className="mono">{fmtUsd(c.peakMcUsd)}</b>
        </div>
        <div>
          <span className="dim">best entry</span>
          <b className="mono win" title={c.verified ? 'verified' : 'not verified yet'}>
            {c.topMult > 0 ? fmtMult(c.topMult) + (c.verified ? '' : '~') : '-'}
          </b>
        </div>
        <div>
          <span className="dim">biggest L</span>
          <b className="mono loss">{c.topLossSol > 0 ? '-' + fmtSol(c.topLossSol) : '-'}</b>
        </div>
      </div>
    </Link>
  );
}