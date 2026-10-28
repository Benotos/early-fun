import { addDays, dayKey, isSolAddress } from '../../shared/format';
import { LossEntry, RankedLoss, RankedWin, WalletResponse, WinEntry } from '../../shared/types';
import { K } from '../lib/boards';
import { HttpError, limited, route } from '../lib/http';
import { getStore } from '../lib/store';

export default route(async ({ q, ip }) => {
  const address = (q.get('address') || '').trim();
  if (!isSolAddress(address)) throw new HttpError(400, 'bad_address', 'That is not a valid Solana wallet address');
  const store = getStore();
  if (await limited(store, 'wallet:' + ip, 60, 60)) throw new HttpError(429, 'rate_limited', 'Slow down a little');

  const today = dayKey(Math.floor(Date.now() / 1000));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const cmds = days.flatMap((d) => [
    ['HGET', K.win(d), address],
    ['HGET', K.loss(d), address],
  ]);
  const res = await store.run(cmds);
  const wins: { d: string; e: WinEntry & { r?: number } }[] = [];
  const losses: { d: string; e: LossEntry & { r?: number } }[] = [];
  days.forEach((d, i) => {
    if (res[i * 2]) wins.push({ d, e: JSON.parse(res[i * 2]) });
    if (res[i * 2 + 1]) losses.push({ d, e: JSON.parse(res[i * 2 + 1]) });
  });

  const rankCmds = [
    ...wins.flatMap((x) => [['ZREVRANK', K.zwin(x.d), address], ['ZCARD', K.zwin(x.d)]]),
    ...losses.flatMap((x) => [['ZREVRANK', K.zloss(x.d), address], ['ZCARD', K.zloss(x.d)]]),
  ];
  const rr = rankCmds.length ? await store.run(rankCmds) : [];
  let k = 0;
  const outW: RankedWin[] = wins.map((x) => {
    const raw = Number(rr[k++]) + 1;
    const total = Number(rr[k++]);
    const { r, ...e } = x.e;
    return { ...e, rank: r ? r : raw, total, onBoard: !!r };
  });
  const outL: RankedLoss[] = losses.map((x) => {
    const raw = Number(rr[k++]) + 1;
    const total = Number(rr[k++]);
    const { r, ...e } = x.e;
    return { ...e, rank: r ? r : raw, total, onBoard: !!r };
  });
  const body: WalletResponse = { ok: true, address, wins: outW, losses: outL };
  return { json: body, cache: 'public, s-maxage=15, stale-while-revalidate=60' };
});