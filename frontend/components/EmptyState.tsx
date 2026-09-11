import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="paper-card flex flex-col items-center gap-4 px-8 py-16 text-center">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
        <rect x="1" y="1" width="54" height="54" rx="14" stroke="var(--color-border)" strokeWidth="1.5" strokeDasharray="3 4" />
        <path d="M28 18v14" stroke="var(--color-ink)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="28" cy="38" r="1.75" fill="var(--color-ink)" />
      </svg>
      <div className="max-w-sm">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-1.5 text-sm text-ink-soft">{description}</p>
      </div>
      {action}
    </div>
  );
}
