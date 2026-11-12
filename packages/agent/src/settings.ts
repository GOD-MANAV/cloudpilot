import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/** "Leave when people are leaving" — off unless you turn it on. */
export const AutoLeave = z.object({
  enabled: z.boolean().default(false),
  /** Leave when this many people or fewer remain (bot included). */
  minPeople: z.number().int().min(1).max(50).default(3),
  /** …or when headcount falls to this fraction of the meeting's peak. */
  dropFraction: z.number().min(0.05).max(0.9).default(0.25),
  /** The low headcount must last this long (minutes) before leaving. */
  graceMinutes: z.number().min(0.5).max(30).default(3),
  /** Ignore the rule during the first N minutes while people are still joining. */
  warmupMinutes: z.number().min(0).max(60).default(10),
});
export type AutoLeave = z.infer<typeof AutoLeave>;

/**
 * Pure decision used by the bot every few seconds.
 * Returns the reason to leave, or null to stay.
 */
export function autoLeaveDecision(
  cfg: AutoLeave,
  s: { count: number | null; peak: number; joinedAt: number; lowSince: number | null; now: number },
): { leave: string | null; lowSince: number | null } {
  if (!cfg.enabled || s.count === null || s.now - s.joinedAt < cfg.warmupMinutes * 60_000) return { leave: null, lowSince: null };
  const fewLeft = s.count <= cfg.minPeople;
  const exodus = s.peak >= 4 && s.count <= Math.max(1, Math.floor(s.peak * cfg.dropFraction));
  if (!fewLeft && !exodus) return { leave: null, lowSince: null };
  const lowSince = s.lowSince ?? s.now;
  if (s.now - lowSince < cfg.graceMinutes * 60_000) return { leave: null, lowSince };
  return {
    leave: fewLeft
      ? `Left: only ${s.count} ${s.count === 1 ? "person" : "people"} left`
      : `Left: most people had gone (${s.count} of ${s.peak})`,
    lowSince,
  };
}

/** User-editable settings, stored on the VM disk (never in the repo or Azure). */
export const Settings = z.object({
  google: z
    .object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
      /** Parent Drive folder id; created as "CloudPilot" in My Drive if empty. */
      driveFolderId: z.string().optional(),
    })
    .optional(),
  smtp: z
    .object({
      host: z.string(),
      port: z.number().int().default(465),
      secure: z.boolean().default(true),
      user: z.string(),
      pass: z.string(),
      from: z.string().optional(),
    })
    .optional(),
  emailTo: z.string().email().optional(),
  /** Display name used when joining as a guest and no per-meeting name is set. */
  defaultGuestName: z.string().default("CloudPilot"),
  /** Image shown as the bot's camera when presence = static-image. */
  staticImageFile: z.string().optional(),
  recordingFps: z.number().int().min(2).max(30).default(8),
  /** Delete local recordings this many days after successful upload. */
  pruneAfterDays: z.number().int().min(0).default(3),
  /** Expo push tokens of your phones (registered by the app). */
  pushTokens: z.array(z.string()).default([]),
  autoLeave: AutoLeave.default(AutoLeave.parse({})),
  /** Minutes of inactivity before the machine stops itself (overrides the deploy default). */
  idleMinutes: z.number().int().min(0).max(240).optional(),
  /** Which push notifications to send to your phone. */
  notify: z
    .object({
      joined: z.boolean().default(true),
      waitingRoom: z.boolean().default(true),
      finished: z.boolean().default(true),
      aiActivity: z.boolean().default(true),
    })
    .default({ joined: true, waitingRoom: true, finished: true, aiActivity: true }),
  /** IANA zone used in emails. */
  timeZone: z.string().default("Asia/Kolkata"),
});
export type Settings = z.infer<typeof Settings>;

/** Fields that are write-only from the API (never returned). */
export function redact(s: Settings) {
  return {
    ...s,
    google: s.google ? { ...s.google, clientSecret: "••••" } : undefined,
    smtp: s.smtp ? { ...s.smtp, pass: "••••" } : undefined,
  };
}

export class JsonFile<T> {
  constructor(
    private readonly path: string,
    private readonly schema: z.ZodType<T>,
    private readonly fallback: T,
  ) {}
  async read(): Promise<T> {
    try {
      return this.schema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return this.fallback;
    }
  }
  async write(v: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.schema.parse(v), null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}

export const settingsFile = (dataDir: string) =>
  new JsonFile(join(dataDir, "settings.json"), Settings, Settings.parse({}));
