import { addDays, dayKey, nextResetAt } from '../../shared/format';
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
    return { json: body, cache: 'no-store' };
  }
  const snap = JSON.parse(raw) as Snapshot;
  body = { ok: true, range, meta: { ...snap.meta, resetAt: nextResetAt(now) }, winners: snap.winners, losers: snap.losers };
  if (rules().winRequireSell) {
    // only wallets that actually sold count, entries scored before this rule drop off right away
    body.winners = body.winners.filter((e) => (e.outSol || 0) > 0);
  }

  // The leaderboard is rebuilt every 10 minutes, but the tracked coin counter
  // must reflect scanner progress between rebuilds. coinsum is updated after
  // each newly scanned coin and applies the 1 SOL Pump global-fee threshold.
  const today = dayKey(now);
  const coinDays = range === 'today'
    ? [today]
    : range === 'yesterday'
      ? [addDays(today, -1)]
      : Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  let freshCoinCount = 0;
  let hasFreshCoinCount = false;
  for (const day of coinDays) {
    const rawCoins = await getStore().get(K.coinsum(day));
    if (rawCoins === null) continue;
    try {
      const rows = JSON.parse(rawCoins);
      if (Array.isArray(rows)) {
        freshCoinCount += rows.length;
        hasFreshCoinCount = true;
      }
    } catch {
      // Fall back to the last good board count if a summary is temporarily malformed.
    }
  }
  if (hasFreshCoinCount) body.meta.coins = freshCoinCount;

  const bl = blockedMints();
  if (bl.size) {
    // blocked coins vanish right away, without waiting for the next rebuild
    body.winners = body.winners.filter((e) => !bl.has(e.mint));
    body.losers = body.losers.filter((e) => !bl.has(e.mint));
  }
  return { json: body, cache: 'no-store' };
});