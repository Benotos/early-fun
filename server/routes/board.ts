import { nextResetAt } from '../../shared/format';
import { BoardResponse, Range } from '../../shared/types';
import { K, Snapshot } from '../lib/boards';
import { blockedMints, rules } from '../lib/env';
import { HttpError, route } from '../lib/http';
import { getStore } from '../lib/store';

export default route(async ({ q }) => {
  const range = (q.get('range') || 'today') as Range;
  if (!['today', 'yesterday', 'week'].includes(range)) throw new HttpError(400, 'bad_range', 'range must be today, yesterday or week');
  const raw = await getStore().get(K.snap(range));
  const now = Math.floor(Date.now() / 1000);
  let body: BoardResponse;
  if (!raw) {
    body = {
      ok: true,
      range,
      warming: true,
      meta: { updatedAt: 0, solUsd: 0, resetAt: nextResetAt(now), days: [], coins: 0, final: false },
      winners: [],
      losers: [],
    };
    return { json: body, cache: 'public, s-maxage=10, stale-while-revalidate=30' };
  }
  const snap = JSON.parse(raw) as Snapshot;
  body = { ok: true, range, meta: { ...snap.meta, resetAt: nextResetAt(now) }, winners: snap.winners, losers: snap.losers };
  if (rules().winRequireSell) {
    // only wallets that actually sold count, entries scored before this rule drop off right away
    body.winners = body.winners.filter((e) => (e.outSol || 0) > 0);
  }
  const bl = blockedMints();
  if (bl.size) {
    // blocked coins vanish right away, without waiting for the next rebuild
    body.winners = body.winners.filter((e) => !bl.has(e.mint));
    body.losers = body.losers.filter((e) => !bl.has(e.mint));
  }
  return { json: body, cache: 'public, s-maxage=20, stale-while-revalidate=120' };
});