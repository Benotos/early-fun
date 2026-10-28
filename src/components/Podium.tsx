import { Link } from 'react-router-dom';
import { fmtMult, fmtPct, fmtSol, fmtUsd, shortAddr, winSol, lossSolText } from '../../shared/format';
import type { LossEntry, WinEntry } from '../../shared/types';
import { pumpUrl } from '../lib/config';
import { useTilt } from '../lib/fx';
import { play } from '../lib/sfx';
import CountUp from './CountUp';
import { ShareIcon } from './Icons';

type Props =
  | { kind: 'win'; e: WinEntry; rank: number; onShare: () => void }
  | { kind: 'loss'; e: LossEntry; rank: number; onShare: () => void };

export default function PodiumCard(props: Props) {
  const tilt = useTilt<HTMLDivElement>(6);
  const { rank, onShare } = props;
  const e = props.e;
  return (
    <div className={`pod p${rank} ${props.kind}`} ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}>
      <div className="pod-inner">
        <div className="pod-top">
          <span className="medal mono">#{rank}</span>
          <button
            className="share"
            onClick={() => {
              play('click');
              onShare();
            }}
            aria-label="Share card"
          >
            <ShareIcon />
          </button>
        </div>
        <a className="sym pod-sym" href={pumpUrl(e.mint)} target="_blank" rel="noopener noreferrer">
          ${e.symbol.toUpperCase()}
        </a>
        <div className={'pod-score mono ' + props.kind}>
          {props.kind === 'win' ? (
            <CountUp value={props.e.mult} format={fmtMult} />
          ) : (
            <>
              -<CountUp value={props.e.lossPct} format={fmtPct} />
            </>
          )}
        </div>
        {props.kind === 'win' ? (
          <div className="pod-line mono">
            <span className="dim">bought</span> {fmtUsd(props.e.entryMcUsd)} <span className="arr">→</span> {props.e.realized && <span className="dim">sold </span>}<span className="win">{fmtUsd(props.e.peakMcUsd)}</span>
            <div className={'small ' + winSol(props.e).cls}>{winSol(props.e).text}</div>
          </div>
        ) : (
          <div className="pod-line mono">
            <span className="dim">bought</span> {fmtUsd(props.e.buyMcUsd)} <span className="arr">→</span> <span className="dim">sold</span> <span className="loss">{fmtUsd(props.e.sellMcUsd)}</span>
            <div className="small loss">{lossSolText(props.e)}</div>
          </div>
        )}
        <Link className="addr mono" to={`/w/${e.wallet}`}>
          {shortAddr(e.wallet)}
        </Link>
      </div>
    </div>
  );
}