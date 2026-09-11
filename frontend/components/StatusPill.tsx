import { statusLabel, type DisclosureStatus } from "@/lib/vector-abi";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-ink/6 text-ink-soft",
  TRIAGING: "bg-yellow text-ink",
  UNVERIFIABLE: "bg-ink/6 text-ink-soft",
  REJECTED: "bg-ink text-paper",
  VERIFIED: "bg-yellow text-ink",
  DUPLICATE: "bg-ink/6 text-ink-soft",
  PAYOUT_PENDING: "bg-yellow text-ink",
  PAID: "bg-ink text-paper",
  EXPIRED: "bg-ink/6 text-ink-soft",
};

export function StatusPill({ status, className }: { status: DisclosureStatus | string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-wider",
        STATUS_STYLE[status] ?? "bg-ink/6 text-ink-soft",
        className
      )}
    >
      {status === "TRIAGING" && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-ink" />}
      {statusLabel(status)}
    </span>
  );
}
