import { Chain } from './chain';
import { Store } from './store';

export interface VerifyCtx {
  chain: Chain;
  store: Store;
  devOf: (mint: string) => string | null;
  limit: number;
  maxChecks: number;
}

async function pmap<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

/** undefined means the lookup failed (not the same as "no funder"). Results are cached for good. */
export async function funderOf(ctx: VerifyCtx, wallet: string): Promise<string | null | undefined> {
  const key = 'fund:' + wallet;
  const hit = await ctx.store.get(key);
  if (hit !== null) return hit === '-' ? null : hit;
  try {
    const f = await ctx.chain.firstFunder(wallet);
    await ctx.store.set(key, f || '-', 60 * 60 * 24 * 60);
    return f;
  } catch {
    return undefined;
  }
}

async function hubOf(ctx: VerifyCtx, addr: string): Promise<boolean | undefined> {
  const key = 'hub:' + addr;
  const hit = await ctx.store.get(key);
  if (hit !== null) return hit === '1';
  try {
    const h = await ctx.chain.isHub(addr);
    await ctx.store.set(key, h ? '1' : '0', 60 * 60 * 24 * 60);
    return h;
  } catch {
    return undefined;
  }
}

export interface VerifyReport {
  checked: number;
  rejectedDev: number;
  rejectedCluster: number;
  errors: number;
}

/**
 * Walks ranked candidates and keeps the first `limit` that pass:
 *  1. not funded by the coin's dev (two hops of funding trace)
 *  2. not in the same funding cluster as an already accepted wallet
 *     (shared non hub funder, or one wallet funded the other)
 * Lookup errors skip the candidate for this round instead of guessing.
 */
export async function selectVerified<T extends { wallet: string; mint: string }>(
  cands: T[],
  ctx: VerifyCtx
): Promise<{ picked: T[]; report: VerifyReport }> {
  const report: VerifyReport = { checked: 0, rejectedDev: 0, rejectedCluster: 0, errors: 0 };
  const pool = cands.slice(0, ctx.maxChecks);
  // warm the cache in parallel for the head of the list
  await pmap(pool.slice(0, ctx.limit), 3, (c) => funderOf(ctx, c.wallet));

  const picked: T[] = [];
  const seen = new Set<string>();
  for (const c of pool) {
    if (picked.length >= ctx.limit) break;
    if (report.errors >= 8) break;
    report.checked++;
    const f1 = await funderOf(ctx, c.wallet);
    if (f1 === undefined) {
      report.errors++;
      continue;
    }
    const dev = ctx.devOf(c.mint);
    if (dev && f1 === dev) {
      report.rejectedDev++;
      continue;
    }
    let f2: string | null | undefined = null;
    if (f1) {
      f2 = await funderOf(ctx, f1);
      if (f2 === undefined) {
        report.errors++;
        continue;
      }
      if (dev && f2 === dev) {
        report.rejectedDev++;
        continue;
      }
    }
    const keys = [c.wallet];
    if (f1) {
      const hub = await hubOf(ctx, f1);
      if (hub === undefined) {
        report.errors++;
        continue;
      }
      if (!hub) keys.push(f1);
    }
    if (keys.some((k) => seen.has(k))) {
      report.rejectedCluster++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    picked.push(c);
  }
  return { picked, report };
}