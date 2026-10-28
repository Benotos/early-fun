import { useEffect, useState } from 'react';

export default function Countdown({ resetAt }: { resetAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = resetAt && resetAt * 1000 > now ? resetAt * 1000 : (Math.floor(now / 86400000) + 1) * 86400000;
  const s = Math.max(0, Math.floor((target - now) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <span className="mono">{`${hh}:${mm}:${ss}`}</span>;
}
