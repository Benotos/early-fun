import { Link } from 'react-router-dom';
import { fmtMult, fmtPct, fmtUsd, shortAddr } from '../../shared/format';
import { useBoard } from '../lib/api';
import { useTilt } from '../lib/fx';

function Mini({ kind, symbol, big, line, wallet }: { kind: 'win' | 'loss'; symbol: string; big: string; line: string; wallet: string }) {
  const tilt = useTilt<HTMLAnchorElement>(9);
  return (
    <Link to={`/w/${wallet}`} className={'mini ' + kind} ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}>
      <span className="mini-k mono">{kind === 'win' ? 'BEST ENTRY TODAY' : 'BIGGEST L TODAY'}</span>
      <b className="mini-sym">${symbol.toUpperCase()}</b>
      <span className={'mini-big mono ' + kind}>{big}</span>
      <span className="mini-line mono">{line}</span>
      <span className="mini-w mono dim">{shortAddr(wallet)}</span>
    </Link>
  );
}

export default function HeroStack() {
  const { data } = useBoard('today');
  const w = data?.winners[0];
  const l = data?.losers[0];
  if (!w && !l) return <div className="hero-stack hero-empty" aria-hidden="true" />;
  return (
    <div className="hero-stack">
      {w && <Mini kind="win" symbol={w.symbol} big={fmtMult(w.mult)} line={`${fmtUsd(w.entryMcUsd)} → ${fmtUsd(w.peakMcUsd)}`} wallet={w.wallet} />}
      {l && <Mini kind="loss" symbol={l.symbol} big={'-' + fmtPct(l.lossPct)} line={`${fmtUsd(l.buyMcUsd)} → ${fmtUsd(l.sellMcUsd)}`} wallet={l.wallet} />}
    </div>
  );
}