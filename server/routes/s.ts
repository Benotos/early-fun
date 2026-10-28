import { fmtMult, fmtPct, fmtUsd, shortAddr } from '../../shared/format';
import { ShareCard } from '../../shared/types';
import { getEnv } from '../lib/env';
import { HttpError, route } from '../lib/http';
import { getStore } from '../lib/store';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default route(async ({ q, site }) => {
  const id = (q.get('id') || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) throw new HttpError(400, 'bad_id', 'Bad card id');
  const raw = await getStore().get(`share:${id}`);
  const name = getEnv('VITE_SITE_NAME') || 'EARLY.FUN';
  if (!raw) {
    return {
      status: 404,
      html: `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=/"><title>${esc(name)}</title><body style="background:#07070d;color:#f4f3ff;font-family:system-ui;padding:40px">Card not found. Taking you home...</body>`,
      cache: 'public, s-maxage=60',
    };
  }
  const card = JSON.parse(raw) as ShareCard;
  let title: string;
  let desc: string;
  let wallet: string;
  if (card.type === 'win' && card.win) {
    const w = card.win;
    title = `I was early on $${w.symbol.toUpperCase()}: bought at ${fmtUsd(w.entryMcUsd)}, ${w.realized ? 'sold at' : 'it hit'} ${fmtUsd(w.peakMcUsd)} (${fmtMult(w.mult)})`;
    desc = `Wallet ${shortAddr(w.wallet)} proved it on chain. Prove yours at ${name}.`;
    wallet = w.wallet;
  } else {
    const l = card.loss!;
    title = `I got rekt on $${l.symbol.toUpperCase()}: bought at ${fmtUsd(l.buyMcUsd)}, sold at ${fmtUsd(l.sellMcUsd)} (-${fmtPct(l.lossPct)})`;
    desc = `Wallet ${shortAddr(l.wallet)} took the L on chain. See the daily losers board at ${name}.`;
    wallet = l.wallet;
  }
  const image = `${site}/api/img?id=${id}`;
  const page = `${site}/s/${id}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(page)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<style>body{margin:0;background:#07070d;color:#f4f3ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}a{color:#8b5cff}img{max-width:92vw;border-radius:16px;border:1px solid #2a2a44}</style>
</head><body><div style="text-align:center"><img src="${esc(image)}" alt="${esc(title)}" width="1200" height="630"><p><a href="/w/${esc(wallet)}">See the wallet on ${esc(name)}</a></p></div>
<script>setTimeout(function(){location.replace("/w/${esc(wallet)}")},1200)</script></body></html>`;
  return { html, cache: 'public, s-maxage=3600, stale-while-revalidate=86400' };
});