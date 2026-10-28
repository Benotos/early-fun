import { createHash } from 'node:crypto';
import { addDays, dayKey, isSolAddress } from '../../shared/format';
import { LossEntry, ShareCard, WinEntry } from '../../shared/types';
import { K } from '../lib/boards';
import { HttpError, limited, route } from '../lib/http';
import { getStore } from '../lib/store';

export default route(async ({ req, body, ip, site }) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
  const address = String(body?.address || '').trim();
  const type = body?.type === 'loss' ? 'loss' : 'win';
  if (!isSolAddress(address)) throw new HttpError(400, 'bad_address', 'Invalid wallet address');
  const store = getStore();
  if (await limited(store, 'share:' + ip, 30, 60)) throw new HttpError(429, 'rate_limited', 'Slow down a little');

  const today = dayKey(Math.floor(Date.now() / 1000));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.day || '')) ? String(body.day) : today;
  const age = (Date.parse(today) - Date.parse(day)) / 86400000;
  if (age < 0 || age > 7) throw new HttpError(400, 'bad_day', 'Day out of range');

  const raw = await store.hget(type === 'win' ? K.win(day) : K.loss(day), address);
  if (!raw) throw new HttpError(404, 'no_entry', `No qualifying ${type === 'win' ? 'early buy' : 'loss'} found for that wallet on ${day}`);
  const { r: _r, ...entry } = JSON.parse(raw) as (WinEntry | LossEntry) & { r?: number };

  const key = type === 'win' ? Math.round((entry as WinEntry).mult * 100) : Math.round((entry as LossEntry).lossSol * 100);
  const id = createHash('sha1').update(`${type}|${day}|${address}|${entry.mint}|${key}`).digest('base64url').slice(0, 12);
  const card: ShareCard = {
    id,
    type,
    createdAt: Math.floor(Date.now() / 1000),
    ...(type === 'win' ? { win: entry as WinEntry } : { loss: entry as LossEntry }),
  };
  await store.set(`share:${id}`, JSON.stringify(card), 60 * 60 * 24 * 30);
  return { json: { ok: true, id, url: `${site}/s/${id}`, image: `${site}/api/img?id=${id}` } };
});