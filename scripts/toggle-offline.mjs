// node scripts/toggle-offline.mjs on   -> takes the site down (maintenance page for every route, API included)
// node scripts/toggle-offline.mjs off  -> brings it back. Redeploy after either.
import { copyFileSync, existsSync } from 'node:fs';
const mode = process.argv[2];
if (mode === 'on') {
  if (!existsSync('vercel.online.json')) copyFileSync('vercel.json', 'vercel.online.json');
  copyFileSync('vercel.offline.json', 'vercel.json');
  console.log('OFFLINE config active. Deploy now.');
} else if (mode === 'off') {
  if (!existsSync('vercel.online.json')) {
    console.error('vercel.online.json not found, nothing to restore');
    process.exit(1);
  }
  copyFileSync('vercel.online.json', 'vercel.json');
  console.log('ONLINE config restored. Deploy now.');
} else {
  console.error('usage: node scripts/toggle-offline.mjs on|off');
  process.exit(1);
}
