import { z } from "zod";

/* ----------------------------------------------------------------------------
 * Machine (VM) — owned by the control plane (Azure Function), always reachable.
 * ------------------------------------------------------------------------- */

export const VmPowerState = z.enum([
  "running",
  "starting",
  "stopping",
  "deallocating",
  "deallocated",
  "stopped",
  "unknown",
]);
export type VmPowerState = z.infer<typeof VmPowerState>;

/** Sizes we offer in the app. Prices are Linux pay-as-you-go USD/hour (East US, late 2026). */
export const VM_SIZES = {
  Standard_B2als_v2: { vcpu: 2, ramGb: 4, usdPerHour: 0.0376, label: "Everyday (2 vCPU · 4 GB)" },
  Standard_B2as_v2: { vcpu: 2, ramGb: 8, usdPerHour: 0.0752, label: "Roomy (2 vCPU · 8 GB)" },
  Standard_B4als_v2: { vcpu: 4, ramGb: 8, usdPerHour: 0.1504, label: "Build burst (4 vCPU · 8 GB)" },
} as const;
export const VmSize = z.enum(Object.keys(VM_SIZES) as [keyof typeof VM_SIZES, ...(keyof typeof VM_SIZES)[]]);
export type VmSize = z.infer<typeof VmSize>;

/** Fixed costs billed even while the VM is off (USD/month). */
export const FIXED_MONTHLY_USD = { osDisk32gbStandardSsd: 2.4, controlPlane: 0.1 } as const;
/** Standard public IP, only exists while the VM is on (USD/hour). */
export const PUBLIC_IP_USD_PER_HOUR = 0.005;

export const VmStatus = z.object({
  power: VmPowerState,
  size: VmSize.or(z.string()),
  region: z.string(),
  fqdn: z.string().nullable(),
  publicIp: z.string().nullable(),
  /** ISO time the current power state was entered, if known. */
  since: z.string().nullable(),
  /** True when the VM agent answered /health in the last check. */
  agentHealthy: z.boolean(),
});
export type VmStatus = z.infer<typeof VmStatus>;

export const UsageSummary = z.object({
  monthToDateHours: z.number(),
  monthToDateUsd: z.number(),
  budgetUsd: z.number(),
  projectedUsd: z.number(),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

/* ----------------------------------------------------------------------------
 * Meetings
 * ------------------------------------------------------------------------- */

export const Platform = z.enum(["meet", "zoom", "teams", "other"]);
export type Platform = z.infer<typeof Platform>;

/**
 * How the bot appears while you are NOT live. Deliberately has no
 * "pre-recorded video as camera" option — see docs/ETHICS.md.
 */
export const Presence = z.enum(["camera-off", "static-image"]);
export type Presence = z.infer<typeof Presence>;

export const ScreenshotPolicy = z.object({
  enabled: z.boolean().default(true),
  /** Random interval bounds, in minutes. */
  randomMinMinutes: z.number().min(0.5).max(120).default(3),
  randomMaxMinutes: z.number().min(0.5).max(240).default(8),
  /** Capture whenever the shared screen/slide visibly changes. */
  onSlideChange: z.boolean().default(true),
  /** 0..64 — Hamming distance between perceptual hashes that counts as a "new slide". */
  slideSensitivity: z.number().int().min(1).max(64).default(10),
});
export type ScreenshotPolicy = z.infer<typeof ScreenshotPolicy>;

export const DeliveryPolicy = z.object({
  drive: z.boolean().default(false),
  email: z.boolean().default(false),
  keepOnVm: z.boolean().default(true),
  /** Email recipient; defaults to the connected Google account. */
  emailTo: z.string().email().optional(),
  includeRecording: z.boolean().default(true),
});
export type DeliveryPolicy = z.infer<typeof DeliveryPolicy>;

export const MeetingInput = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  autoJoin: z.boolean().default(true),
  /** "profile" = the signed-in Chrome profile on the VM; "guest" = anonymous with guestName. */
  joinAs: z.enum(["profile", "guest"]).default("profile"),
  guestName: z.string().max(80).optional(),
  presence: Presence.default("camera-off"),
  /** Leave automatically when the bot is the only participant for this many minutes (0 = never). */
  leaveWhenAloneMinutes: z.number().int().min(0).max(120).default(5),
  /** Stay up to this many minutes after endAt if the meeting runs long. */
  overrunMinutes: z.number().int().min(0).max(180).default(15),
  record: z.boolean().default(true),
  screenshots: ScreenshotPolicy.default(ScreenshotPolicy.parse({})),
  delivery: DeliveryPolicy.default(DeliveryPolicy.parse({})),
});
export type MeetingInput = z.input<typeof MeetingInput>;
export type MeetingConfig = z.output<typeof MeetingInput>;

export const MeetingStatus = z.enum(["scheduled", "joining", "live", "done", "failed", "cancelled"]);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

export const Meeting = MeetingInput.extend({
  id: z.string(),
  platform: Platform,
  status: MeetingStatus,
  createdAt: z.string(),
  source: z.enum(["manual", "ics"]).default("manual"),
  /** Set by "Join now": the agent joins immediately regardless of startAt. */
  joinNowAt: z.string().nullable().default(null),
  /** Last error / note from the bot. */
  note: z.string().nullable().default(null),
});
export type Meeting = z.output<typeof Meeting>;

/* ----------------------------------------------------------------------------
 * Bot runtime (lives on the VM agent)
 * ------------------------------------------------------------------------- */

export const BotPhase = z.enum([
  "idle",
  "launching",
  "joining",
  "waiting-room",
  "in-meeting",
  "leaving",
  "ended",
  "error",
]);
export type BotPhase = z.infer<typeof BotPhase>;

export const BotState = z.object({
  meetingId: z.string().nullable(),
  phase: BotPhase,
  camera: z.enum(["off", "static-image", "live"]),
  mic: z.enum(["muted", "live"]),
  recording: z.boolean(),
  screenshots: z.number().int(),
  participants: z.number().int().nullable(),
  message: z.string().nullable(),
  updatedAt: z.string(),
});
export type BotState = z.infer<typeof BotState>;

export const BotCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("screenshot") }),
  z.object({ type: z.literal("burst"), count: z.number().int().min(2).max(20).default(5) }),
  z.object({ type: z.literal("chat"), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("raise-hand") }),
  z.object({ type: z.literal("camera"), mode: z.enum(["off", "static-image", "live"]) }),
  z.object({ type: z.literal("mic"), mode: z.enum(["muted", "live"]) }),
  z.object({ type: z.literal("leave") }),
]);
export type BotCommand = z.infer<typeof BotCommand>;

export const Screenshot = z.object({
  id: z.string(),
  meetingId: z.string(),
  takenAt: z.string(),
  reason: z.enum(["manual", "random", "slide", "burst"]),
  file: z.string(),
  bytes: z.number().int(),
});
export type Screenshot = z.infer<typeof Screenshot>;

/* ----------------------------------------------------------------------------
 * Access tokens (for AI sessions, the apps, and sharing)
 * ------------------------------------------------------------------------- */

export const TokenScope = z.enum([
  "owner", // everything, incl. minting tokens
  "machine", // start/stop/resize via control plane
  "meetings", // read/write meetings, drive the bot
  "view", // watch the live desktop (read-only)
  "terminal", // shell access
  "files", // read/write files
  "mcp", // MCP endpoint (implies terminal+files tools)
]);
export type TokenScope = z.infer<typeof TokenScope>;

export const CreateTokenInput = z.object({
  label: z.string().min(1).max(80),
  scopes: z.array(TokenScope).min(1),
  /** Lifetime in hours; max 30 days. */
  ttlHours: z.number().min(0.25).max(24 * 30).default(24),
});
export type CreateTokenInput = z.input<typeof CreateTokenInput>;

export const AccessTokenInfo = z.object({
  id: z.string(),
  label: z.string(),
  scopes: z.array(TokenScope),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revoked: z.boolean(),
});
export type AccessTokenInfo = z.infer<typeof AccessTokenInfo>;
