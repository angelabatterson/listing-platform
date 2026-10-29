// Same mark as the favicon (src/app/icon.svg).
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="7" fill="#18181b" />
      <text x="16" y="23" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="21" fontWeight="700" fill="#fff">
        R
      </text>
    </svg>
  );
}
