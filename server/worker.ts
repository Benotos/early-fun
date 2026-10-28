import { HeliusChain } from './lib/chain';
import { runScan } from './lib/scanner';
import { getStore } from './lib/store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Long running scanner for GitHub Actions. Runs back to back 50 second scans for
 * WORKER_MINUTES (default 50), so coins are read continuously instead of 15 seconds a minute.
 * Safe next to the cron-job.org trigger: a shared lock stops two scans overlapping.
 */
async function main() {
  const minutes = Number(process.env.WORKER_MINUTES || 50);
  const end = Date.now() + minutes * 60_000;
  const store = getStore();
  let runs = 0;
  let coins = 0;
  while (Date.now() < end - 70_000) {
    try {
      const rep = await runScan({ store, chain: new HeliusChain(), budgetMs: 50_000 });
      runs++;
      coins += rep.coinsScanned;
      console.log(
        `${new Date().toISOString().slice(11, 19)} ${rep.status} new=${rep.newCoins} scanned=${rep.coinsScanned} boards=${rep.boardsBuilt.join(',') || '-'} ${rep.errors.length ? 'errors=' + rep.errors.slice(0, 3).join(' | ') : ''}${rep.reason ? ' reason=' + rep.reason : ''}`
      );
      if (rep.status === 'locked') await sleep(15_000);
      else if (rep.status !== 'ok') await sleep(30_000);
      else if (rep.newCoins === 0 && rep.coinsScanned === 0 && rep.boardsBuilt.length === 0) await sleep(20_000);
    } catch (e) {
      console.error('scan failed:', e instanceof Error ? e.message : e);
      await sleep(30_000);
    }
  }
  console.log(`done: ${runs} scans, ${coins} coin reads`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});