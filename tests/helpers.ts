import { MemoryStore } from '../server/lib/store';
import { FakeChain, addCoin, fakeKey, rng } from '../server/testing/fakechain';
import { mkFundTx } from '../server/testing/fakechain';
import { fakeSig } from '../server/testing/fakechain';

export const t = (h: number, m = 0, s = 0, day = 26) => Date.UTC(2026, 9, day, h, m, s) / 1000;
export const NOW = t(20, 0);

export function freshStore(): MemoryStore {
  const s = new MemoryStore();
  (globalThis as any).__EARLY_STORE__ = s;
  return s;
}

export async function call(
  handler: (req: any, res: any) => Promise<void>,
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
) {
  const req: any = {
    url,
    method: opts.method || 'GET',
    headers: { host: 'early.test', ...(opts.headers || {}) },
    socket: { remoteAddress: '9.9.9.9' },
    body: opts.body,
  };
  const out: any = { status: 0, headers: {} as Record<string, string>, body: undefined };
  const res: any = {
    statusCode: 200,
    headersSent: false,
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    end(d: any) {
      out.body = d;
      this.headersSent = true;
    },
  };
  await handler(req, res);
  out.status = res.statusCode;
  const ct = out.headers['content-type'] || '';
  if (ct.includes('json') && typeof out.body === 'string') out.json = JSON.parse(out.body);
  return out as { status: number; headers: Record<string, string>; body: any; json: any };
}

export interface World {
  chain: FakeChain;
  wallets: Record<string, string>;
  dev: string;
  mint: string;
}

/** One rich coin that exercises every rule. */
export function buildWorld(pageSize = 1000): World {
  const r = rng(42);
  const chain = new FakeChain();
  chain.pageSize = pageSize;
  const w: Record<string, string> = {};
  for (const n of ['e1', 'e2dust', 'e3devfunded', 'e4', 'e5', 'e6', 'e7hub', 'e8hub', 'sniper', 'l1', 'l2', 'farmer', 'gfund', 'hfund', 'late'])
    w[n] = fakeKey(r);
  const c = addCoin(chain, { symbol: 'AAA', createTime: t(8, 0), migTime: t(8, 20), seed: 11 });
  const dev = c.dev;
  w.dev = dev;

  // creation window: dev buy and sniper, must never count
  c.buy(dev, 2, 28, t(8, 0, 1));
  c.buy(w.sniper, 3, 28.2, t(8, 0, 2));
  c.sell(w.sniper, 9, 80, t(8, 12)); // sniper dumps later at a loss attempt? profit anyway, flagged

  // early buyers on the bonding curve
  c.buy(w.e1, 1, 30, t(8, 5));
  c.buy(w.e2dust, 0.05, 28.5, t(8, 4)); // below 0.1 SOL
  c.buy(w.e3devfunded, 2, 29, t(8, 6));
  c.buy(w.e4, 1, 60, t(8, 8));
  c.buy(w.e5, 1, 35, t(8, 9)); // shares non hub funder with e6
  c.buy(w.e6, 1, 36, t(8, 9, 30));
  c.buy(w.e7hub, 1, 40, t(8, 10)); // share a hub funder, both stay
  c.buy(w.e8hub, 1, 41, t(8, 11));

  // l1: buys 5 SOL at mc 300 on curve, exits on the AMM at mc 192 (loss 1.8 SOL)
  c.buy(w.l1, 5, 300, t(8, 15));
  c.sell(w.l1, 5 * (192 / 300), 192, t(8, 40));

  // price runs on the AMM, peak mc 20000 at 09:00
  c.buy(w.late, 4, 5000, t(8, 50));
  c.buy(fakeKey(r), 10, 8000, t(8, 55));
  c.buy(fakeKey(r), 10, 20000, t(9, 0));

  // l2: buys 20 SOL at mc 8000 on AMM, exits at 800 (loss 18 SOL, 90 percent)
  c.buy(w.l2, 20, 8000, t(8, 51));
  c.sell(w.l2, 20 * (800 / 8000), 800, t(9, 30));

  // farmer: buys at the top and dumps within a minute, hold under 300s
  c.buy(w.farmer, 3, 20000, t(9, 2));
  c.sell(w.farmer, 3 * (10000 / 20000), 10000, t(9, 3));

  // trade after the UTC day ended: must not change the peak of this board
  c.buy(fakeKey(r), 50, 90000, t(0, 10, 0, 27));

  // funding history
  const other = fakeKey(r);
  chain.funders.set(w.e3devfunded, dev);
  chain.funders.set(w.e5, w.gfund);
  chain.funders.set(w.e6, w.gfund);
  chain.funders.set(w.e7hub, w.hfund);
  chain.funders.set(w.e8hub, w.hfund);
  chain.funders.set(w.e1, other);
  chain.funders.set(w.l1, fakeKey(r));
  chain.hubs.add(w.hfund);
  chain.addTx(mkFundTx({ sig: fakeSig(r), slot: 1, time: 1, funder: other, wallet: w.e1, sol: 5 }));
  return { chain, wallets: w, dev, mint: c.mint };
}
