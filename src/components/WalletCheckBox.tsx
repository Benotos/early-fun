import { useState } from 'react';
import { isSolAddress } from '../../shared/format';
import { WalletCheck, WalletCheckResponse } from '../../shared/types';
import { api } from '../lib/api';
import { play } from '../lib/sfx';

function List({ title, items }: { title: string; items: WalletCheck[] }) {
  if (!items.length) return null;
  return (
    <div className="wc-list">
      <h5 className="mono">{title}</h5>
      {items.map((c, i) => (
        <div className={'wc-row ' + (c.ok ? 'pass' : 'fail')} key={i}>
          <span className="wc-ic">{c.ok ? '✓' : '✕'}</span>
          <span>{c.text}</span>
        </div>
      ))}
    </div>
  );
}

/** "Why isn't my wallet here?" checker for one coin. */
export default function WalletCheckBox({ mint }: { mint: string }) {
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<WalletCheckResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    const a = addr.trim();
    if (!isSolAddress(a)) {
      setRes(null);
      setErr('That is not a valid Solana wallet address.');
      play('error');
      return;
    }
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await api<WalletCheckResponse>(`/api/coindata?mint=${encodeURIComponent(mint)}&wallet=${encodeURIComponent(a)}`);
      setRes(r);
      play('success');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Check failed, try again.');
      play('error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel wc">
      <div className="admin-h">
        <h4>Check a wallet on this coin</h4>
      </div>
      <p className="dim small wc-sub">Paste a wallet to see every rule it passes or fails here, and why it is or is not on the board.</p>
      <form
        className="wc-form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input className="mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Wallet address" spellCheck={false} autoComplete="off" />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Check'}
        </button>
      </form>
      {err && <div className="err small wc-err">{err}</div>}
      {res && (
        <div className="wc-out">
          <p className="wc-verdict">{res.verdict}</p>
          {res.coinIssues.length > 0 && <List title="COIN CHECKS" items={res.coinIssues.map((t) => ({ ok: false, text: t }))} />}
          <div className="two wc-two">
            <List title="AS A WINNER" items={res.winner} />
            <List title="AS A LOSER" items={res.loser} />
          </div>
          {res.tracked && (
            <p className="dim small mono">
              {res.scan.trades.toLocaleString('en-US')} trades read · {res.scan.complete ? 'coin fully read' : 'still reading this coin'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}