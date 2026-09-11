import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const GEN_DECIMALS = 18n;
const GEN_UNIT = 10n ** GEN_DECIMALS;

/** Formats a wei-denominated GEN amount (string or bigint) as a human-scale
 * GEN string, trimming trailing zeros, e.g. "1500000000000000000" -> "1.5". */
export function formatGen(wei: string | bigint, maxDecimals = 4): string {
  let value: bigint;
  try {
    value = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  } catch {
    return "0";
  }
  const whole = value / GEN_UNIT;
  const fraction = value % GEN_UNIT;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(18, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

/** Parses a human-entered GEN amount ("1.5") into a wei bigint for
 * writeContract's `value`. Rejects malformed input rather than silently
 * truncating a typo into a much smaller stake than the user intended. */
export function parseGenToWei(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid GEN amount, e.g. 1.5");
  }
  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const paddedFraction = fractionPart.padEnd(18, "0").slice(0, 18);
  return BigInt(wholePart || "0") * GEN_UNIT + BigInt(paddedFraction || "0");
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

export function timeAgo(unixSeconds: number | string): string {
  const ts = typeof unixSeconds === "string" ? parseInt(unixSeconds, 10) : unixSeconds;
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function timeUntil(unixSeconds: number | string): string {
  const ts = typeof unixSeconds === "string" ? parseInt(unixSeconds, 10) : unixSeconds;
  if (!ts) return "—";
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "now";
  if (diff < 3600) return `${Math.ceil(diff / 60)}m`;
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h`;
  return `${Math.ceil(diff / 86400)}d`;
}
