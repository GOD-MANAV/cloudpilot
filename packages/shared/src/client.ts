import { z } from "zod";
import {
  AccessTokenInfo,
  BotState,
  Meeting,
  Screenshot,
  UsageSummary,
  VmStatus,
  type BotCommand,
  type CreateTokenInput,
  type MeetingInput,
  type VmSize,
  VmProfiles,
  type VmProfilesPatch,
  type StartPurpose,
} from "./schemas.js";

export const CreatedToken = z.object({ info: AccessTokenInfo, token: z.string() });

export const AgentStatus = z.object({
  bot: BotState,
  idle: z.object({
    idleMinutes: z.number(),
    shutdownInMinutes: z.number().nullable(),
    holds: z.record(z.string(), z.number()),
    keepOnUntil: z.string().nullable(),
  }),
  control: z.object({ lastSyncAt: z.string().nullable(), meetings: z.number() }),
  diskFreeGb: z.number().nullable(),
  google: z.object({ connected: z.boolean(), email: z.string().nullable(), redirectUri: z.string() }),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

export const GoogleStatus = z.object({ connected: z.boolean(), email: z.string().nullable(), redirectUri: z.string() });

export const RecentMeeting = z.object({
  id: z.string(),
  screenshots: z.number(),
  recordingBytes: z.number().nullable(),
  delivery: z
    .object({
      driveFolderUrl: z.string().nullable(),
      recordingUrl: z.string().nullable(),
      emailed: z.boolean(),
      errors: z.array(z.string()),
    })
    .passthrough()
    .nullable(),
  modifiedAt: z.string(),
});
export type RecentMeeting = z.infer<typeof RecentMeeting>;

/** Settings as returned by the agent (secrets come back as "••••"). */
export const AgentSettings = z
  .object({
    google: z.object({ clientId: z.string(), clientSecret: z.string(), driveFolderId: z.string().optional() }).optional(),
    smtp: z
      .object({ host: z.string(), port: z.number(), secure: z.boolean(), user: z.string(), pass: z.string(), from: z.string().optional() })
      .optional(),
    emailTo: z.string().optional(),
    defaultGuestName: z.string(),
    staticImageFile: z.string().optional(),
    recordingFps: z.number(),
    pruneAfterDays: z.number(),
    pushTokens: z.array(z.string()),
    timeZone: z.string(),
    autoLeave: z.object({
      enabled: z.boolean(),
      minPeople: z.number(),
      dropFraction: z.number(),
      graceMinutes: z.number(),
      warmupMinutes: z.number(),
    }),
    idleMinutes: z.number().optional(),
    ntfy: z.object({ enabled: z.boolean(), server: z.string(), topic: z.string().optional() }),
    notify: z.object({ joined: z.boolean(), waitingRoom: z.boolean(), finished: z.boolean(), aiActivity: z.boolean() }),
    privateNotifications: z.boolean().default(false),
    announceRecording: z.boolean().default(true),
    recordingNotice: z.string().default("Heads-up: I'm recording this meeting for my own notes."),
  })
  .passthrough();

export const AccountInfo = z.object({
  platform: z.enum(["teams", "zoom", "google"]),
  name: z.string(),
  signedIn: z.boolean().nullable(),
  detail: z.string().nullable(),
  checkedAt: z.string().nullable(),
  tips: z.array(z.string()),
});
export type AccountInfo = z.infer<typeof AccountInfo>;
export type AccountPlatformId = AccountInfo["platform"];

export const ActivityEntry = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.string(),
  actorId: z.string(),
  tool: z.string(),
  summary: z.string(),
  status: z.enum(["running", "ok", "error", "killed", "blocked"]),
  exitCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  output: z.string(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;
export type ActivityEvent =
  | { type: "start"; entry: ActivityEntry }
  | { type: "output"; id: string; chunk: string }
  | { type: "end"; entry: ActivityEntry }
  | { type: "pause"; pausedUntil: string | null };
export type AgentSettings = z.infer<typeof AgentSettings>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  /** Azure Function base URL, e.g. https://cloudpilot-ctl-xyz.azurewebsites.net/api */
  controlUrl: string;
  /** Owner token (or a scoped token). */
  token: string;
  fetch?: typeof fetch;
}

/**
 * Typed client used by both the Android app and the website.
 * Control-plane calls always work; agent calls only work while the VM is running.
 */
export class CloudPilotClient {
  private readonly f: typeof fetch;
  private agentBase: string | null = null;

  constructor(private readonly opts: ClientOptions) {
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async req<T extends z.ZodType>(
    schema: T | null,
    base: string,
    path: string,
    init: RequestInit = {},
  ): Promise<z.infer<T>> {
    const res = await this.f(base.replace(/\/$/, "") + path, {
      ...init,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
    if (res.status === 204 || !schema) return undefined as z.infer<T>;
    return schema.parse(await res.json());
  }

  private ctl<T extends z.ZodType>(schema: T | null, path: string, init?: RequestInit) {
    return this.req(schema, this.opts.controlUrl, path, init);
  }

  private async agent<T extends z.ZodType>(schema: T | null, path: string, init?: RequestInit) {
    if (!this.agentBase) {
      const s = await this.vmStatus();
      if (s.power !== "running" || !s.fqdn) throw new ApiError(503, "Machine is not running");
      this.agentBase = `https://${s.fqdn}`;
    }
    return this.req(schema, this.agentBase, path, init);
  }

  /** Base URL of the agent (https://<fqdn>) once known. */
  get agentUrl(): string | null {
    return this.agentBase;
  }

  /* ---------------- machine (control plane) ---------------- */
  async vmStatus() {
    const s = await this.ctl(VmStatus, "/vm/status");
    this.agentBase = s.power === "running" && s.fqdn ? `https://${s.fqdn}` : null;
    return s;
  }
  /** Starts the machine at the size set for `purpose` (default: AI and dev tasks). */
  vmStart(purpose: StartPurpose = "dev") {
    return this.ctl(VmStatus, "/vm/start", { method: "POST", body: JSON.stringify({ purpose }) });
  }
  vmProfiles() {
    return this.ctl(VmProfiles, "/vm/profiles");
  }
  setVmProfiles(patch: VmProfilesPatch) {
    return this.ctl(VmProfiles, "/vm/profiles", { method: "PUT", body: JSON.stringify(patch) });
  }
  vmStop() {
    this.agentBase = null;
    return this.ctl(VmStatus, "/vm/stop", { method: "POST" });
  }
  vmResize(size: VmSize) {
    return this.ctl(VmStatus, "/vm/resize", { method: "POST", body: JSON.stringify({ size }) });
  }
  usage() {
    return this.ctl(UsageSummary, "/usage");
  }

  /* ---------------- meetings (control plane, so they can be scheduled while VM is off) ---------------- */
  listMeetings() {
    return this.ctl(Meeting.array(), "/meetings");
  }
  createMeeting(input: MeetingInput) {
    return this.ctl(Meeting, "/meetings", { method: "POST", body: JSON.stringify(input) });
  }
  updateMeeting(id: string, patch: Partial<MeetingInput>) {
    return this.ctl(Meeting, `/meetings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  deleteMeeting(id: string) {
    return this.ctl(null, `/meetings/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  importIcs(icsUrl: string) {
    return this.ctl(Meeting.array(), "/meetings/import-ics", { method: "POST", body: JSON.stringify({ icsUrl }) });
  }
  /** Start the VM if needed and tell it to join now. */
  joinNow(id: string) {
    return this.ctl(Meeting, `/meetings/${encodeURIComponent(id)}/join-now`, { method: "POST" });
  }

  /* ---------------- bot (agent) ---------------- */
  botState() {
    return this.agent(BotState, "/bot/state");
  }
  botCommand(cmd: BotCommand) {
    return this.agent(BotState, "/bot/command", { method: "POST", body: JSON.stringify(cmd) });
  }
  screenshots(meetingId: string) {
    return this.agent(Screenshot.array(), `/meetings/${encodeURIComponent(meetingId)}/screenshots`);
  }

  /* ---------------- tokens (control plane = source of truth) ---------------- */
  listTokens() {
    return this.ctl(AccessTokenInfo.array(), "/tokens");
  }
  createToken(input: CreateTokenInput) {
    return this.ctl(CreatedToken, "/tokens", { method: "POST", body: JSON.stringify(input) });
  }
  revokeToken(id: string) {
    return this.ctl(null, `/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  /** Allow starting the VM this month even though the budget is used up. */
  overrideBudget() {
    return this.ctl(null, "/budget/override", { method: "POST" });
  }

  /* ---------------- agent extras (VM must be running) ---------------- */
  /** Bearer token this client uses. */
  get token(): string {
    return this.opts.token;
  }
  /** Resolve the agent base URL (throws 503 if the machine is off). */
  async ensureAgent(): Promise<string> {
    if (!this.agentBase) await this.vmStatus();
    if (!this.agentBase) throw new ApiError(503, "Machine is not running");
    return this.agentBase;
  }
  /** Agent URL with ?token= for <img>, <video>, WebViews and WebSockets that can't send headers. */
  async agentLink(path: string, ws = false): Promise<string> {
    const base = await this.ensureAgent();
    const u = new URL(base + path);
    u.searchParams.set("token", this.opts.token);
    if (ws) u.protocol = "wss:";
    return u.toString();
  }
  agentStatus() {
    return this.agent(AgentStatus, "/status");
  }
  keepOn(hours: number) {
    return this.agent(null, "/keep-on", { method: "POST", body: JSON.stringify({ hours }) });
  }
  botJoin(meetingId: string) {
    return this.agent(null, "/bot/join", { method: "POST", body: JSON.stringify({ meetingId }) });
  }
  botSignIn(url?: string) {
    return this.agent(null, "/bot/signin", { method: "POST", body: JSON.stringify(url ? { url } : {}) });
  }
  recentMeetings() {
    return this.agent(RecentMeeting.array(), "/meetings/recent");
  }
  redeliver(meetingId: string) {
    return this.agent(null, `/meetings/${encodeURIComponent(meetingId)}/deliver`, { method: "POST" });
  }
  getSettings() {
    return this.agent(AgentSettings, "/settings");
  }
  putSettings(patch: Partial<AgentSettings>) {
    return this.agent(AgentSettings, "/settings", { method: "PUT", body: JSON.stringify(patch) });
  }
  async uploadPresenceImage(bytes: Blob | ArrayBuffer, type: "image/jpeg" | "image/png") {
    const base = await this.ensureAgent();
    const res = await this.f(base + "/settings/static-image", {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.token}`, "content-type": type },
      body: bytes as BodyInit,
    });
    if (!res.ok) throw new ApiError(res.status, "Upload failed");
  }
  googleStatus() {
    return this.agent(GoogleStatus, "/google/status");
  }
  googleConnect() {
    return this.agent(z.object({ url: z.string() }), "/google/connect", { method: "POST" });
  }
  googleDisconnect() {
    return this.agent(null, "/google/disconnect", { method: "POST" });
  }
  registerPush(token: string) {
    return this.agent(null, "/push/register", { method: "POST", body: JSON.stringify({ token }) });
  }
  /* ---------------- meeting accounts (signed in once in the machine's Chrome) ---------------- */
  accounts() {
    return this.agent(AccountInfo.array(), "/accounts");
  }
  checkAccount(p: AccountPlatformId) {
    return this.agent(AccountInfo.omit({ name: true, tips: true }), `/accounts/${p}/check`, { method: "POST" });
  }
  /** Opens the platform's sign-in page in the machine's Chrome; then show the desktop. */
  signInAccount(p: AccountPlatformId) {
    return this.agent(null, `/accounts/${p}/signin`, { method: "POST" });
  }
  signOutAccount(p: AccountPlatformId) {
    return this.agent(null, `/accounts/${p}/signout`, { method: "POST" });
  }
  /** Type text into whatever has focus on the machine's desktop (e.g. a sign-in form). Not stored. */
  desktopType(text: string, enter = false) {
    return this.agent(null, "/desktop/type", { method: "POST", body: JSON.stringify({ text, enter }) });
  }
  desktopKey(key: "Return" | "Tab" | "BackSpace" | "Escape" | "ctrl+a" | "ctrl+v" | "ctrl+l" | "F5" | "Up" | "Down" | "Left" | "Right") {
    return this.agent(null, "/desktop/key", { method: "POST", body: JSON.stringify({ key }) });
  }

  activity() {
    return this.agent(z.object({ entries: ActivityEntry.array(), pausedUntil: z.string().nullable() }), "/activity");
  }
  killActivity(id: string) {
    return this.agent(null, `/activity/${encodeURIComponent(id)}/kill`, { method: "POST" });
  }
  /** Pause all AI (MCP) access for N minutes; 0 resumes. Running commands are stopped. */
  pauseAi(minutes: number) {
    return this.agent(null, "/ai/pause", { method: "POST", body: JSON.stringify({ minutes }) });
  }

  /** Opens the live desktop (sets a cookie, then redirects to :8443). */
  /** A one-time, 60-second link to the live desktop, so no long-lived token lands in browser history. */
  async desktopUrl(): Promise<string> {
    const { url } = await this.agent(z.object({ url: z.string() }), "/desktop/ticket", { method: "POST", body: "{}" });
    return url;
  }

  /* ---------------- login ---------------- */
  /**
   * Exchange the owner key + a 6-digit authenticator code for a device session.
   * The device token is revocable from "AI access → Devices".
   */
  static async login(opts: {
    controlUrl: string;
    ownerToken: string;
    code: string;
    deviceName: string;
    kind: "phone" | "web";
    fetch?: typeof fetch;
  }): Promise<{ token: string; info: AccessTokenInfo }> {
    const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const res = await f(opts.controlUrl.replace(/\/$/, "") + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: opts.ownerToken, code: opts.code, deviceName: opts.deviceName, kind: opts.kind }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, body.error ?? "Login failed");
    return CreatedToken.parse(body);
  }
}
