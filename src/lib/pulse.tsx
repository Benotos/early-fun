import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import type { PulseResponse } from '../../shared/types';
import { api } from './api';

interface PulseState {
  data: PulseResponse | null;
  error: string | null;
}
const Ctx = createContext<PulseState>({ data: null, error: null });

export function PulseProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<PulseState>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await api<PulseResponse>(`/api/pulse?_=${Date.now()}`, { cache: 'no-store' });
        if (alive) setSt({ data: d, error: null });
      } catch (e) {
        if (alive) setSt((s) => ({ data: s.data, error: e instanceof Error ? e.message : 'Failed to load' }));
      }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return <Ctx.Provider value={st}>{children}</Ctx.Provider>;
}

export const usePulse = () => useContext(Ctx);