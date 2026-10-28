import { Link } from 'react-router-dom';
import { fmtMult, fmtPct, fmtSol, fmtUsd, shortAddr } from '../../shared/format';
import { stagger } from '../lib/fx';
import { usePulse } from '../lib/pulse';

function dayLabel(day: string) {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function Records() {
  const { data, error } = usePulse();
  const rec = data?.records;
  return (
    <section className="section">
      <div className="wrap">
        <div className="eyebrow mono">ALL TIME · SINCE LAUNCH</div>
        <h2>Hall of fame</h2>
        <p className="dim sub-lede">Only final boards count, so nothing here can be removed later. The best entries and the biggest losses we have ever verified.</p>
        {error && !data && <div className="panel empty err">{error}</div>}
        {data && (!rec || (rec.win.length === 0 && rec.loss.length === 0)) && (
          <div className="panel empty">
            <b>Records start after the first day finalizes.</b>
            <span>Come back after 00:00 UTC.</span>
          </div>
        )}
        {rec && (rec.win.length > 0 || rec.loss.length > 0) && (
          <div className="two coin-cols">
            <div className="panel">
              <div className="admin-h">
                <h4 className="win">Best entries ever</h4>
              </div>
              {rec.win.slice(0, 15).map((e, i) => (
                <Link to={`/w/${e.wallet}`} className={'arow link rise' + (i === 0 ? ' gold' : '')} style={stagger(i)} key={e.wallet + e.mint + e.day}>
                  <span className="mono rk">{i + 1}</span>
                  <div className="who">
                    <span className="addr-line">
                      <b>${e.symbol.toUpperCase()}</b> <span className="mono dim small">{shortAddr(e.wallet)}</span>
                    </span>
                    <span className="dim small mono">
                      {fmtUsd(e.entryMcUsd)} → {fmtUsd(e.peakMcUsd)} · {dayLabel(e.day)}
                    </span>
                  </div>
                  <span className="mono sol win">{fmtMult(e.mult)}</span>
                </Link>
              ))}
            </div>
            <div className="panel">
              <div className="admin-h">
                <h4 className="loss">Biggest losses ever</h4>
              </div>
              {rec.loss.slice(0, 15).map((e, i) => (
                <Link to={`/w/${e.wallet}`} className={'arow link rise' + (i === 0 ? ' gold' : '')} style={stagger(i)} key={e.wallet + e.mint + e.day}>
                  <span className="mono rk">{i + 1}</span>
                  <div className="who">
                    <span className="addr-line">
                      <b>${e.symbol.toUpperCase()}</b> <span className="mono dim small">{shortAddr(e.wallet)}</span>
                    </span>
                    <span className="dim small mono">
                      {fmtUsd(e.buyMcUsd)} → {fmtUsd(e.sellMcUsd)} · {dayLabel(e.day)}
                    </span>
                  </div>
                  <span className="mono sol loss">
                    -{fmtSol(e.lossSol)}
                    <small> SOL</small>
                    <small className="pct"> -{fmtPct(e.lossPct)}</small>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}