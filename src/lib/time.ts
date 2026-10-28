export function ago(sec: number): string {
  if (!sec) return 'never';
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}