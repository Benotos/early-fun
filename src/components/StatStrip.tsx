import { fmtSol } from '../../shared/format';
import { useBoard } from '../lib/api';
import CountUp from './CountUp';
import Countdown from './Countdown';

export default function StatStrip() {
  const { data } = useBoard('today');
  const bestProfit = (data?.winners || [])
    .filter((row) => row.realized && row.pnlSol !== undefined && row.pnlSol > 0)
    .sort((a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0))[0];
  const l = data?.losers[0];
  const tiles = [
    {
      k: 'Coins tracked today',
      v: data ? <CountUp value={data.meta.coins} format={(n) => Math.round(n).toString()} /> : '...',
      s: 'migrated from pump.fun',
    },
    {
      k: 'Best profit today',
      v: bestProfit ? <>+<CountUp value={bestProfit.pnlSol ?? 0} format={fmtSol} /> SOL</> : '-',
      s: bestProfit ? '$' + bestProfit.symbol.toUpperCase() : 'waiting for data',
      tone: 'win',
    },
    { k: 'Biggest L today', v: l ? <>-<CountUp value={l.lossSol} format={fmtSol} /> SOL</> : '-', s: l ? '$' + l.symbol.toUpperCase() : 'waiting for data', tone: 'loss' },
    { k: 'Boards reset in', v: <Countdown resetAt={data?.meta.resetAt} />, s: '00:00 UTC' },
  ];
  return (
    <div className="stats">
      {tiles.map((t) => (
        <div className="stat" key={t.k}>
          <span className="stat-k mono">{t.k}</span>
          <b className={'stat-v mono ' + (t.tone || '')}>{t.v}</b>
          <span className="stat-s dim">{t.s}</span>
        </div>
      ))}
    </div>
  );
}
