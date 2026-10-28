import { createClient } from '@libsql/client/web';
import { findTurso, findUpstash, getEnv } from './env';
import { Cmd, Store, StoreError } from './storebase';
import { SqlClient, TursoStore } from './turso';

export { Store, StoreError } from './storebase';
export type { Cmd } from './storebase';

export class UpstashStore extends Store {
  kind = 'upstash' as const;
  constructor(private url: string, private token: string) {
    super();
  }
  async run(cmds: Cmd[]): Promise<any[]> {
    if (!cmds.length) return [];
    const single = cmds.length === 1;
    const res = await fetch(single ? this.url : this.url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(single ? cmds[0] : cmds),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new StoreError('redis_bad_response', `Redis returned non JSON (${res.status}): ${text.slice(0, 120)}`);
    }
    if (!res.ok && !Array.isArray(json)) {
      throw new StoreError('redis_http_' + res.status, json?.error || 'Redis request failed', 'Check the Upstash URL and token');
    }
    if (single) {
      if (json.error) throw new StoreError('redis_error', String(json.error));
      return [json.result];
    }
    return json.map((x: any) => {
      if (x.error) throw new StoreError('redis_error', String(x.error));
      return x.result;
    });
  }
}

/** Tiny in memory redis, only the commands this app uses. For tests and mock mode. */
export class MemoryStore extends Store {
  kind = 'memory' as const;
  private kv = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();
  private sets = new Map<string, Set<string>>();
  private exp = new Map<string, number>();

  private alive(k: string): boolean {
    const e = this.exp.get(k);
    if (e !== undefined && e <= Date.now()) {
      this.kv.delete(k);
      this.hashes.delete(k);
      this.zsets.delete(k);
      this.sets.delete(k);
      this.exp.delete(k);
      return false;
    }
    return true;
  }

  private one(c: Cmd): any {
    const [name, ...a] = c as [string, ...any[]];
    const k = String(a[0]);
    this.alive(k);
    switch (name.toUpperCase()) {
      case 'GET':
        return this.kv.get(k) ?? null;
      case 'MGET':
        return a.map((key) => {
          this.alive(String(key));
          return this.kv.get(String(key)) ?? null;
        });
      case 'HLEN':
        return this.hashes.get(k)?.size ?? 0;
      case 'SCARD':
        return this.sets.get(k)?.size ?? 0;
      case 'SET': {
        const nx = a.includes('NX');
        if (nx && this.kv.has(k)) return null;
        this.kv.set(k, String(a[1]));
        const i = a.indexOf('EX');
        if (i >= 0) this.exp.set(k, Date.now() + Number(a[i + 1]) * 1000);
        else this.exp.delete(k);
        return 'OK';
      }
      case 'DEL': {
        let n = 0;
        for (const key of a.map(String)) {
          if (this.kv.delete(key) || this.hashes.delete(key) || this.zsets.delete(key) || this.sets.delete(key)) n++;
          this.exp.delete(key);
        }
        return n;
      }
      case 'INCR': {
        const n = Number(this.kv.get(k) || 0) + 1;
        this.kv.set(k, String(n));
        return n;
      }
      case 'EXPIRE':
        this.exp.set(k, Date.now() + Number(a[1]) * 1000);
        return 1;
      case 'HSET': {
        const h = this.hashes.get(k) || new Map<string, string>();
        for (let i = 1; i + 1 < a.length; i += 2) h.set(String(a[i]), String(a[i + 1]));
        this.hashes.set(k, h);
        return 1;
      }
      case 'HGET':
        return this.hashes.get(k)?.get(String(a[1])) ?? null;
      case 'HGETALL': {
        const h = this.hashes.get(k);
        return h ? [...h.entries()].flat() : [];
      }
      case 'ZADD': {
        const z = this.zsets.get(k) || new Map<string, number>();
        for (let i = 1; i + 1 < a.length; i += 2) z.set(String(a[i + 1]), Number(a[i]));
        this.zsets.set(k, z);
        return 1;
      }
      case 'ZCARD':
        return this.zsets.get(k)?.size ?? 0;
      case 'ZREVRANK': {
        const z = this.zsets.get(k);
        const m = String(a[1]);
        if (!z || !z.has(m)) return null;
        const sorted = [...z.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
        return sorted.findIndex((e) => e[0] === m);
      }
      case 'SADD': {
        const s = this.sets.get(k) || new Set<string>();
        for (const m of a.slice(1)) s.add(String(m));
        this.sets.set(k, s);
        return 1;
      }
      case 'SMEMBERS':
        return [...(this.sets.get(k) || [])];
      case 'RENAME': {
        const to = String(a[1]);
        for (const m of [this.kv, this.hashes, this.zsets, this.sets] as Map<string, any>[]) {
          if (m.has(k)) {
            m.set(to, m.get(k));
            m.delete(k);
          }
        }
        this.exp.delete(to);
        return 'OK';
      }
      case 'PING':
        return 'PONG';
      default:
        throw new Error('MemoryStore: unsupported command ' + name);
    }
  }

  async run(cmds: Cmd[]): Promise<any[]> {
    return cmds.map((c) => this.one(c));
  }
}

let cached: Store | null = null;

export function getStore(): Store {
  const g = globalThis as any;
  if (g.__EARLY_STORE__) return g.__EARLY_STORE__ as Store;
  if (cached) return cached;
  const tu = findTurso();
  if (tu && getEnv('STORE') !== 'upstash') {
    cached = new TursoStore(createClient({ url: tu.url, authToken: tu.token }) as unknown as SqlClient);
    return cached;
  }
  const up = findUpstash();
  if (!up) {
    throw new StoreError(
      'no_database',
      'No database env vars found',
      'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or the Upstash KV_REST_API_URL and KV_REST_API_TOKEN) in Vercel, then redeploy'
    );
  }
  cached = new UpstashStore(up.url, up.token);
  return cached;
}