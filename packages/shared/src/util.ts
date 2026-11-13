import {
  FIXED_MONTHLY_USD,
  PUBLIC_IP_USD_PER_HOUR,
  VM_SIZES,
  type Platform,
  type VmSize,
} from "./schemas.js";

/** Detect the meeting platform from a join URL. */
export function detectPlatform(url: string): Platform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === "meet.google.com") return "meet";
  if (host === "zoom.us" || host.endsWith(".zoom.us") || host.endsWith(".zoom.com")) return "zoom";
  if (host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com"))
    return "teams";
  return "other";
}

const MEETING_URL_RE =
  /https:\/\/(?:meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}|[\w.-]*zoom\.(?:us|com)\/(?:j|w|my)\/[^\s"<>\\]+|teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"<>\\]+)/i;

/** Pull the first recognisable meeting link out of free text (calendar body, invite, etc.). */
export function extractMeetingUrl(text: string): string | null {
  const m = MEETING_URL_RE.exec(text);
  return m ? m[0].replace(/[).,;]+$/, "") : null;
}

/**
 * Random delay in ms, uniformly between min and max minutes.
 * `rng` is injectable for tests.
 */
export function randomDelayMs(minMinutes: number, maxMinutes: number, rng: () => number = Math.random): number {
  const lo = Math.min(minMinutes, maxMinutes);
  const hi = Math.max(minMinutes, maxMinutes);
  return Math.round((lo + (hi - lo) * rng()) * 60_000);
}

/** Estimated running cost in USD for `hours` at a given size (compute + public IP). */
export function runningCostUsd(size: VmSize, hours: number): number {
  return hours * (VM_SIZES[size].usdPerHour + PUBLIC_IP_USD_PER_HOUR);
}

/** Hours of runtime a monthly budget allows after fixed costs. */
export function affordableHoursPerMonth(size: VmSize, monthlyBudgetUsd: number): number {
  const fixed = FIXED_MONTHLY_USD.osDisk32gbStandardSsd + FIXED_MONTHLY_USD.controlPlane;
  const left = Math.max(0, monthlyBudgetUsd - fixed);
  return left / (VM_SIZES[size].usdPerHour + PUBLIC_IP_USD_PER_HOUR);
}

/**
 * Hours of runtime the rest of this month's budget buys at `size`, or null for a size
 * we have no price for (e.g. a deployed size outside VM_SIZES).
 */
export function hoursLeftAt(size: string, usage: { budgetUsd: number; monthToDateUsd: number }): number | null {
  const s = VM_SIZES[size as VmSize];
  if (!s || usage.budgetUsd <= 0) return null;
  return Math.max(0, usage.budgetUsd - usage.monthToDateUsd) / (s.usdPerHour + PUBLIC_IP_USD_PER_HOUR);
}

/** 64-bit difference hash (dHash) from a 9x8 grayscale buffer → hex string. */
export function dHashFromGray9x8(gray: ArrayLike<number>): string {
  if (gray.length !== 72) throw new Error("dHash expects 9x8 = 72 grayscale pixels");
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x]!;
      const right = gray[y * 9 + x + 1]!;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** Hamming distance between two 64-bit hex hashes. */
export function hammingHex(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export function newId(prefix = ""): string {
  const rnd = globalThis.crypto.getRandomValues(new Uint8Array(9));
  const s = Array.from(rnd, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
  return prefix ? `${prefix}_${s}` : s;
}
