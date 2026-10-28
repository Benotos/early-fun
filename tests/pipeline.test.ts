import { beforeEach, describe, expect, it } from 'vitest';
import { K, readDayBoard } from '../server/lib/boards';
import { loadCoin, runScan } from '../server/lib/scanner';
import { MemoryStore } from '../server/lib/store';
import { NOW, buildWorld, freshStore, t } from './helpers';

let store: MemoryStore;
beforeEach(() => {
  store = freshStore();
});

async function scanAll(world: ReturnType<typeof buildWorld>, now = NOW, max = 40) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await runScan({ store, chain: world.chain, budgetMs: 20000, now, forceRebuild: true });
    if (last.changed === 0 && last.newCoins === 0) break;
  }
  return last!;
}

describe('end to end scan with synthetic chain', () => {
  it('ranks winners and losers and applies every anti abuse rule', async () => {
    const world = buildWorld();
    const rep = await scanAll(world);
    expect(rep.status).toBe('ok');
    const board = (await readDayBoard(store, '2026-10-26'))!;
    const w = world.wallets;
    const winners = board.winners.map((x) => x.wallet);

    // order and formula: peak 20000 (in SOL mc) over entry
    expect(winners[0]).toBe(w.e1);
    const e1 = board.winners[0];
    expect(e1.mult).toBeCloseTo(20000 / 30, 3);
    expect(e1.entryMcUsd).toBeCloseTo(30 * 150, 1);
    expect(e1.peakMcUsd).toBeCloseTo(20000 * 150, 1);
    expect(e1.symbol).toBe('AAA');
    expect(winners).toContain(w.e4);
    expect(board.winners.find((x) => x.wallet === w.e4)!.mult).toBeCloseTo(20000 / 60, 3);

    // rules
    expect(winners).not.toContain(w.dev); // dev excluded
    expect(winners).not.toContain(w.sniper); // creation window
    expect(winners).not.toContain(w.e2dust); // below 0.1 SOL
    expect(winners).not.toContain(w.e3devfunded); // funded by dev
    // cluster: e5 and e6 share a normal funder, only the better one stays
    expect(winners.includes(w.e5) !== winners.includes(w.e6)).toBe(true);
    expect(winners).toContain(w.e5);
    // hub funded wallets are not clustered
    expect(winners).toContain(w.e7hub);
    expect(winners).toContain(w.e8hub);
    // the trade after the day ended did not move the peak
    expect(Math.max(...board.winners.map((x) => x.peakMcUsd))).toBeCloseTo(20000 * 150, 1);

    // losers
    const losers = board.losers.map((x) => x.wallet);
    expect(losers[0]).toBe(w.l2);
    const l2 = board.losers[0];
    expect(l2.lossSol).toBeCloseTo(18, 5);
    expect(l2.lossPct).toBeCloseTo(90, 5);
    expect(l2.buyMcUsd).toBeCloseTo(8000 * 150, 1);
    expect(l2.sellMcUsd).toBeCloseTo(800 * 150, 1);
    expect(losers).toContain(w.l1);
    expect(board.losers.find((x) => x.wallet === w.l1)!.lossSol).toBeCloseTo(1.8, 5);
    expect(losers).not.toContain(w.farmer); // dumped inside the minimum hold
    expect(losers).not.toContain(w.sniper);
    expect(losers).not.toContain(w.dev);
  });

  it('coin becomes final after the day ended and the board is marked final', async () => {
    const world = buildWorld();
    await scanAll(world, NOW);
    expect((await readDayBoard(store, '2026-10-26'))!.final).toBe(false);
    await scanAll(world, t(0, 30, 0, 27));
    const coin = (await loadCoin(store, world.mint))!;
    expect(coin.final).toBe(true);
    const b = (await readDayBoard(store, '2026-10-26'))!;
    expect(b.final).toBe(true);
    expect(b.winners[0].wallet).toBe(world.wallets.e1);
  });

  it('paging with a tiny page size and many resumed scans gives the same boards', async () => {
    const a = buildWorld(1000);
    await scanAll(a);
    const ba = (await readDayBoard(store, '2026-10-26'))!;
    store = freshStore();
    const b = buildWorld(5);
    await scanAll(b);
    const bb = (await readDayBoard(store, '2026-10-26'))!;
    // wallets differ between worlds (random keys), so compare shapes: scores and order
    expect(bb.winners.map((x) => Math.round(x.mult * 1000))).toEqual(ba.winners.map((x) => Math.round(x.mult * 1000)));
    expect(bb.losers.map((x) => Math.round(x.lossSol * 1000))).toEqual(ba.losers.map((x) => Math.round(x.lossSol * 1000)));
  });

  it('retains wallet trade history outside the capped coin summary', async () => {
    const world = buildWorld();
    await scanAll(world);
    const address = world.wallets.e1;
    const before = await store.cmd('HGET', K.walletCoin(world.mint), address);
    expect(typeof before).toBe('string');
    const ledger = JSON.parse(String(before));
    expect(ledger.pnl.bs).toBeGreaterThan(0);
    expect(ledger.pnl.bt).toBeGreaterThan(0);

    // Simulate the compact coin blob pruning a smaller wallet to stay under
    // its size limit. The independent wallet ledger must survive unchanged.
    const state = (await loadCoin(store, world.mint))!;
    delete state.pnl[address];
    delete state.buys[address];
    await (await import('../server/lib/scanner')).saveCoin(store, state);
    const after = await store.cmd('HGET', K.walletCoin(world.mint), address);
    expect(after).toBe(before);
  });

  it('incremental rescans do not double count trades', async () => {
    const world = buildWorld();
    await scanAll(world);
    const before = (await loadCoin(store, world.mint))!;
    await runScan({ store, chain: world.chain, budgetMs: 20000, now: NOW + 600, forceRebuild: true });
    await runScan({ store, chain: world.chain, budgetMs: 20000, now: NOW + 1200, forceRebuild: true });
    const after = (await loadCoin(store, world.mint))!;
    expect(after.trades).toBe(before.trades);
    expect(Object.keys(after.pnl).length).toBe(Object.keys(before.pnl).length);
  });

  it('aborts without touching state when the RPC sanity check fails', async () => {
    const world = buildWorld();
    world.chain.probeOk = false;
    const rep = await runScan({ store, chain: world.chain, budgetMs: 5000, now: NOW });
    expect(rep.status).toBe('aborted');
    expect(await store.get('mig:cursor')).toBeNull();
    expect(await store.smembers(K.coins('2026-10-26'))).toEqual([]);
    expect(await store.get(K.board('2026-10-26'))).toBeNull();
  });

  it('funding lookup failures never put unverified wallets on the board', async () => {
    const world = buildWorld();
    world.chain.fundingFails = true;
    await scanAll(world);
    const board = (await readDayBoard(store, '2026-10-26'))!;
    expect(board.winners).toEqual([]);
    expect(board.verify!.errors).toBeGreaterThan(0);
  });

  it('refuses to run twice at once', async () => {
    const world = buildWorld();
    await store.set('scan:lock', '1', 60);
    const rep = await runScan({ store, chain: world.chain, budgetMs: 5000, now: NOW });
    expect(rep.status).toBe('locked');
  });
});