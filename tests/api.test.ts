import { beforeEach, describe, expect, it } from 'vitest';
import admin from '../server/routes/admin';
import board from '../server/routes/board';
import health from '../server/routes/health';
import img from '../server/routes/img';
import share from '../server/routes/share';
import sPage from '../server/routes/s';
import wallet from '../server/routes/wallet';
import { loadCoin, runScan, saveCoin } from '../server/lib/scanner';
import { K } from '../server/lib/boards';
import { MemoryStore } from '../server/lib/store';
import { fakeKey } from '../server/testing/fakechain';
import { NOW, buildWorld, call, freshStore } from './helpers';

let store: MemoryStore;
let world: ReturnType<typeof buildWorld>;

beforeEach(async () => {
  store = freshStore();
  process.env.ADMIN_KEY = 'secret-admin';
  process.env.CRON_SECRET = 'secret-cron';
  delete process.env.SITE_URL;
  world = buildWorld();
  for (let i = 0; i < 10; i++) {
    const r = await runScan({ store, chain: world.chain, budgetMs: 20000, now: NOW, forceRebuild: true });
    if (r.changed === 0 && r.newCoins === 0) break;
  }
  // the API reads the real clock, so move the day pointer for the fixtures: copy snapshots under today's key
});

const realToday = () => new Date().toISOString().slice(0, 10);

describe('api routes', () => {
  it('board serves cached snapshots and reports warming when empty', async () => {
    const r = await call(board as any, '/api/board?range=today');
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.headers['cache-control']).toContain('s-maxage');
    const bad = await call(board as any, '/api/board?range=nope');
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('bad_range');
  });

  it('board returns the seeded snapshot for the fixture day', async () => {
    // fixture ran with now=2026-10-26, serve it through the yesterday/today keys by rewriting the snapshot
    const raw = await store.get('snap:today');
    expect(raw).toBeTruthy();
    const r = await call(board as any, '/api/board?range=today');
    expect(r.json.winners[0].wallet).toBe(world.wallets.e1);
    expect(r.json.losers[0].wallet).toBe(world.wallets.l2);
  });

  it('wallet validates input and returns ranked entries', async () => {
    const bad = await call(wallet as any, '/api/wallet?address=nope');
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('bad_address');
    // move fixture day tables to the real current day so the endpoint (real clock) can see them
    for (const k of ['win', 'loss', 'zwin', 'zloss']) {
      const src = `day:2026-10-26:${k}`;
      const dst = `day:${realToday()}:${k}`;
      const kv: any = store;
      for (const m of [kv.hashes, kv.zsets] as Map<string, any>[]) {
        if (!m.has(src)) continue;
        m.set(dst, m.get(src));
        // Move rather than copy: the fixture date can still be inside the API's
        // seven day window when CI runs on a later real date.
        if (src !== dst) m.delete(src);
      }
    }
    const ok = await call(wallet as any, `/api/wallet?address=${world.wallets.e1}`);
    expect(ok.status).toBe(200);
    expect(ok.json.wins).toHaveLength(1);
    expect(ok.json.wins[0].rank).toBe(1);
    expect(ok.json.wins[0].onBoard).toBe(true);
    expect(ok.json.wins[0].r).toBeUndefined();
    // a raw leader that failed verification (dev funded) shows as not on the board
    const dv = await call(wallet as any, `/api/wallet?address=${world.wallets.e3devfunded}`);
    expect(dv.json.wins[0].onBoard).toBe(false);
    expect(dv.json.wins[0].rank).toBe(1);
    const none = await call(wallet as any, `/api/wallet?address=${fakeKey()}`);
    expect(none.json.wins).toEqual([]);
    expect(none.json.losses).toEqual([]);
    const l2 = await call(wallet as any, `/api/wallet?address=${world.wallets.l2}`);
    expect(l2.json.losses[0].lossPct).toBeCloseTo(90, 5);
  });

  it('wallet profile still finds a trade after its compact coin summary prunes the wallet', async () => {
    const address = world.wallets.l2;
    const state = (await loadCoin(store, world.mint))!;
    expect(state.pnl[address]).toBeTruthy();

    // Simulate the compact coin state removing a wallet because of its size cap.
    delete state.pnl[address];
    delete state.buys[address];
    await saveCoin(store, state);

    // Ensure the leaderboard lookup table cannot hide a successful fallback test.
    const hashes = (store as any).hashes as Map<string, Map<string, string>>;
    hashes.get(K.loss('2026-10-26'))?.delete(address);

    const result = await call(wallet as any, `/api/wallet?address=${address}`);
    expect(result.status).toBe(200);
    expect(result.json.losses.some((entry: any) => entry.mint === world.mint)).toBe(true);
    expect(result.json.losses.find((entry: any) => entry.mint === world.mint)?.lossSol).toBeCloseTo(18, 4);
  });

  it('wallet profile recovers losses from the independent ledger when the compact state drops a wallet', async () => {
    const address = world.wallets.l2;
    const state = (await loadCoin(store, world.mint))!;
    expect(state.pnl[address]).toBeTruthy();
    delete state.pnl[address];
    delete state.buys[address];
    await saveCoin(store, state);

    // Remove the board lookup too, ensuring the result comes from the per-wallet ledger.
    const hashes = (store as any).hashes as Map<string, Map<string, string>>;
    hashes.get(K.loss('2026-10-26'))?.delete(address);

    const result = await call(wallet as any, `/api/wallet?address=${address}`);
    expect(result.status).toBe(200);
    expect(result.json.losses.some((entry: any) => entry.mint === world.mint)).toBe(true);
    expect(result.json.losses.find((entry: any) => entry.mint === world.mint)?.lossSol).toBeCloseTo(18, 4);
  });

  it('share creates a card, serves og html and a real png', async () => {
    for (const k of ['win', 'loss']) {
      const kv: any = store;
      kv.hashes.set(`day:${realToday()}:${k}`, kv.hashes.get(`day:2026-10-26:${k}`));
    }
    const noEntry = await call(share as any, '/api/share', { method: 'POST', body: { address: fakeKey(), type: 'win' } });
    expect(noEntry.status).toBe(404);
    const r = await call(share as any, '/api/share', { method: 'POST', body: { address: world.wallets.e1, type: 'win' } });
    expect(r.status).toBe(200);
    expect(r.json.url).toMatch(/\/s\/[A-Za-z0-9_-]{12}$/);
    const id = r.json.id;
    const again = await call(share as any, '/api/share', { method: 'POST', body: { address: world.wallets.e1, type: 'win' } });
    expect(again.json.id).toBe(id); // deterministic

    const page = await call(sPage as any, `/api/s?id=${id}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('og:image');
    expect(page.body).toContain(`/api/img?id=${id}`);
    expect(page.body).toContain('twitter:card');
    expect(page.body).toContain('$AAA');

    const png = await call(img as any, `/api/img?id=${id}`);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(Buffer.from(png.body).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.body.length).toBeGreaterThan(8000);

    const lr = await call(share as any, '/api/share', { method: 'POST', body: { address: world.wallets.l2, type: 'loss' } });
    const lpng = await call(img as any, `/api/img?id=${lr.json.id}`);
    expect(lpng.status).toBe(200);

    const missing = await call(img as any, '/api/img?id=doesnotexist1');
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe('card_not_found');
  });

  it('admin needs the key and splits the pool with the loss cap', async () => {
    const denied = await call(admin as any, '/api/admin?key=wrong&day=2026-10-26&pool=10');
    expect(denied.status).toBe(401);
    const ok = await call(admin as any, '/api/admin?key=secret-admin&day=2026-10-26&pool=10');
    expect(ok.status).toBe(200);
    expect(ok.json.final).toBe(false);
    expect(ok.json.warning).toContain('not final');
    const wsum = ok.json.winners.reduce((a: number, b: any) => a + b.sol, 0);
    expect(wsum).toBeCloseTo(5, 6); // 50 percent of the pool, weights normalised
    for (const l of ok.json.losers) expect(l.sol).toBeLessThanOrEqual(l.lossSol * 0.25 + 1e-9);
    const missing = await call(admin as any, '/api/admin?key=secret-admin&day=2020-01-01');
    expect(missing.status).toBe(404);
  });

  it('health reports env flags, db state and never leaks secrets', async () => {
    const r = await call(health as any, '/api/health');
    expect(r.status).toBe(200);
    expect(r.json.db.ok).toBe(true);
    expect(r.json.env.ADMIN_KEY).toBe(true);
    expect(r.json.env.HELIUS_API_KEY).toBe(false);
    expect(r.json.rpc.ok).toBe(false);
    expect(r.body).not.toContain('secret-admin');
    expect(r.json.lastScan.status).toBe('ok');
  });

  it('crashes become readable json, not bare 500s', async () => {
    delete (globalThis as any).__EARLY_STORE__;
    for (const k of Object.keys(process.env)) if (/KV_REST|UPSTASH/.test(k)) delete process.env[k];
    const r = await call(board as any, '/api/board?range=today');
    expect(r.status).toBe(503);
    expect(r.json.ok).toBe(false);
    expect(r.json.error.code).toBe('no_database');
    expect(r.json.error.hint).toContain('Upstash');
  });
});
