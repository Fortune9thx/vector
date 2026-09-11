/**
 * A small set of abstract black geometric marks -- standing in for the
 * per-course icon illustrations in the Ramp Studio reference (the
 * checkerboard, the diamond, the dot-grid, the ribbon). Vector has no
 * content-specific artwork to commission per bounty, so a mark is chosen
 * deterministically from the bounty's own address, giving every program
 * card a distinct, non-random-feeling identity without any curation step.
 */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const MARKS = ["crosshair", "quad", "grid", "ribbon", "diamond"] as const;
export type MarkKind = (typeof MARKS)[number];

export function markForAddress(address: string): MarkKind {
  const idx = hashString(address.toLowerCase()) % MARKS.length;
  return MARKS[idx];
}

export function GeometricMark({ kind, className }: { kind: MarkKind; className?: string }) {
  const common = { viewBox: "0 0 96 96", className, fill: "none" };

  switch (kind) {
    case "crosshair":
      return (
        <svg {...common}>
          <circle cx="48" cy="48" r="30" stroke="currentColor" strokeWidth="3" />
          <circle cx="48" cy="48" r="7" fill="currentColor" />
          <path d="M48 8v18M48 70v18M8 48h18M70 48h18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case "quad":
      return (
        <svg {...common}>
          <rect x="16" y="16" width="26" height="26" fill="currentColor" />
          <rect x="54" y="16" width="26" height="26" fill="currentColor" opacity="0.35" />
          <rect x="16" y="54" width="26" height="26" fill="currentColor" opacity="0.35" />
          <rect x="54" y="54" width="26" height="26" fill="currentColor" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) => (
              <circle
                key={`${row}-${col}`}
                cx={26 + col * 22}
                cy={26 + row * 22}
                r={row === 1 && col === 1 ? 9 : 6}
                fill="currentColor"
                opacity={row === 1 && col === 1 ? 1 : 0.55}
              />
            ))
          )}
        </svg>
      );
    case "ribbon":
      return (
        <svg {...common}>
          <path
            d="M14 60c8 16 24 16 32 0s24-16 32 0"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M14 38c8 16 24 16 32 0s24-16 32 0"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            opacity="0.4"
          />
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <path d="M48 12 L74 48 L48 84 L22 48 Z" fill="currentColor" />
          <path d="M48 30 L62 48 L48 66 L34 48 Z" fill="var(--color-yellow)" />
        </svg>
      );
  }
}
