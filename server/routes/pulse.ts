import { PulseResponse, Records } from '../../shared/types';
import { K } from '../lib/boards';
import { blockedMints } from '../lib/env';
import { route } from '../lib/http';
import { getStore } from '../lib/store';

export default route(async () => {
  const store = getStore();
  const [snapRaw, hofRaw] = await Promise.all([store.get(K.pulse), store.get(K.hof)]);
  let base: { updatedAt: number; solUsd: number; coins: PulseResponse['coins'] } = { updatedAt: 0, solUsd: 0, coins: [] };
  let records: Records | null = null;
  try {
    if (snapRaw) base = JSON.parse(snapRaw);
  } catch {
    /* empty */
  }
  try {
    if (hofRaw) records = JSON.parse(hofRaw) as Records;
  } catch {
    records = null;
  }
  const bl = blockedMints();
  if (bl.size) {
    base.coins = (base.coins || []).filter((c) => !bl.has(c.mint));
    if (records) records = { ...records, win: records.win.filter((e) => !bl.has(e.mint)), loss: records.loss.filter((e) => !bl.has(e.mint)) };
  }
  const body: PulseResponse = { ok: true, ...base, records };
  return { json: body, cache: 'no-store' };
});