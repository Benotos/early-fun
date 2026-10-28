import { build } from 'esbuild';
await build({
  entryPoints: ['server/testing/seed.ts'],
  outfile: 'scripts/mock-seed.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'error',
});
console.log('mock seed bundled');
