import { HeliusChain } from '../lib/chain';
import { findTurso, findUpstash, getEnv } from '../lib/env';
import { route } from '../lib/http';
import { getStore } from '../lib/store';

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout after ' + ms + 'ms')), ms))]);

export default route(async () => {
  const up = findUpstash();
  const tu = findTurso();
  const env = {
    HELIUS_API_KEY: !!getEnv('HELIUS_API_KEY'),
    ADMIN_KEY: !!getEnv('ADMIN_KEY'),
    CRON_SECRET: !!getEnv('CRON_SECRET'),
    SITE_URL: !!getEnv('SITE_URL'),
    TURSO: tu ? { set: true } : { set: false },
    UPSTASH_REST: up ? { set: true, prefix: up.prefix || '(none)' } : { set: false },
    VITE_TOKEN_CA: !!getEnv('VITE_TOKEN_CA'),
  };

  let db: { ok: boolean; detail: string } = { ok: false, detail: 'not checked' };
  try {
    const store = getStore();
    await withTimeout(store.set('health:ping', String(Date.now()), 60), 6000);
    const v = await withTimeout(store.get('health:ping'), 6000);
    db = { ok: !!v, detail: v ? `read and write ok (${store.kind})` : 'wrote but could not read back' };
  } catch (e) {
    db = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  let rpc: { ok: boolean; detail: string } = { ok: false, detail: 'HELIUS_API_KEY not set' };
  if (env.HELIUS_API_KEY) {
    try {
      rpc = await withTimeout(new HeliusChain().probe(), 14000);
    } catch (e) {
      rpc = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  let lastScan: unknown = null;
  if (db.ok) {
    try {
      const raw = await getStore().get('scan:last');
      lastScan = raw ? JSON.parse(raw) : null;
    } catch {
      lastScan = null;
    }
  }
  const ageSec = lastScan && typeof (lastScan as any).at === 'number' ? Math.floor(Date.now() / 1000) - (lastScan as any).at : null;
  return {
    json: { ok: db.ok && rpc.ok, time: new Date().toISOString(), env, db, rpc, lastScan, lastScanAgeSec: ageSec },
  };
});