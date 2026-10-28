import { addDays, dayKey } from '../../shared/format';
import { readDayBoard } from '../lib/boards';
import { getEnv, rules } from '../lib/env';
import { HttpError, route, safeEqual } from '../lib/http';
import { weightsFor } from '../lib/scoring';
import { getStore } from '../lib/store';

export default route(async ({ req, q }) => {
  const adminKey = getEnv('ADMIN_KEY');
  if (!adminKey) throw new HttpError(503, 'admin_disabled', 'ADMIN_KEY is not set on the server');
  const given = q.get('key') || String(req.headers['x-admin-key'] || '');
  if (!given || !safeEqual(given, adminKey)) throw new HttpError(401, 'unauthorized', 'Bad admin key');

  const today = dayKey(Math.floor(Date.now() / 1000));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get('day') || '') ? q.get('day')! : addDays(today, -1);
  const pool = Math.max(0, Number(q.get('pool')) || 0);
  const r = rules();
  const board = await readDayBoard(getStore(), day);
  if (!board) throw new HttpError(404, 'no_board', `No board stored for ${day}`);

  const winPool = pool * r.winnersShare;
  const lossPool = pool - winPool;
  const wEntries = board.winners.slice(0, r.payoutWeights.length);
  const lEntries = board.losers.slice(0, r.payoutWeights.length);
  const ww = weightsFor(wEntries.length, r.payoutWeights);
  const lw = weightsFor(lEntries.length, r.payoutWeights);

  const winners = wEntries.map((e, i) => ({
    rank: i + 1,
    wallet: e.wallet,
    symbol: e.symbol,
    mint: e.mint,
    mult: e.mult,
    entryMcUsd: e.entryMcUsd,
    peakMcUsd: e.peakMcUsd,
    sol: winPool * ww[i],
  }));
  const losers = lEntries.map((e, i) => {
    const raw = lossPool * lw[i];
    const cap = r.lossCapPct * e.lossSol;
    return {
      rank: i + 1,
      wallet: e.wallet,
      symbol: e.symbol,
      mint: e.mint,
      lossSol: e.lossSol,
      lossPct: e.lossPct,
      sol: Math.min(raw, cap),
      capped: raw > cap,
    };
  });
  const paidW = winners.reduce((a, b) => a + b.sol, 0);
  const paidL = losers.reduce((a, b) => a + b.sol, 0);
  return {
    json: {
      ok: true,
      day,
      final: board.final,
      updatedAt: board.updatedAt,
      coins: board.coins,
      verify: board.verify,
      rules: { winnersShare: r.winnersShare, lossCapPct: r.lossCapPct, weights: r.payoutWeights },
      pool,
      winners,
      losers,
      totals: { winnersSol: paidW, losersSol: paidL, unspentSol: Math.max(0, pool - paidW - paidL) },
      warning: board.final ? null : 'Board is not final yet. Do not pay out until final is true.',
    },
  };
});