import { Link } from 'react-router-dom';
import { fmtPct, fmtSol, shortAddr } from '../../shared/format';
import { useBoard } from '../lib/api';
import { useTilt } from '../lib/fx';

function Mini({ kind, symbol, big, line, wallet }: { kind: 'win' | 'loss'; symbol: string; big: string; line?: string; wallet: string }) {
  const tilt = useTilt<HTMLAnchorElement>(9);
  return (
    <Link to={`/w/${wallet}`} className={'mini ' + kind} ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}>
      <span className="mini-k mono">{kind === 'win' ? 'BEST PROFIT TODAY' : 'BIGGEST L TODAY'}</span>
      <b className="mini-sym">${symbol.toUpperCase()}</b>
      <span className={'mini-big mono ' + kind + (kind === 'win' ? ' profit' : '')}>{big}</span>
      {line && <span className="mini-line mono">{line}</span>}
      <span className="mini-w mono dim">{shortAddr(wallet)}</span>
    </Link>
  );
}

export default function HeroStack() {
  const { data } = useBoard('today');
  const w = (data?.winners || [])
    .filter((entry) => entry.realized && entry.pnlSol !== undefined && entry.pnlSol > 0)
    .sort((a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0))[0];
  const l = data?.losers[0];
  if (!w && !l) return <div className="hero-stack hero-empty" aria-hidden="true" />;
  return (
    <div className="hero-stack">
      {w && <Mini kind="win" symbol={w.symbol} big={`+${fmtSol(w.pnlSol ?? 0)} SOL`} line={`+${fmtPct(Math.max(0, (w.mult - 1) * 100))}`} wallet={w.wallet} />}
      {l && <Mini kind="loss" symbol={l.symbol} big={'-' + fmtPct(l.lossPct)} wallet={l.wallet} />}
    </div>
  );
}
