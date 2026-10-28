import { useEffect, useState } from 'react';
import { isSolAddress } from '../../shared/format';

const KEY = 'early:me';
const EVT = 'early:me-change';

export function getMe(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && isSolAddress(v) ? v : null;
  } catch {
    return null;
  }
}

export function setMe(a: string | null) {
  try {
    if (a) localStorage.setItem(KEY, a);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

export function useMe(): [string | null, (a: string | null) => void] {
  const [me, setState] = useState<string | null>(getMe);
  useEffect(() => {
    const on = () => setState(getMe());
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return [me, setMe];
}