// Serves dist/ plus the built api/*.js handlers with a seeded in memory database.
// npm run dev:mock  ->  http://localhost:3001
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'dev-admin';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'dev-cron';

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
const handlers = {};
const load = (name) => (handlers[name] ||= require(path.join(root, 'api', name + '.js')));

(async () => {
  const { seed } = require('./mock-seed.cjs');
  const info = await seed();
  fs.writeFileSync(path.join(root, '.mockdb'), JSON.stringify(info));
  console.log('seeded', info);

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname.startsWith('/api/')) {
        const name = u.pathname.slice(5).replace(/\/$/, '');
        if (!/^[a-z]+$/.test(name) || !fs.existsSync(path.join(root, 'api', name + '.js'))) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'no such route' } }));
        }
        return load(name)(req, res);
      }
      const sm = u.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
      if (sm) {
        req.url = '/api/s?id=' + sm[1];
        return load('s')(req, res);
      }
      let file = path.join(dist, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e && e.stack || e));
    }
  });
  server.listen(Number(process.env.PORT || 3001), () => console.log('http://localhost:' + (process.env.PORT || 3001)));
})();
