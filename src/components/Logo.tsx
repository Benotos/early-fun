export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0D0D17" stroke="#2A2A44" strokeWidth="2" />
      <path d="M20 16h26v8H29v6h14v8H29v6h17v8H20z" fill="#8B5CFF" />
      <circle cx="49" cy="15" r="4" fill="#3DFFA2" />
    </svg>
  );
}
