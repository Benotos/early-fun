import { Link } from 'react-router-dom';
import { fmtMult, fmtUsd } from '../../shared/format';
import { usePulse } from '../lib/pulse';

export default function Ticker() {
  const { data } = usePulse();
  const items = (data?.coins || []).filter((c) => c.topMult >= 2).slice(0, 16);
  if (items.length < 3) return null;
  const row = (hidden: boolean) =>
    items.map((c) => (
      <Link key={(hidden ? 'b' : 'a') + c.mint} to={`/c/${c.mint}`} className="tick" tabIndex={hidden ? -1 : 0} aria-hidden={hidden || undefined}>
        <b>${c.symbol.toUpperCase()}</b>
        <span className="mono dim">peak {fmtUsd(c.peakMcUsd)}</span>
        <span className="mono win">{fmtMult(c.topMult)}{c.verified ? '' : '~'}</span>
        <i aria-hidden="true" />
      </Link>
    ));
  return (
    <div className="ticker" role="region" aria-label="Recent runners">
      <div className="ticker-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}