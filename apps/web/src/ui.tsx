import type { BotState, VmPowerState } from "@cloudpilot/shared";
import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  home: <path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  video: (
    <>
      <path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  terminal: <path d="m4 17 6-6-6-6M12 19h8" />,
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  power: <path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0" />,
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  external: <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label="CloudPilot">
      <rect width="56" height="56" rx="16" fill="var(--accent)" />
      <path d="M16 34a8 8 0 0 1 1.6-15.8A11 11 0 0 1 38.5 21 7 7 0 0 1 38 35H16z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="38" cy="35" r="4" fill="#2DD4BF" />
    </svg>
  );
}

export function PowerChip({ power }: { power: VmPowerState | undefined }) {
  const cls = power === "running" ? "ok" : power === "starting" ? "accent" : power === "stopping" || power === "deallocating" ? "warn" : "";
  const label =
    power === "running" ? "Running" : power === "starting" ? "Starting…" : power === "stopping" || power === "deallocating" ? "Stopping…" : power === "unknown" || !power ? "Checking…" : "Stopped";
  return (
    <span className={`chip ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function BotChip({ bot }: { bot: BotState }) {
  const map: Record<string, [string, string]> = {
    idle: ["", "Idle"],
    launching: ["accent", "Opening browser…"],
    joining: ["accent", "Joining…"],
    "waiting-room": ["warn", "Waiting room"],
    "in-meeting": ["ok", bot.participants ? `In meeting · ${bot.participants} people` : "In meeting"],
    leaving: ["warn", "Leaving…"],
    ended: ["", "Ended"],
    error: ["danger", "Didn't join"],
  };
  const [cls, label] = map[bot.phase] ?? ["", bot.phase];
  return (
    <span className={`chip ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
};
export const fmtDuration = (from: string | null) => {
  if (!from) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
