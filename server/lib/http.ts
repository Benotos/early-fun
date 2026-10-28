import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';
import { Store } from './store';

export class HttpError extends Error {
  status: number;
  code: string;
  hint?: string;
  constructor(status: number, code: string, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

export interface Ctx {
  req: IncomingMessage & { body?: unknown };
  url: URL;
  q: URLSearchParams;
  body: any;
  ip: string;
  site: string;
}

export interface Reply {
  status?: number;
  json?: unknown;
  html?: string;
  raw?: Buffer;
  contentType?: string;
  cache?: string;
  headers?: Record<string, string>;
}

async function readBody(req: Ctx['req']): Promise<any> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body !== undefined && req.body !== null && typeof req.body !== 'string') return req.body;
  let text = typeof req.body === 'string' ? req.body : '';
  if (!text) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > 20000) throw new HttpError(413, 'body_too_large', 'Request body too large');
      chunks.push(c);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be JSON');
  }
}

export function siteUrl(req: Ctx['req']): string {
  const env = getEnv('SITE_URL');
  if (env) return env.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https'));
  return `${proto}://${host}`;
}

/** Wraps a route so any crash becomes readable JSON instead of a bare 500. */
export function route(fn: (c: Ctx) => Promise<Reply>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url || '/', 'http://local');
      const ctx: Ctx = {
        req: req as Ctx['req'],
        url,
        q: url.searchParams,
        body: await readBody(req as Ctx['req']),
        ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim(),
        site: siteUrl(req as Ctx['req']),
      };
      const r = await fn(ctx);
      res.statusCode = r.status ?? 200;
      for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
      res.setHeader('Cache-Control', r.cache ?? 'no-store');
      if (r.raw) {
        res.setHeader('Content-Type', r.contentType || 'application/octet-stream');
        res.end(r.raw);
      } else if (r.html !== undefined) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(r.html);
      } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(r.json ?? { ok: true }));
      }
    } catch (e: any) {
      const known = e instanceof HttpError;
      const status = known ? e.status : typeof e?.code === 'string' && /^(no_|redis_|rpc_)/.test(e.code) ? 503 : 500;
      const body = {
        ok: false,
        error: {
          code: known || typeof e?.code === 'string' ? e.code : 'internal_error',
          message: e instanceof Error ? e.message : String(e),
          hint: e?.hint,
        },
      };
      if (!res.headersSent) {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(body));
      } else {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
  };
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Fixed window counter. Never blocks the request if redis is down. */
export async function limited(store: Store, key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const n = await store.incr(`rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`, windowSec + 5);
    return n > max;
  } catch {
    return false;
  }
}
