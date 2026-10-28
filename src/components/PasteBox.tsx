import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSolAddress } from '../../shared/format';
import { play } from '../lib/sfx';
import { getMe, setMe } from '../lib/me';
import { SearchIcon } from './Icons';

export default function PasteBox({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  const nav = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = v.trim();
    if (!isSolAddress(a)) {
      play('error');
      setErr('That is not a valid Solana wallet address');
      return;
    }
    setErr('');
    play('whoosh');
    if (!getMe()) setMe(a);
    nav(`/w/${a}`);
  };
  return (
    <form className="paste" onSubmit={submit} noValidate>
      <div className={'paste-row' + (err ? ' bad' : '')}>
        <span className="paste-ico">
          <SearchIcon />
        </span>
        <input
          className="mono"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            if (err) setErr('');
          }}
          placeholder="Paste a Solana wallet address"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Solana wallet address"
        />
        <button type="submit" className="btn btn-primary">
          Prove it
        </button>
      </div>
      <div className="paste-note">{err ? <span className="err">{err}</span> : 'Read only. No wallet connect, no signing.'}</div>
    </form>
  );
}