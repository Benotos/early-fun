import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtMult, fmtPct, fmtSol, fmtUsd, shortAddr, winSol, lossSolText } from '../../shared/format';
import type { LossEntry, Range, WinEntry } from '../../shared/types';
import { useBoard } from '../lib/api';
import { pumpUrl } from '../lib/config';
import { stagger } from '../lib/fx';
import { play } from '../lib/sfx';
import { ago } from '../lib/time';
import Countdown from './Countdown';
import { ShareIcon } from './Icons';
import PodiumCard from './Podium';
import ShareModal, { ShareTarget } from './ShareModal';

const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
];

export default function Board() {
  const [tab, setTab] = useState<'winners' | 'losers'>('winners');
  const [range, setRange] = useState<Range>('today');
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [limit, setLimit] = useState(25);
  const { data, error } = useBoard(range);

  const all = data ? (tab === 'winners' ? data.winners : data.losers) : [];
  const rows = all.slice(0, limit);
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const pick = (t: 'winners' | 'losers') => {
    if (t !== tab) play('tab');
    setTab(t);
    setLimit(25);
  };

  return (
    <section id="boards" className="section">
      <div className="wrap">
        <div className="board-head">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'winners'} className={'tab win' + (tab === 'winners' ? ' on' : '')} onClick={() => pick('winners')}>
              Winners
            </button>
            <button role="tab" aria-selected={tab === 'losers'} className={'tab loss' + (tab === 'losers' ? ' on' : '')} onClick={() => pick('losers')}>
              Losers
            </button>
          </div>
          <div className="chips">
            {RANGES.map((r) => (
              <button
                key={r.id}
                className={'chip' + (range === r.id ? ' on' : '')}
                onClick={() => {
                  if (r.id !== range) play('tab');
                  setRange(r.id);
                  setLimit(25);
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel board-panel">
          <div className="panel-bar">
            <span className="live">
              <i /> {range === 'today' ? 'LIVE' : range === 'yesterday' ? 'FINAL' : '7 DAYS'}
            </span>
            <span className="dim mono small">
              {data?.meta.coins ? `${data.meta.coins} coins tracked` : ''}
              {data?.meta.updatedAt ? ` · updated ${ago(data.meta.updatedAt)}` : ''}
            </span>
            <span className="reset small">
              resets in <Countdown resetAt={data?.meta.resetAt} /> UTC
            </span>
          </div>
          <div className="legend small dim">
            {tab === 'winners' ? 'Ranked by realized profit in SOL: what you sold for minus what you paid. Holders do not count.' : 'Ranked by realized loss in SOL on coins fully sold.'}
          </div>

          {error && !data && <div className="empty err">{error}</div>}
          {!data && !error && (
            <div className="rows">
              {Array.from({ length: 6 }, (_, i) => (
                <div className="row skel-row" key={i}>
                  <div className="skel" />
                </div>
              ))}
            </div>
          )}
          {data && data.warming && (
            <div className="empty">
              <b>Boards are warming up.</b>
              <span>The scanner is indexing migrated coins. First results land within a few minutes.</span>
            </div>
          )}
          {data && !data.warming && rows.length === 0 && (
            <div className="empty">
              <b>Nothing qualified yet.</b>
              <span>Entries appear once a coin migrates and a qualifying wallet is verified.</span>
            </div>
          )}

          {data && top.length > 0 && (
            <div className="podium" key={tab + range}>
              {tab === 'winners'
                ? (top as WinEntry[]).map((e, i) => <PodiumCard key={e.wallet + e.mint + e.day} kind="win" e={e} rank={i + 1} onShare={() => setShare({ type: 'win', entry: e })} />)
                : (top as LossEntry[]).map((e, i) => <PodiumCard key={e.wallet + e.mint + e.day} kind="loss" e={e} rank={i + 1} onShare={() => setShare({ type: 'loss', entry: e })} />)}
            </div>
          )}

          {data && rest.length > 0 && (
            <div className="rows">
              {tab === 'winners'
                ? (rest as WinEntry[]).map((e, i) => (
                    <div className="row rise" style={stagger(i)} key={e.wallet + e.mint + e.day}>
                      <div className="rk mono">{i + 4}</div>
                      <div className="who">
                        <a className="sym" href={pumpUrl(e.mint)} target="_blank" rel="noopener noreferrer">
                          ${e.symbol.toUpperCase()}
                        </a>
                        <Link className="addr mono" to={`/w/${e.wallet}`}>
                          {shortAddr(e.wallet)}
                        </Link>
                      </div>
                      <div className="mv mono">
                        <span className="dim">bought</span> {fmtUsd(e.entryMcUsd)} <span className="arr">→</span> {e.realized && <span className="dim">sold </span>}<span className="win">{fmtUsd(e.peakMcUsd)}</span>
                      </div>
                      <div className="sc mono win">
                        {fmtMult(e.mult)}
                        <small className={winSol(e).cls}>{winSol(e).text}</small>
                      </div>
                      <button
                        className="share"
                        onClick={() => {
                          play('click');
                          setShare({ type: 'win', entry: e });
                        }}
                        aria-label="Share card"
                      >
                        <ShareIcon />
                      </button>
                    </div>
                  ))
                : (rest as LossEntry[]).map((e, i) => (
                    <div className="row rise" style={stagger(i)} key={e.wallet + e.mint + e.day}>
                      <div className="rk mono">{i + 4}</div>
                      <div className="who">
                        <a className="sym" href={pumpUrl(e.mint)} target="_blank" rel="noopener noreferrer">
                          ${e.symbol.toUpperCase()}
                        </a>
                        <Link className="addr mono" to={`/w/${e.wallet}`}>
                          {shortAddr(e.wallet)}
                        </Link>
                      </div>
                      <div className="mv mono">
                        <span className="dim">bought</span> {fmtUsd(e.buyMcUsd)} <span className="arr">→</span> <span className="dim">sold</span>{' '}
                        <span className="loss">{fmtUsd(e.sellMcUsd)}</span>
                      </div>
                      <div className="sc mono loss">
                        -{fmtPct(e.lossPct)}
                        <small className="loss">{lossSolText(e)}</small>
                      </div>
                      <button
                        className="share"
                        onClick={() => {
                          play('click');
                          setShare({ type: 'loss', entry: e });
                        }}
                        aria-label="Share card"
                      >
                        <ShareIcon />
                      </button>
                    </div>
                  ))}
            </div>
          )}
          {all.length > limit && (
            <button
              className="more"
              onClick={() => {
                play('click');
                setLimit(limit + 25);
              }}
            >
              Show more ({all.length - limit} left)
            </button>
          )}
        </div>
      </div>
      {share && <ShareModal target={share} onClose={() => setShare(null)} />}
    </section>
  );
}