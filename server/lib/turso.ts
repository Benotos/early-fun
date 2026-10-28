import { Cmd, Store, StoreError } from './storebase';

/** the small part of the libsql client this store needs */
export interface SqlClient {
  batch(stmts: { sql: string; args?: any[] }[], mode?: 'write' | 'read' | 'deferred'): Promise<{ rows: any[][]; rowsAffected: number }[]>;
  execute(stmt: string | { sql: string; args?: any[] }): Promise<{ rows: any[][]; rowsAffected: number }>;
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS hs (k TEXT NOT NULL, f TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (k, f))',
  'CREATE TABLE IF NOT EXISTS zs (k TEXT NOT NULL, m TEXT NOT NULL, s REAL NOT NULL, PRIMARY KEY (k, m))',
  'CREATE TABLE IF NOT EXISTS st (k TEXT NOT NULL, m TEXT NOT NULL, PRIMARY KEY (k, m))',
  'CREATE TABLE IF NOT EXISTS ex (k TEXT PRIMARY KEY, at INTEGER)',
  'CREATE INDEX IF NOT EXISTS ex_at ON ex (at)',
  `CREATE TRIGGER IF NOT EXISTS ex_purge AFTER DELETE ON ex BEGIN
     DELETE FROM kv WHERE k = OLD.k;
     DELETE FROM hs WHERE k = OLD.k;
     DELETE FROM zs WHERE k = OLD.k;
     DELETE FROM st WHERE k = OLD.k;
   END`,
];

type Stmt = { sql: string; args?: any[] };
interface Plan {
  stmts: Stmt[];
  /** maps the results of this command's statements to a redis style value */
  map: (r: { rows: any[][]; rowsAffected: number }[]) => any;
}

const chunk = <T,>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

/**
 * Redis style store on libSQL / Turso. Every pipeline runs as one transaction,
 * keys expire lazily and are swept by maintenance().
 */
export class TursoStore extends Store {
  kind = 'turso' as const;
  private ready: Promise<void> | null = null;
  private lastSweep = 0;

  constructor(private client: SqlClient) {
    super();
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = this.client
        .batch(SCHEMA.map((sql) => ({ sql })), 'write')
        .then(() => undefined)
        .catch((e) => {
          this.ready = null;
          throw wrap(e);
        });
    }
    return this.ready;
  }

  private purge(k: string, now: number): Stmt {
    return { sql: 'DELETE FROM ex WHERE k = ? AND at <= ?', args: [k, now] };
  }

  private plan(c: Cmd, now: number): Plan {
    const [rawName, ...a] = c as [string, ...any[]];
    const name = rawName.toUpperCase();
    const k = String(a[0]);
    const P = this.purge(k, now);
    const none = (stmts: Stmt[], value: any): Plan => ({ stmts, map: () => value });
    const last = (r: any[]) => r[r.length - 1];

    switch (name) {
      case 'PING':
        return none([], 'PONG');
      case 'GET':
        return { stmts: [P, { sql: 'SELECT v FROM kv WHERE k = ?', args: [k] }], map: (r) => last(r).rows[0]?.[0] ?? null };
      case 'MGET': {
        const keys = a.map(String);
        const ph = keys.map(() => '?').join(',');
        return {
          stmts: [
            { sql: `DELETE FROM ex WHERE k IN (${ph}) AND at <= ?`, args: [...keys, now] },
            { sql: `SELECT k, v FROM kv WHERE k IN (${ph})`, args: keys },
          ],
          map: (r) => {
            const m = new Map<string, string>();
            for (const row of last(r).rows) m.set(String(row[0]), String(row[1]));
            return keys.map((x) => m.get(x) ?? null);
          },
        };
      }
      case 'SET': {
        const v = String(a[1]);
        const nx = a.includes('NX');
        const i = a.indexOf('EX');
        const ttl = i >= 0 ? Number(a[i + 1]) : 0;
        const stmts: Stmt[] = [P];
        if (nx) {
          stmts.push({ sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING', args: [k, v] });
          if (ttl) {
            // only the writer that really inserted the value sets the expiry
            stmts.push({
              sql: 'INSERT INTO ex (k, at) SELECT ?1, ?2 WHERE (SELECT v FROM kv WHERE k = ?1) = ?3 ON CONFLICT(k) DO UPDATE SET at = excluded.at',
              args: [k, now + ttl, v],
            });
          }
          return { stmts, map: (r) => (r[1].rowsAffected > 0 ? 'OK' : null) };
        }
        stmts.push({ sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', args: [k, v] });
        if (ttl) stmts.push({ sql: 'INSERT INTO ex (k, at) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at', args: [k, now + ttl] });
        else stmts.push({ sql: 'UPDATE ex SET at = NULL WHERE k = ?', args: [k] });
        return none(stmts, 'OK');
      }
      case 'DEL': {
        const keys = a.map(String);
        const stmts: Stmt[] = [];
        for (const key of keys) {
          for (const t of ['kv', 'hs', 'zs', 'st']) stmts.push({ sql: `DELETE FROM ${t} WHERE k = ?`, args: [key] });
          stmts.push({ sql: 'DELETE FROM ex WHERE k = ?', args: [key] });
        }
        return {
          stmts,
          map: (r) => {
            let n = 0;
            for (let i = 0; i < keys.length; i++) {
              const base = i * 5;
              if (r[base].rowsAffected + r[base + 1].rowsAffected + r[base + 2].rowsAffected + r[base + 3].rowsAffected > 0) n++;
            }
            return n;
          },
        };
      }
      case 'INCR':
        return {
          stmts: [
            P,
            { sql: "INSERT INTO kv (k, v) VALUES (?, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT)", args: [k] },
            { sql: 'SELECT v FROM kv WHERE k = ?', args: [k] },
          ],
          map: (r) => Number(last(r).rows[0]?.[0] ?? 0),
        };
      case 'EXPIRE': {
        const at = now + Number(a[1]);
        return {
          stmts: [
            {
              sql: `INSERT INTO ex (k, at)
                    SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM kv WHERE k = ?1) OR EXISTS (SELECT 1 FROM hs WHERE k = ?1)
                      OR EXISTS (SELECT 1 FROM zs WHERE k = ?1) OR EXISTS (SELECT 1 FROM st WHERE k = ?1)
                    ON CONFLICT(k) DO UPDATE SET at = excluded.at`,
              args: [k, at],
            },
          ],
          map: (r) => (r[0].rowsAffected > 0 ? 1 : 0),
        };
      }
      case 'HSET': {
        const stmts: Stmt[] = [P];
        const pairs: [string, string][] = [];
        for (let i = 1; i + 1 < a.length; i += 2) pairs.push([String(a[i]), String(a[i + 1])]);
        for (const part of chunk(pairs, 100)) {
          stmts.push({
            sql: `INSERT INTO hs (k, f, v) VALUES ${part.map(() => '(?, ?, ?)').join(',')} ON CONFLICT(k, f) DO UPDATE SET v = excluded.v`,
            args: part.flatMap(([f, v]) => [k, f, v]),
          });
        }
        return none(stmts, 1);
      }
      case 'HGET':
        return { stmts: [P, { sql: 'SELECT v FROM hs WHERE k = ? AND f = ?', args: [k, String(a[1])] }], map: (r) => last(r).rows[0]?.[0] ?? null };
      case 'HGETALL':
        return {
          stmts: [P, { sql: 'SELECT f, v FROM hs WHERE k = ?', args: [k] }],
          map: (r) => last(r).rows.flatMap((row: any[]) => [String(row[0]), String(row[1])]),
        };
      case 'HLEN':
        return { stmts: [P, { sql: 'SELECT COUNT(*) FROM hs WHERE k = ?', args: [k] }], map: (r) => Number(last(r).rows[0]?.[0] ?? 0) };
      case 'ZADD': {
        const stmts: Stmt[] = [P];
        const items: [number, string][] = [];
        for (let i = 1; i + 1 < a.length; i += 2) items.push([Number(a[i]), String(a[i + 1])]);
        for (const part of chunk(items, 100)) {
          stmts.push({
            sql: `INSERT INTO zs (k, m, s) VALUES ${part.map(() => '(?, ?, ?)').join(',')} ON CONFLICT(k, m) DO UPDATE SET s = excluded.s`,
            args: part.flatMap(([s, m]) => [k, m, s]),
          });
        }
        return none(stmts, 1);
      }
      case 'ZCARD':
        return { stmts: [P, { sql: 'SELECT COUNT(*) FROM zs WHERE k = ?', args: [k] }], map: (r) => Number(last(r).rows[0]?.[0] ?? 0) };
      case 'ZREVRANK':
        return {
          stmts: [
            P,
            {
              sql: `SELECT (SELECT COUNT(*) FROM zs z WHERE z.k = ?1 AND (z.s > me.s OR (z.s = me.s AND z.m < ?2)))
                    FROM zs me WHERE me.k = ?1 AND me.m = ?2`,
              args: [k, String(a[1])],
            },
          ],
          map: (r) => (last(r).rows.length ? Number(last(r).rows[0][0]) : null),
        };
      case 'SADD': {
        const stmts: Stmt[] = [P];
        for (const part of chunk(a.slice(1).map(String), 200)) {
          stmts.push({ sql: `INSERT INTO st (k, m) VALUES ${part.map(() => '(?, ?)').join(',')} ON CONFLICT(k, m) DO NOTHING`, args: part.flatMap((m) => [k, m]) });
        }
        return none(stmts, 1);
      }
      case 'SMEMBERS':
        return { stmts: [P, { sql: 'SELECT m FROM st WHERE k = ?', args: [k] }], map: (r) => last(r).rows.map((row: any[]) => String(row[0])) };
      case 'SCARD':
        return { stmts: [P, { sql: 'SELECT COUNT(*) FROM st WHERE k = ?', args: [k] }], map: (r) => Number(last(r).rows[0]?.[0] ?? 0) };
      case 'RENAME': {
        const to = String(a[1]);
        const stmts: Stmt[] = [P, { sql: 'DELETE FROM ex WHERE k = ?', args: [to] }];
        for (const t of ['kv', 'hs', 'zs', 'st']) stmts.push({ sql: `UPDATE ${t} SET k = ? WHERE k = ?`, args: [to, k] });
        stmts.push({ sql: 'UPDATE ex SET k = ? WHERE k = ?', args: [to, k] });
        return none(stmts, 'OK');
      }
      default:
        throw new StoreError('redis_error', 'TursoStore: unsupported command ' + rawName);
    }
  }

  async run(cmds: Cmd[]): Promise<any[]> {
    if (!cmds.length) return [];
    await this.ensure();
    const now = Math.floor(Date.now() / 1000);
    const plans = cmds.map((c) => this.plan(c, now));
    const all = plans.flatMap((p) => p.stmts);
    let results: { rows: any[][]; rowsAffected: number }[] = [];
    if (all.length) {
      try {
        results = await this.client.batch(all, 'write');
      } catch (e) {
        throw wrap(e);
      }
    }
    let at = 0;
    return plans.map((p) => {
      const part = results.slice(at, at + p.stmts.length);
      at += p.stmts.length;
      return p.map(part);
    });
  }

  /** deletes expired keys, at most every 30 minutes */
  async maintenance(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    if (now - this.lastSweep < 1800) return;
    this.lastSweep = now;
    try {
      await this.ensure();
      await this.client.execute({ sql: 'DELETE FROM ex WHERE at <= ?', args: [now] });
    } catch {
      /* best effort */
    }
  }
}

function wrap(e: unknown): StoreError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|403|unauthor|auth/i.test(msg)) return new StoreError('db_auth', 'Turso rejected the token: ' + msg, 'Check TURSO_AUTH_TOKEN and TURSO_DATABASE_URL');
  return new StoreError('db_error', 'Turso: ' + msg);
}