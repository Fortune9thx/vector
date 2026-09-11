/**
 * The hero's animated "scanning" motif -- deliberately not a stock shield
 * icon or a matrix-code cliché. Concentric rings + a rotating sweep line
 * read as active verification, standing in for the reference's
 * motion-blurred portrait with something native to what Vector actually
 * does: continuously re-checking a live target.
 */
export function ScanRing({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 320" className={className} fill="none">
      <circle cx="160" cy="160" r="150" stroke="var(--color-ink)" strokeOpacity="0.08" strokeWidth="1.5" />
      <circle cx="160" cy="160" r="112" stroke="var(--color-ink)" strokeOpacity="0.12" strokeWidth="1.5" />
      <circle cx="160" cy="160" r="74" stroke="var(--color-ink)" strokeOpacity="0.18" strokeWidth="1.5" />

      <g className="scan-ring">
        <path
          d="M160 160 L160 10 A150 150 0 0 1 266 54 Z"
          fill="var(--color-yellow)"
          opacity="0.9"
        />
      </g>

      <g className="scan-ring-slow" opacity="0.5">
        <circle cx="160" cy="48" r="5" fill="var(--color-ink)" />
        <circle cx="272" cy="160" r="3.5" fill="var(--color-ink)" />
        <circle cx="160" cy="272" r="3.5" fill="var(--color-ink)" />
      </g>

      <circle cx="160" cy="160" r="10" fill="var(--color-ink)" />
      <circle cx="160" cy="160" r="4" fill="var(--color-yellow)" />
    </svg>
  );
}
