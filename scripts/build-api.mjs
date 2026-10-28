// Bundles every API route into ONE self contained CommonJS file in api/.
// No ESM import paths at runtime, so Vercel cannot hit ERR_MODULE_NOT_FOUND.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';

execFileSync('node', ['scripts/gen-assets.mjs'], { stdio: 'inherit' });
mkdirSync('api', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'error',
  legalComments: 'none',
  footer: { js: 'module.exports = module.exports.default || module.exports;' },
};

const routes = readdirSync('server/routes').filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''));
await Promise.all(routes.map((name) => build({ ...common, entryPoints: [`server/routes/${name}.ts`], outfile: `api/${name}.js` })));

const noFooter = { ...common, footer: {} };
await build({ ...noFooter, entryPoints: ['server/worker.ts'], outfile: 'scripts/worker.cjs' });
await build({ ...noFooter, entryPoints: ['server/probe.ts'], outfile: 'scripts/probe.cjs' });
console.log('api bundled:', routes.join(', '));
