import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { fmtMult, fmtSol, isSolAddress, shortAddr } from '../../shared/format';
import { walletStats } from '../../shared/stats';
import { tierFor } from '../../shared/tiers';
import type { WalletResponse } from '../../shared/types';
import Avatar from '../components/Avatar';
import { CheckIcon, CopyIcon } from '../components/Icons';
import { useWallet } from '../lib/api';
import { useMe } from '../lib/me';
import { play } from '../lib/sfx';
import { copyText } from '../lib/share';

function Picker() {
  const [sp] = useSearchParams();
  const [me] = useMe();
  const [a, setA] = useState(sp.get('a') || me || '');
  const [b, setB] = useState(sp.get('b') || '');
  const [err, setErr] = useState('');
  const nav = useNavigate();
  const go = (e: FormEvent) => {
    e.preventDefault();
    const x = a.trim();
    const y = b.trim();
    if (!isSolAddress(x) || !isSolAddress(y)) {
      play('error');
      setErr('Both fields need a valid Solana wallet address');
      return;
    }
    if (x === y) {
      play('error');
      setErr('Pick two different wallets');
      return;
    }
    play('whoosh');
    nav(`/duel/${x}/${y}`);
  };
  return (
    <form className="duel-form" onSubmit={go} noValidate>
      <label>
        <span className="mono small dim">WALLET A</span>
        <input className="mono" value={a} onChange={(e) => { setA(e.target.value); setErr(''); }} placeholder="Your wallet" spellCheck={false} autoComplete="off" />
      </label>
      <span className="vs mono">VS</span>
      <label>
        <span className="mono small dim">WALLET B</span>
        <input className="mono" value={b} onChange={(e) => { setB(e.target.value); setErr(''); }} placeholder="Their wallet" spellCheck={false} autoComplete="off" />
      </label>
      <button className="btn btn-primary" type="submit">
        Fight
      </button>
      {err && <div className="err duel-err">{err}</div>}
    </form>
  );
}

function Side({ address, data, crown }: { address: string; data: WalletResponse | null; crown: boolean }) {
  const st = data ? walletStats(data) : null;
  const tier = st ? tierFor(st.bestWin?.mult ?? 0, st.bestLoss?.lossSol ?? 0, st.netRealizedSol) : null;
  return (
    <div className={'duel-side' + (crown ? ' crown' : '')}>
      {crown && <span className="crown-i" aria-label="Winner">♛</span>}
      <Avatar address={address} size={64} />
      <Link className="mono duel-addr" to={`/w/${address}`}>
        {shortAddr(address)}
      </Link>
      {tier && <span className={'tier ' + tier.tone}>{tier.name}</span>}
    </div>
  );
}

export default function Duel() {
  const { a = '', b = '' } = useParams();
  const both = isSolAddress(a) && isSolAddress(b);
  const wa = useWallet(both ? a : '');
  const wb = useWallet(both ? b : '');
  const [copied, setCopied] = useState(false);

  if (!a && !b) {
    return (
      <section className="section">
        <div className="wrap narrow">
          <div className="eyebrow mono">WALLET VS WALLET</div>
          <h2>Duel</h2>
          <p className="dim sub-lede">Who was actually earlier? Put two wallets head to head and settle it on chain.</p>
          <Picker />
        </div>
      </section>
    );
  }
  if (!both) {
    return (
      <section className="section">
        <div className="wrap narrow">
          <h2>Invalid duel</h2>
          <p className="dim">One of the addresses is not a valid Solana wallet.</p>
          <Picker />
        </div>
      </section>
    );
  }

  const sa = wa.data ? walletStats(wa.data) : null;
  const sb = wb.data ? walletStats(wb.data) : null;
  const ready = !!sa && !!sb;
  const ma = sa?.bestWin?.mult ?? 0;
  const mb = sb?.bestWin?.mult ?? 0;
  const winner = ready && ma !== mb ? (ma > mb ? 'a' : 'b') : ready && (ma > 0 || mb > 0) ? null : null;

  type Row = { k: string; a: string; b: string; w: 'a' | 'b' | null; tone?: string };
  const rows: Row[] = ready
    ? [
        { k: 'Best entry', a: ma ? fmtMult(ma) : '-', b: mb ? fmtMult(mb) : '-', w: ma === mb ? null : ma > mb ? 'a' : 'b', tone: 'win' },
        { k: 'Days with a win', a: String(sa!.winDays), b: String(sb!.winDays), w: sa!.winDays === sb!.winDays ? null : sa!.winDays > sb!.winDays ? 'a' : 'b', tone: 'win' },
        { k: 'Verified entries on boards', a: String(sa!.boardCount), b: String(sb!.boardCount), w: sa!.boardCount === sb!.boardCount ? null : sa!.boardCount > sb!.boardCount ? 'a' : 'b' },
        {
          k: 'Biggest loss (rekt crown)',
          a: sa!.bestLoss ? '-' + fmtSol(sa!.bestLoss.lossSol) + ' SOL' : '-',
          b: sb!.bestLoss ? '-' + fmtSol(sb!.bestLoss.lossSol) + ' SOL' : '-',
          w: (sa!.bestLoss?.lossSol ?? 0) === (sb!.bestLoss?.lossSol ?? 0) ? null : (sa!.bestLoss?.lossSol ?? 0) > (sb!.bestLoss?.lossSol ?? 0) ? 'a' : 'b',
          tone: 'loss',
        },
      ]
    : [];

  return (
    <section className="section">
      <div className="wrap narrow">
        <Link to="/duel" className="back mono small">
          ← new duel
        </Link>
        <div className="eyebrow mono">WALLET VS WALLET</div>
        <h2>Duel</h2>
        {(wa.error || wb.error) && <div className="panel empty err">{wa.error || wb.error}</div>}
        <div className="duel-arena">
          <Side address={a} data={wa.data} crown={winner === 'a'} />
          <span className="vs mono">VS</span>
          <Side address={b} data={wb.data} crown={winner === 'b'} />
        </div>
        {!ready && !wa.error && !wb.error && (
          <div className="panel">
            <div className="skel tall" />
          </div>
        )}
        {ready && (
          <>
            <div className="verdict">
              {winner ? (
                <>
                  <b>{shortAddr(winner === 'a' ? a : b)}</b> was earlier. {fmtMult(Math.max(ma, mb))} vs {Math.min(ma, mb) > 0 ? fmtMult(Math.min(ma, mb)) : 'no qualifying entry'}.
                </>
              ) : ma === 0 && mb === 0 ? (
                'Neither wallet has a qualifying early buy in the last 7 days.'
              ) : (
                'Dead heat.'
              )}
            </div>
            <div className="panel duel-table">
              {rows.map((r) => (
                <div className="duel-row" key={r.k}>
                  <span className={'mono duel-v ' + (r.tone || '') + (r.w === 'a' ? ' w' : '')}>{r.a}</span>
                  <span className="duel-k mono small dim">{r.k}</span>
                  <span className={'mono duel-v ' + (r.tone || '') + (r.w === 'b' ? ' w' : '')}>{r.b}</span>
                </div>
              ))}
            </div>
            <button
              className="btn"
              onClick={async () => {
                if (await copyText(window.location.href)) {
                  play('copy');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Link copied' : 'Copy duel link'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}