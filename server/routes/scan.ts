import { HeliusChain } from '../lib/chain';
import { getEnv } from '../lib/env';
import { HttpError, route, safeEqual } from '../lib/http';
import { runScan } from '../lib/scanner';
import { getStore } from '../lib/store';

export default route(async ({ req, q }) => {
  const secret = getEnv('CRON_SECRET');
  if (!secret) throw new HttpError(503, 'cron_disabled', 'CRON_SECRET is not set on the server');
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const given = bearer || q.get('secret') || '';
  if (!given || !safeEqual(given, secret)) throw new HttpError(401, 'unauthorized', 'Bad cron secret');
  const report = await runScan({ store: getStore(), chain: new HeliusChain(), budgetMs: 15000 });
  return { json: report };
});