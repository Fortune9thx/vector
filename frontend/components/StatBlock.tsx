import { CountUp } from "./CountUp";

export function StatBlock({
  value,
  label,
  formatter,
  suffix,
}: {
  value: number;
  label: string;
  formatter?: (n: number) => string;
  suffix?: string;
}) {
  return (
    <div className="yellow-block flex flex-col justify-between p-6 sm:p-7" style={{ minHeight: 140 }}>
      <div className="flex items-baseline gap-1">
        <CountUp value={value} formatter={formatter} className="text-4xl font-bold tracking-tight sm:text-5xl" />
        {suffix && <span className="text-xl font-bold sm:text-2xl">{suffix}</span>}
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink/70">{label}</p>
    </div>
  );
}
