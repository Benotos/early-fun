import { dayKey } from '../shared/format';
import { HeliusChain, txKeys } from './lib/chain';
import { findUpstash, getEnv } from './lib/env';
import { curveAddress } from './lib/pda';
import { extractTrade, parseMigration } from './lib/trades';

// Live check against Helius: npm run probe
async function main() {
  console.log('HELIUS_API_KEY set:', !!getEnv('HELIUS_API_KEY'));
  console.log('Upstash env found:', !!findUpstash());
  const chain = new HeliusChain();
  const p = await chain.probe();
  console.log('RPC probe:', p);
  if (!p.ok) return;
  console.log('SOL/USD:', await chain.solUsd());
  const now = Math.floor(Date.now() / 1000);
  const sigs = await chain.listMigrations({ minTime: now - 3600, maxPages: 1 });
  console.log('migrations in the last hour:', sigs.length);
  if (!sigs.length) return;
  const sig = sigs[0].signature;
  const tx = await chain.getTx(sig);
  if (!tx) return console.log('could not fetch migration tx', sig);
  const mig = parseMigration(tx);
  console.log('migration parsed:', mig, 'day', dayKey(sigs[0].blockTime ?? now));
  if (!mig) return;
  const curve = curveAddress(mig.mint);
  console.log('curve PDA:', curve, 'present in migration tx:', txKeys(tx).includes(curve));
  console.log('token meta:', await chain.tokenMeta(mig.mint));
  const page = await chain.txsForAddress(curve, { sort: 'asc', limit: 25 });
  console.log('first curve txs:', page.txs.length, 'more pages:', !!page.next);
  if (page.txs.length) {
    console.log('dev wallet (signer of first tx):', txKeys(page.txs[0])[0], 'create slot', page.txs[0].slot);
    const trades = page.txs.map((t) => extractTrade(t, { kind: 'curve', address: curve, mint: mig.mint })).filter(Boolean);
    console.log('parsed trades in first page:', trades.length);
    console.log(trades.slice(0, 5));
  }
  const pool = await chain.txsForAddress(mig.pool, { sort: 'asc', limit: 25 });
  const poolTrades = pool.txs.map((t) => extractTrade(t, { kind: 'amm', address: mig.pool, mint: mig.mint })).filter(Boolean);
  console.log('pool txs:', pool.txs.length, 'parsed swaps:', poolTrades.length);
  console.log(poolTrades.slice(0, 5));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
