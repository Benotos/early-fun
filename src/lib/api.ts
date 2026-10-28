import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardResponse, CoinResponse, Range, WalletResponse } from '../../shared/types';

export class ApiFail extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function doFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiFail('network', 'Network error. Check your connection and retry.');
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiFail('bad_response', `Server returned an unreadable response (${res.status})`);
  }
  if (!res.ok || json?.ok === false) {
    throw new ApiFail(json?.error?.code || 'error', json?.error?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

const inflight = new Map<string, Promise<unknown>>();

/** GET requests for the same path that overlap share one network call. */
export function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method === 'GET';
  if (isGet) {
    const hit = inflight.get(path);
    if (hit) return hit as Promise<T>;
  }
  const p = doFetch<T>(path, init);
  if (isGet) {
    inflight.set(path, p);
    const clear = () => {
      inflight.delete(path);
    };
    p.then(clear, clear);
  }
  return p;
}

export function useBoard(range: Range) {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const d = await api<BoardResponse>(`/api/board?range=${range}`);
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [range]);
  useEffect(() => {
    alive.current = true;
    setData(null);
    load();
    const t = setInterval(load, 30000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load]);
  return { data, error, reload: load };
}

export function useWallet(address: string) {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    setData(null);
    setError(null);
    api<WalletResponse>(`/api/wallet?address=${encodeURIComponent(address)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      alive = false;
    };
  }, [address]);
  return { data, error };
}

export function useCoin(mint: string) {
  const [data, setData] = useState<CoinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!mint) return;
    let alive = true;
    setData(null);
    setError(null);
    api<CoinResponse>(`/api/coindata?mint=${encodeURIComponent(mint)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      alive = false;
    };
  }, [mint]);
  return { data, error };
}