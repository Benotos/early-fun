import { useEffect, useState } from 'react';
import { fmtMult, fmtPct, fmtUsd } from '../../shared/format';
import type { LossEntry, WinEntry } from '../../shared/types';
import { api } from '../lib/api';
import { SITE_NAME } from '../lib/config';
import { play } from '../lib/sfx';
import { copyText, downloadUrl, postOnX } from '../lib/share';
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, XIcon } from './Icons';

export type ShareTarget = { type: 'win'; entry: WinEntry } | { type: 'loss'; entry: LossEntry };

interface ShareRes {
  ok: true;
  id: string;
  url: string;
  image: string;
}

function tweetText(t: ShareTarget): string {
  if (t.type === 'win') {
    const e = t.entry;
    if (e.realized)
      return `i was early on $${e.symbol.toUpperCase()}. bought at ${fmtUsd(e.entryMcUsd)}, sold at ${fmtUsd(e.peakMcUsd)} (${fmtMult(e.mult)}${e.pnlSol !== undefined ? ', +' + e.pnlSol.toFixed(2) + ' SOL' : ''}). prove yours:`;
    return `i was early on $${e.symbol.toUpperCase()}. bought at ${fmtUsd(e.entryMcUsd)}, it hit ${fmtUsd(e.peakMcUsd)} (${fmtMult(e.mult)}). prove yours:`;
  }
  const e = t.entry;
  return `got rekt on $${e.symbol.toUpperCase()}. bought at ${fmtUsd(e.buyMcUsd)}, sold at ${fmtUsd(e.sellMcUsd)} (-${fmtPct(e.lossPct)}). the L is on chain:`;
}

export default function ShareModal({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const [res, setRes] = useState<ShareRes | null>(null);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    let alive = true;
    api<ShareRes>('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: target.entry.wallet, type: target.type, day: target.entry.day }),
    })
      .then((r) => alive && setRes(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'Could not create the card'));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [target, onClose]);

  const post = async () => {
    if (!res) return;
    setNote('');
    play('click');
    try {
      const r = await postOnX({ text: tweetText(target), url: res.url, image: res.image });
      if (r === 'copied') setNote('Image copied. Paste it into the post with Ctrl+V or Cmd+V.');
      else if (r === 'opened') setNote('Composer opened. Use Download image to attach the card.');
    } catch {
      setNote('Could not prepare the image. Try Download image instead.');
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Share card">
      <div className="modal">
        <button className="modal-x" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
        <h3>Your {SITE_NAME} card</h3>
        {err ? (
          <p className="err">{err}</p>
        ) : (
          <>
            <div className={'card-prev' + (loaded ? ' ready' : '')}>
              {res && <img src={res.image} alt="Share card" onLoad={() => {
                    setLoaded(true);
                    play('success');
                  }} onError={() => setErr('Card image failed to render, try again in a moment')} />}
              {!loaded && <div className="skel" />}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={post} disabled={!res || !loaded}>
                <XIcon size={16} /> Post on X
              </button>
              <button className="btn" onClick={() => res && downloadUrl(res.image, `${SITE_NAME.toLowerCase()}-card.png`)} disabled={!res || !loaded}>
                <DownloadIcon /> Download image
              </button>
              <button
                className="btn"
                disabled={!res}
                onClick={async () => {
                  if (res && (await copyText(res.url))) {
                    play('copy');
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 1500);
                  }
                }}
              >
                {copiedLink ? <CheckIcon /> : <CopyIcon />} Copy link
              </button>
            </div>
            {note && <p className="note">{note}</p>}
          </>
        )}
      </div>
    </div>
  );
}