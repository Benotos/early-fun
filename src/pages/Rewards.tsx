import { Link } from 'react-router-dom';
import { fmtMult, fmtPct, lossSolText, shortAddr, winSol } from '../../shared/format';
import { LossEntry, WinEntry } from '../../shared/types';
import Avatar from '../components/Avatar';
import Countdown from '../components/Countdown';
import { LOSERS_PCT, PAYOUTS_LIVE, PAYOUT_SLOTS, PAYOUT_WEIGHTS, WINNERS_PCT } from '../lib/config';
import { stagger } from '../lib/fx';
import { useBoard } from '../lib/api';

/** share of one side's pool for each rank, in percent, always summing to 100 */
function shares(): number[] {
  const w = PAYOUT_WEIGHTS.slice(0, PAYOUT_SLOTS);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => (x / sum) * 100);
}

function Side(props: { kind: 'win' | 'loss'; pct: number; entries: (WinEntry | LossEntry)[] }) {
  const sh = shares();
  const win = props.kind === 'win';
  return (
    <div className={'panel rw-side ' + props.kind}>
      <div className="rw-head">
        <div>
          <div className={'eyebrow mono ' + props.kind}>{win ? 'TOP 5 WINNERS' : 'TOP 5 LOSERS'}</div>
          <h3>{win ? 'Earliest entries' : 'Biggest Ls'}</h3>
        </div>
        <div className={'rw-pool mono ' + props.kind}>
          {props.pct}%<small>of creator fees</small>
        </div>
      </div>
      {sh.map((s, i) => {
        const e = props.entries[i];
        const ofTotal = (s * props.pct) / 100;
        return (
          <div className={'rw-row rise' + (i === 0 ? ' first' : '')} style={stagger(i)} key={i}>
            <span className="rk mono">#{i + 1}</span>
            {e ? (
              <Link to={`/w/${e.wallet}`} className="rw-who">
                <Avatar address={e.wallet} size={36} />
                <span>
                  <b>${e.symbol.toUpperCase()}</b> <span className="mono dim small">{shortAddr(e.wallet)}</span>
                  <span className="mono small block">
                    {win ? (
                      <>
                        <span className="win">{fmtMult((e as WinEntry).mult)}</span> <span className={winSol(e as WinEntry).cls}>{winSol(e as WinEntry).text}</span>
                      </>
                    ) : (
                      <span className="loss">
                        -{fmtPct((e as LossEntry).lossPct)} · {lossSolText(e as LossEntry)}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            ) : (
              <span className="rw-who dim">Open spot, trade to take it</span>
            )}
            <span className="rw-share mono">
              {s.toFixed(0)}%<small>{ofTotal.toFixed(1)}% of total</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Rewards() {
  const { data, error } = useBoard('today');
  return (
    <section className="section">
      <div className="wrap">
        <div className="eyebrow mono">CREATOR REWARDS · TODAY</div>
        <h2>How the fees get split</h2>
        <p className="dim sub-lede">
          Every day at 00:00 UTC, creator fees are split <b className="win">{WINNERS_PCT}%</b> to the top {PAYOUT_SLOTS} winners and <b className="loss">{LOSERS_PCT}%</b> to the top {PAYOUT_SLOTS} losers on the verified board. Paid to the wallet that made the trade. No claiming, no connecting.
        </p>
        <div className="rw-strip">
          <div className="panel rw-stat">
            <span className="k mono">PAYOUT IN</span>
            <b className="mono">
              <Countdown resetAt={data?.meta.resetAt} />
            </b>
            <span className="dim small">00:00 UTC</span>
          </div>
          <div className="panel rw-stat">
            <span className="k mono">SPLIT</span>
            <b className="mono">
              <span className="win">{WINNERS_PCT}</span> / <span className="loss">{LOSERS_PCT}</span>
            </b>
            <span className="dim small">winners / losers</span>
          </div>
          <div className="panel rw-stat">
            <span className="k mono">PAID SPOTS</span>
            <b className="mono">{PAYOUT_SLOTS * 2}</b>
            <span className="dim small">top {PAYOUT_SLOTS} on each side</span>
          </div>
        </div>
        {!PAYOUTS_LIVE && <div className="panel rw-note dim">Rewards start once the token is live. This is a live preview of who would be paid right now.</div>}
        {error && !data && <div className="panel empty err">{error}</div>}
        <div className="two coin-cols rw-cols">
          <Side kind="win" pct={WINNERS_PCT} entries={data?.winners || []} />
          <Side kind="loss" pct={LOSERS_PCT} entries={data?.losers || []} />
        </div>
        <p className="dim small rw-foot">
          Spots move all day as new coins migrate and boards refresh. The board locks at 00:00 UTC and that final board decides the payout. Wallets funded by a coin's dev, snipers in the first seconds and wallets that share a funder are excluded.
        </p>
      </div>
    </section>
  );
}