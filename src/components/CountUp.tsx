import { useCountUp } from '../lib/fx';

export default function CountUp({ value, format, ms = 900 }: { value: number; format: (n: number) => string; ms?: number }) {
  const v = useCountUp(value, ms);
  return <>{format(v)}</>;
}