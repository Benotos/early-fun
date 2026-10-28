import { dayKey, dayStart } from '../../shared/format';
import { runScan } from '../lib/scanner';
import { MemoryStore } from '../lib/store';
import { FakeChain, addCoin, fakeKey, rng } from './fakechain';

const SYMBOLS = ['WIF2', 'CHILLGUY', 'PEPE9', 'GIGA', 'MOODENG', 'FARTCOIN', 'RETARDIO', 'BONKERS', 'ZEREBRO', 'PNUT', 'POPCAT', 'MEW', 'SIGMA', 'LUCE'];

/** Fills an in memory store with a believable two day world. Used by npm run dev:mock only. */
export async function seed(): Promise<{ showcase: string; lossShowcase: string; scans: number }> {
  const r = rng(2026);
  const store = new MemoryStore();
  (globalThis as any).__EARLY_STORE__ = store;
  const chain = new FakeChain();
  chain.price = 150;
  const now = Math.floor(Date.now() / 1000);

  const wallets = Array.from({ length: 140 }, () => fakeKey(r));
  const showcase = wallets[0];
  const lossShowcase = wallets[1];

  SYMBOLS.forEach((symbol, i) => {
    const create = now - (i + 1) * 8400 - 2400; // one coin every 140 minutes, spanning ~32h
    const mig = create + 900 + Math.floor(r() * 1500);
    if (mig > now - 600) return;
    const coin = addCoin(chain, { symbol, createTime: create, migTime: mig, seed: 100 + i });
    const runner = r() > 0.35;
    const peak = runner ? 600 + Math.pow(r(), 2.2) * 30000 : 300 + r() * 250;
    const tPk = mig + 1800 + r() * 5400;
    const mcAt = (t: number) => {
      if (t < mig) return 28 * Math.pow(400 / 28, (t - create) / (mig - create));
      if (t < tPk) return 400 * Math.pow(peak / 400, (t - mig) / (tPk - mig));
      return Math.max(peak * 0.04, peak * Math.exp(-(t - tPk) / 4200));
    };
    const last = Math.min(now - 120, mig + 3 * 3600);

    // curve phase buyers (the potential winners)
    const buyers = 14 + Math.floor(r() * 16);
    for (let k = 0; k < buyers; k++) {
      const w = wallets[Math.floor(r() * wallets.length)];
      const t = create + 30 + Math.floor(r() * (mig - create - 60));
      coin.buy(w, 0.12 + r() * 2.6, mcAt(t), t, 'curve');
    }
    // dust that must be ignored
    coin.buy(wallets[Math.floor(r() * wallets.length)], 0.04, mcAt(create + 90), create + 90, 'curve');

    // AMM phase: buyers, some of which exit at a loss
    const amm = 10 + Math.floor(r() * 10);
    for (let k = 0; k < amm; k++) {
      const w = wallets[2 + Math.floor(r() * (wallets.length - 2))];
      const t = mig + 60 + Math.floor(r() * Math.max(120, last - mig - 600));
      const sol = 0.2 + r() * 14;
      coin.buy(w, sol, mcAt(t), t, 'amm');
      const t2 = t + 400 + Math.floor(r() * 5400);
      if (t2 < last) {
        const ratio = mcAt(t2) / mcAt(t);
        if (ratio < 0.9) coin.sell(w, sol * ratio, mcAt(t2), t2, 'amm');
      }
    }

    // showcase wallets: an early win and a painful loss on the same two coins
    if (i === 1 && runner) {
      coin.buy(showcase, 1.4, mcAt(create + 200), create + 200, 'curve');
    }
    if (i === 2 || i === 3) {
      const tb = tPk;
      if (tb + 900 < last) {
        coin.buy(lossShowcase, 9, mcAt(tb), tb, 'amm');
        const ts = tb + 2400;
        coin.sell(lossShowcase, 9 * (mcAt(ts) / mcAt(tb)), mcAt(ts), ts, 'amm');
      }
    }
  });

  let scans = 0;
  for (let i = 0; i < 60; i++) {
    const rep = await runScan({ store, chain, budgetMs: 30000, now, forceRebuild: true });
    scans++;
    if (rep.changed === 0 && rep.newCoins === 0) break;
  }
  // make sure the showcase wallet has a win today even if the random world did not give one
  return { showcase, lossShowcase, scans };
}

export const _days = { dayKey, dayStart };
