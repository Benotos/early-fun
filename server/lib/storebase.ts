export type Cmd = (string | number)[];

export class StoreError extends Error {
  code: string;
  hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export abstract class Store {
  abstract kind: 'upstash' | 'memory' | 'turso';
  abstract run(cmds: Cmd[]): Promise<any[]>;

  async cmd(...a: Cmd): Promise<any> {
    const [r] = await this.run([a]);
    return r;
  }
  async get(k: string): Promise<string | null> {
    return (await this.cmd('GET', k)) ?? null;
  }
  async set(k: string, v: string, exSeconds?: number): Promise<void> {
    if (exSeconds) await this.cmd('SET', k, v, 'EX', exSeconds);
    else await this.cmd('SET', k, v);
  }
  async setnx(k: string, v: string, exSeconds: number): Promise<boolean> {
    const r = await this.cmd('SET', k, v, 'NX', 'EX', exSeconds);
    return r === 'OK';
  }
  async del(...k: string[]): Promise<void> {
    if (k.length) await this.cmd('DEL', ...k);
  }
  async incr(k: string, exSeconds?: number): Promise<number> {
    const n = Number(await this.cmd('INCR', k));
    if (n === 1 && exSeconds) await this.cmd('EXPIRE', k, exSeconds);
    return n;
  }
  /** wipes every key. Used by the admin reset. */
  async clearAll(): Promise<void> {
    throw new StoreError('not_supported', 'Reset is only supported on the Turso database');
  }
  /** optional housekeeping, called at the end of every scan */
  async maintenance(): Promise<void> {}
  async hget(k: string, f: string): Promise<string | null> {
    return (await this.cmd('HGET', k, f)) ?? null;
  }
  async hgetall(k: string): Promise<Record<string, string>> {
    const r = (await this.cmd('HGETALL', k)) as string[] | null;
    const out: Record<string, string> = {};
    if (Array.isArray(r)) for (let i = 0; i + 1 < r.length; i += 2) out[r[i]] = r[i + 1];
    return out;
  }
  async smembers(k: string): Promise<string[]> {
    return ((await this.cmd('SMEMBERS', k)) as string[]) || [];
  }
  async zcard(k: string): Promise<number> {
    return Number(await this.cmd('ZCARD', k)) || 0;
  }
  async zrevrank(k: string, m: string): Promise<number | null> {
    const r = await this.cmd('ZREVRANK', k, m);
    return r === null || r === undefined ? null : Number(r);
  }

  /** Runs many commands in chunks so no single request gets too large. */
  async runChunked(cmds: Cmd[], size = 250): Promise<void> {
    for (let i = 0; i < cmds.length; i += size) await this.run(cmds.slice(i, i + size));
  }

  /** Atomically replaces `live` with a hash + zset built from scratch. */
  async replaceHash(live: string, entries: Record<string, string>, ttl: number): Promise<void> {
    const tmp = live + ':tmp';
    const fields = Object.entries(entries);
    await this.del(tmp);
    if (!fields.length) {
      await this.del(live);
      return;
    }
    const cmds: Cmd[] = [];
    for (let i = 0; i < fields.length; i += 100) {
      const chunk = fields.slice(i, i + 100);
      cmds.push(['HSET', tmp, ...chunk.flat()]);
    }
    await this.runChunked(cmds, 20);
    await this.run([['RENAME', tmp, live], ['EXPIRE', live, ttl]]);
  }

  async replaceZset(live: string, items: { score: number; member: string }[], ttl: number): Promise<void> {
    const tmp = live + ':tmp';
    await this.del(tmp);
    if (!items.length) {
      await this.del(live);
      return;
    }
    const cmds: Cmd[] = [];
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200);
      cmds.push(['ZADD', tmp, ...chunk.flatMap((x) => [x.score, x.member])]);
    }
    await this.runChunked(cmds, 20);
    await this.run([['RENAME', tmp, live], ['EXPIRE', live, ttl]]);
  }
}