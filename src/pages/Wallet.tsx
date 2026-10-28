import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addDays, fmtMult, fmtPct, fmtSol, fmtUsd, isSolAddress, shortAddr, winSol, lossSolText } from '../../shared/format';
import { walletStats } from '../../shared/stats';
import { lossTag, tierFor } from '../../shared/tiers';
import type { RankedLoss, RankedWin } from '../../shared/types';
import Avatar from '../components/Avatar';
import CountUp from '../components/CountUp';
import Confetti from '../components/Confetti';
import { CheckIcon, CopyIcon, DuelIcon, ExternalIcon, ShareIcon } from '../components/Icons';
import PasteBox from '../components/PasteBox';
import ShareModal, { ShareTarget } from '../components/ShareModal';
import { useWallet } from '../lib/api';
import { pumpUrl } from '../lib/config';
import { stagger, todayUtc } from '../lib/fx';
import { useMe } from '../lib/me';
import { play } from '../lib/sfx';
import { copyText } from '../lib/share';

function dayLabel(day: string): string {
  const today = todayUtc();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function Badge({ onBoard, rank, total }: { onBoard: boolean; rank: number; total: number }) {
  return onBoard ? (
    <span className="badge on">#{rank} on the board</span>
  ) : (
    <span className="badge" title="Qualifies but is not on the verified board yet">
      qualifies · rank ~{rank} of {total}
    </span>
  );
}

function Activity({ wins, losses }: { wins: RankedWin[]; losses: RankedLoss[] }) {
  const today = todayUtc();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const maxLoss = Math.max(1, ...losses.map((l) => l.lossSol));
  return (
    <div className="activity" aria-label="Last 7 days">
      {days.map((d) => {
        const w = Math.max(0, ...wins.filter((x) => x.day === d).map((x) => x.mult));
        const l = Math.max(0, ...losses.filter((x) => x.day === d).map((x) => x.lossSol));
        const wh = w > 0 ? Math.max(12, Math.min(100, (Math.log10(w) / 3) * 100)) : 0;
        const lh = l > 0 ? Math.max(12, Math.min(100, (l / maxLoss) * 100)) : 0;
        return (
          <div className="act-col" key={d} title={`${d}${w ? ' · best ' + fmtMult(w) : ''}${l ? ' · lost ' + fmtSol(l) + ' SOL' : ''}`}>
            <div className="act-up">{wh > 0 && <i className="win" style={{ height: wh + '%' }} />}</div>
            <div className="act-down">{lh > 0 && <i className="loss" style={{ height: lh + '%' }} />}</div>
            <span className="mono">{new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Wallet() {
  const { address = '' } = useParams();
  const valid = isSolAddress(address);
  const { data, error } = useWallet(valid ? address : '');
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const [me, setMe] = useMe();
  const nav = useNavigate();

  const stats = useMemo(() => (data ? walletStats(data) : null), [data]);
  const tier = stats ? tierFor(stats.bestWin?.mult ?? 0, stats.bestLoss?.lossSol ?? 0) : null;
  const ltag = stats?.bestLoss ? lossTag(stats.bestLoss.lossSol) : null;

  useEffect(() => {
    if (stats?.bestWin?.onBoard && stats.bestWin.rank <= 10) {
      const t = setTimeout(() => {
        setConfetti((n) => n + 1);
        play('success');
      }, 450);
      return () => clearTimeout(t);
    }
  }, [stats]);

  if (!valid) {
    return (
      <section className="section">
        <div className="wrap narrow">
          <h2>Invalid address</h2>
          <p className="dim">That does not look like a Solana wallet address.</p>
          <PasteBox />
        </div>
      </section>
    );
  }
  const isMe = me === address;

  return (
    <section className="section">
      <Confetti fire={confetti} />
      <div className="wrap narrow wide-ish">
        <Link to="/" className="back mono small">
          ← back to boards
        </Link>

        <div className="profile">
          <Avatar address={address} size={76} />
          <div className="profile-main">
            <div className="eyebrow mono">WALLET</div>
            <h2 className="mono addr-h">{shortAddr(address)}</h2>
            <div className="chips-row">
              {tier && (
                <span className={'tier big ' + tier.tone} title={tier.blurb}>
                  {tier.name}
                </span>
              )}
              {ltag && <span className="tier big loss">{ltag}</span>}
              {tier && <span className="dim small">{tier.blurb}</span>}
            </div>
          </div>
        </div>
        <div className="profile-actions">
          <button
            className="btn small-btn"
            onClick={async () => {
              if (await copyText(address)) {
                play('copy');
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            className={'btn small-btn' + (isMe ? ' on' : '')}
            onClick={() => {
              play('click');
              setMe(isMe ? null : address);
            }}
          >
            {isMe ? <CheckIcon /> : null} {isMe ? 'This is my wallet' : 'Set as my wallet'}
          </button>
          <button
            className="btn small-btn"
            onClick={() => {
              play('click');
              nav(me && me !== address ? `/duel/${me}/${address}` : `/duel?a=${address}`);
            }}
          >
            <DuelIcon /> {me && me !== address ? 'Duel my wallet' : 'Duel someone'}
          </button>
          <a className="btn small-btn" href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer">
            Solscan <ExternalIcon />
          </a>
        </div>

        {error && <div className="panel empty err">{error}</div>}
        {!data && !error && (
          <div className="panel">
            <div className="skel tall" />
          </div>
        )}

        {data && stats && (
          <>
            <div className="stats">
              <div className="stat">
                <span className="stat-k mono">Best entry</span>
                <b className="stat-v mono win">{stats.bestWin ? <CountUp value={stats.bestWin.mult} format={fmtMult} /> : '-'}</b>
                <span className="stat-s dim">{stats.bestWin ? '$' + stats.bestWin.symbol.toUpperCase() : 'none in 7 days'}</span>
              </div>
              <div className="stat">
                <span className="stat-k mono">Days with a win</span>
                <b className="stat-v mono">{stats.winDays}<small>/7</small></b>
                <span className="stat-s dim">{data.wins.length} qualifying buys</span>
              </div>
              <div className="stat">
                <span className="stat-k mono">Biggest loss</span>
                <b className="stat-v mono loss">{stats.bestLoss ? <>-<CountUp value={stats.bestLoss.lossSol} format={fmtSol} /> SOL</> : '-'}</b>
                <span className="stat-s dim">{stats.bestLoss ? '$' + stats.bestLoss.symbol.toUpperCase() : 'none in 7 days'}</span>
              </div>
              <div className="stat">
                <span className="stat-k mono">On the boards</span>
                <b className="stat-v mono">{stats.boardCount}</b>
                <span className="stat-s dim">verified entries</span>
              </div>
            </div>

            <div className="panel pad act-panel">
              <div className="act-h mono small dim">LAST 7 DAYS · <span className="win">best entry</span> above, <span className="loss">biggest loss</span> below</div>
              <Activity wins={data.wins} losses={data.losses} />
            </div>

            <h3 className="sub-h win-h">Early buys</h3>
            {data.wins.length === 0 ? (
              <div className="panel empty">
                <b>No qualifying early buys in the last 7 days.</b>
                <span>A buy qualifies on a coin that migrated, after the first seconds, at 0.1 SOL or more, with the coin at least doubling after it.</span>
              </div>
            ) : (
              data.wins.map((e: RankedWin, i) => (
                <div className="entry rise" style={stagger(i)} key={e.day + e.mint}>
                  <div className="entry-top">
                    <span className="mono dim small">{dayLabel(e.day)}</span>
                    <Badge onBoard={e.onBoard} rank={e.rank} total={e.total} />
                  </div>
                  <div className="entry-main">
                    <Link className="sym big" to={`/c/${e.mint}`}>
                      ${e.symbol.toUpperCase()}
                    </Link>
                    <div className="mv mono">
                      <span className="dim">bought</span> {fmtUsd(e.entryMcUsd)} <span className="arr">→</span> {e.realized && <span className="dim">sold </span>}<span className="win">{fmtUsd(e.peakMcUsd)}</span>
                    </div>
                    <div className="sc mono win">
                      {fmtMult(e.mult)}
                      <small className={winSol(e).cls}>{winSol(e).text}</small>
                    </div>
                  </div>
                  <div className="entry-btns">
                    <button className="btn" onClick={() => { play('click'); setShare({ type: 'win', entry: e }); }}>
                      <ShareIcon /> Share card
                    </button>
                    <a className="btn" href={pumpUrl(e.mint)} target="_blank" rel="noopener noreferrer">
                      pump.fun <ExternalIcon />
                    </a>
                  </div>
                </div>
              ))
            )}

            <h3 className="sub-h loss-h">Losses</h3>
            {data.losses.length === 0 ? (
              <div className="panel empty">
                <b>No qualifying losses in the last 7 days.</b>
                <span>A loss qualifies on a coin you fully exited, held for a few minutes, with at least 0.1 SOL lost.</span>
              </div>
            ) : (
              data.losses.map((e: RankedLoss, i) => (
                <div className="entry rise" style={stagger(i)} key={e.day + e.mint}>
                  <div className="entry-top">
                    <span className="mono dim small">{dayLabel(e.day)}</span>
                    <Badge onBoard={e.onBoard} rank={e.rank} total={e.total} />
                  </div>
                  <div className="entry-main">
                    <Link className="sym big" to={`/c/${e.mint}`}>
                      ${e.symbol.toUpperCase()}
                    </Link>
                    <div className="mv mono">
                      <span className="dim">bought</span> {fmtUsd(e.buyMcUsd)} <span className="arr">→</span> <span className="dim">sold</span> <span className="loss">{fmtUsd(e.sellMcUsd)}</span>
                    </div>
                    <div className="sc mono loss">
                      -{fmtPct(e.lossPct)}
                      <small className="loss">{lossSolText(e)}</small>
                    </div>
                  </div>
                  <div className="entry-btns">
                    <button className="btn" onClick={() => { play('click'); setShare({ type: 'loss', entry: e }); }}>
                      <ShareIcon /> Share card
                    </button>
                    <a className="btn" href={pumpUrl(e.mint)} target="_blank" rel="noopener noreferrer">
                      pump.fun <ExternalIcon />
                    </a>
                  </div>
                </div>
              ))
            )}
            <p className="dim small foot-note">Boards refresh every few minutes. Today is final at 00:00 UTC.</p>
          </>
        )}
      </div>
      {share && <ShareModal target={share} onClose={() => setShare(null)} />}
    </section>
  );
}