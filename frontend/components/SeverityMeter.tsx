import { SEVERITY_WEIGHT, severityLabel, type SeverityLevel } from "@/lib/vector-abi";
import { cn } from "@/lib/utils";

/**
 * Severity as dot-density + label, never red/orange/green traffic-light
 * color -- deliberately avoiding the cliché so severity reads through
 * weight and count, consistent with the monochrome + single-yellow-accent
 * system used everywhere else in this app.
 */
export function SeverityMeter({ severity, className }: { severity: SeverityLevel | string; className?: string }) {
  const weight = SEVERITY_WEIGHT[severity as SeverityLevel] ?? 0;
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("h-2.5 w-2.5 rounded-sm", i <= weight ? "bg-ink" : "bg-ink/12")}
          />
        ))}
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
        {severityLabel(severity)}
      </span>
    </div>
  );
}
