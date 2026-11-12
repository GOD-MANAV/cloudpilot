import { EventEmitter } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { BotCommand, BotState, Meeting, Screenshot } from "@cloudpilot/shared";
import type { AgentConfig } from "../config.js";
import type { IdleWatch } from "../idle.js";
import { autoLeaveDecision, type Settings } from "../settings.js";
import { adapterFor, type MeetingAdapter } from "./adapters/index.js";
import type { AdapterContext } from "./adapters/types.js";
import { MEETING_SINK, Recorder, ensureAudioSink } from "./recorder.js";
import { ShotEngine } from "./shots.js";
import { X11, sleep } from "./x11.js";

const INJECT = fileURLToPath(new URL("../inject/media.js", import.meta.url));

export interface FinishedMeeting {
  meeting: Meeting;
  dir: string;
  recording: string | null;
  shots: Screenshot[];
  outcome: "done" | "failed";
  note: string | null;
}

export interface BotEvents {
  state: [BotState];
  shot: [Screenshot];
  notify: [{ title: string; body: string }];
  finished: [FinishedMeeting];
}

/**
 * Drives one meeting at a time in a real, signed-in Chrome on the VM's display.
 */
export class BotRunner extends EventEmitter<BotEvents> {
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private adapter: MeetingAdapter | null = null;
  private meeting: Meeting | null = null;
  private shotsEngine: ShotEngine | null = null;
  private recorder: Recorder;
  private x11: X11;
  private releaseIdle: (() => void) | null = null;
  private stopRequested = false;
  private recordingPath: string | null = null;

  state: BotState = {
    meetingId: null,
    phase: "idle",
    camera: "off",
    mic: "muted",
    recording: false,
    screenshots: 0,
    participants: null,
    message: null,
    updatedAt: new Date().toISOString(),
  };

  constructor(
    private readonly cfg: AgentConfig,
    private readonly idle: IdleWatch,
    private readonly getSettings: () => Promise<Settings>,
  ) {
    super();
    this.recorder = new Recorder(cfg.display);
    this.x11 = new X11(cfg.display);
  }

  get busy() {
    return this.state.phase !== "idle" && this.state.phase !== "ended" && this.state.phase !== "error";
  }

  private set(patch: Partial<BotState>) {
    this.state = { ...this.state, ...patch, updatedAt: new Date().toISOString() };
    this.emit("state", this.state);
  }

  /** Launch (or reuse) Chrome with the persistent profile on the VM display. */
  async browser(): Promise<BrowserContext> {
    if (this.ctx) return this.ctx;
    await ensureAudioSink().catch((e) => console.warn("audio sink", e));
    this.ctx = await chromium.launchPersistentContext(this.cfg.chromeProfile, {
      executablePath: this.cfg.chromePath,
      headless: false,
      viewport: null,
      env: { ...process.env, DISPLAY: this.cfg.display, PULSE_SINK: MEETING_SINK },
      ignoreDefaultArgs: ["--enable-automation", "--mute-audio"],
      args: [
        "--disable-blink-features=AutomationControlled",
        "--window-position=0,0",
        "--window-size=1280,800",
        "--start-maximized",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--disable-features=Translate,MediaRouter",
        "--password-store=basic",
      ],
      permissions: ["camera", "microphone", "notifications"],
    });
    await this.ctx.addInitScript({ path: INJECT });
    this.ctx.on("close", () => {
      this.ctx = null;
      this.page = null;
    });
    return this.ctx;
  }

  /** Open a page in the bot's Chrome so you can sign in through the live desktop. */
  async openForSignIn(url = "https://accounts.google.com/") {
    const ctx = await this.browser();
    const page = ctx.pages().find((p) => p !== this.page) ?? (await ctx.newPage());
    await page.goto(url);
    await page.bringToFront();
  }

  /** Load a URL in a throw-away tab and report where it ended up (used to check sign-in state). */
  async probe(url: string): Promise<{ url: string; title: string }> {
    const ctx = await this.browser();
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      // Single-sign-on pages hop through several redirects; give them time to settle.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await sleep(2000);
      return { url: page.url(), title: await page.title().catch(() => "") };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** Remove the cookies of a platform (sign out). */
  async clearCookies(domains: readonly string[]) {
    const ctx = await this.browser();
    for (const d of domains) await ctx.clearCookies({ domain: new RegExp(`(^|\\.)${d.replace(/\./g, "\\.")}$`) });
  }

  private adapterCtx(): AdapterContext {
    const m = this.meeting!;
    return {
      page: this.page!,
      x11: this.x11,
      guestName: m.joinAs === "guest" ? m.guestName ?? "CloudPilot" : null,
      startWithCamera: m.presence === "static-image",
    };
  }

  async join(meeting: Meeting): Promise<void> {
    if (this.busy) throw new Error(`Already in a meeting (${this.state.meetingId})`);
    this.meeting = meeting;
    this.stopRequested = false;
    this.recordingPath = null;
    this.releaseIdle = this.idle.hold("meeting");
    const settings = await this.getSettings();
    const dir = join(this.cfg.dataDir, "meetings", meeting.id);
    await mkdir(dir, { recursive: true });
    this.set({
      meetingId: meeting.id,
      phase: "launching",
      camera: meeting.presence === "static-image" ? "static-image" : "off",
      mic: "muted",
      recording: false,
      screenshots: 0,
      participants: null,
      message: null,
    });

    try {
      this.adapter = adapterFor(meeting.platform);
      const ctx = await this.browser();
      this.page = await ctx.newPage();
      await this.page.bringToFront();
      await this.page.goto(this.adapter.joinUrl(meeting.url), { waitUntil: "domcontentloaded", timeout: 60_000 });

      if (meeting.presence === "static-image" && settings.staticImageFile) {
        const img = await readFile(settings.staticImageFile);
        const mime = extname(settings.staticImageFile).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
        await this.page.evaluate(
          async ([d]) => {
            const cp = (window as unknown as { __cp: { setImage(u: string): Promise<void>; setMode(m: string): string } }).__cp;
            await cp.setImage(d!);
            cp.setMode("image");
          },
          [`data:${mime};base64,${img.toString("base64")}`],
        );
      }

      this.set({ phase: "joining", message: `Joining ${this.adapter.name}…` });
      await this.adapter.join(this.adapterCtx());
      await this.monitor(meeting, dir, settings);
    } catch (e) {
      console.error("join failed", e);
      await this.finish(dir, "failed", (e as Error).message);
    }
  }

  private async monitor(meeting: Meeting, dir: string, settings: Settings) {
    const page = this.page!;
    const adapter = this.adapter!;
    const started = Date.now();
    const hardEnd = Date.parse(meeting.endAt) + meeting.overrunMinutes * 60_000;
    let waitingSince: number | null = null;
    let aloneSince: number | null = null;
    let lowSince: number | null = null;
    let peak = 0;
    let joinedAt = 0;
    let inMeeting = false;

    while (!this.stopRequested) {
      await sleep(3000);
      if (page.isClosed()) return this.finish(dir, inMeeting ? "done" : "failed", "Browser tab closed");
      const where = await adapter.where(page).catch(() => "unknown" as const);

      if (where === "waiting") {
        if (waitingSince === null) {
          waitingSince = Date.now();
          this.set({ phase: "waiting-room", message: "Waiting for the host to let you in" });
          this.emit("notify", { title: "In the waiting room", body: `${meeting.title}: waiting to be admitted.` });
        }
        if (Date.now() - waitingSince > 20 * 60_000) return this.leaveAndFinish(dir, "failed", "Not admitted within 20 minutes");
      }

      if (where === "in-meeting" && !inMeeting) {
        inMeeting = true;
        joinedAt = Date.now();
        this.set({ phase: "in-meeting", message: null });
        this.emit("notify", { title: "Joined", body: `CloudPilot is in "${meeting.title}".` });
        if (meeting.record) {
          this.recordingPath = join(dir, "recording.mp4");
          this.recorder.start(this.recordingPath, settings.recordingFps);
          this.set({ recording: true });
          if (settings.announceRecording)
            await this.adapter!.chat(this.adapterCtx(), settings.recordingNotice).catch((e) => console.warn("recording notice not posted:", (e as Error).message));
        }
        this.shotsEngine = new ShotEngine(dir, meeting.id, () => page.screenshot({ type: "jpeg", quality: 82 }), (s) => {
          this.set({ screenshots: this.state.screenshots + 1 });
          this.emit("shot", s);
        });
        await this.shotsEngine.init();
        this.shotsEngine.start(meeting.screenshots);
      }

      if (where === "ended") return this.finish(dir, inMeeting ? "done" : "failed", inMeeting ? null : "Couldn't join (meeting ended or access denied)");

      if (inMeeting) {
        const n = await adapter.participants(page).catch(() => null);
        if (n !== this.state.participants) this.set({ participants: n });
        if (n !== null) peak = Math.max(peak, n);
        // Re-read settings each loop so toggling "auto-leave" mid-meeting takes effect.
        const live = await this.getSettings().catch(() => settings);
        const d = autoLeaveDecision(live.autoLeave, { count: n, peak, joinedAt, lowSince, now: Date.now() });
        lowSince = d.lowSince;
        if (d.leave) return this.leaveAndFinish(dir, "done", d.leave);
        if (meeting.leaveWhenAloneMinutes > 0 && n !== null && n <= 1) {
          aloneSince ??= Date.now();
          if (Date.now() - aloneSince > meeting.leaveWhenAloneMinutes * 60_000)
            return this.leaveAndFinish(dir, "done", "Left: everyone else had gone");
        } else aloneSince = null;
      }

      if (Date.now() > hardEnd && !meeting.joinNowAt) return this.leaveAndFinish(dir, "done", "Left at scheduled end");
      if (meeting.joinNowAt && Date.now() - started > 4 * 3600_000) return this.leaveAndFinish(dir, "done", "Left after 4 hours");
    }
    return this.leaveAndFinish(dir, "done", "Left on request");
  }

  private async leaveAndFinish(dir: string, outcome: "done" | "failed", note: string) {
    this.set({ phase: "leaving", message: note });
    if (this.adapter && this.page && !this.page.isClosed()) await this.adapter.leave(this.adapterCtx()).catch(() => undefined);
    await this.finish(dir, outcome, note);
  }

  private async finish(dir: string, outcome: "done" | "failed", note: string | null) {
    this.shotsEngine?.stop();
    await this.recorder.stop();
    await this.page?.evaluate(() => (window as unknown as { __cp?: { endLive(): void } }).__cp?.endLive()).catch(() => undefined);
    await this.page?.close().catch(() => undefined);
    const meeting = this.meeting!;
    const shots = this.shotsEngine ? [...this.shotsEngine.shots] : [];
    this.set({ phase: outcome === "done" ? "ended" : "error", recording: false, message: note, camera: "off", mic: "muted" });
    this.page = null;
    this.shotsEngine = null;
    this.releaseIdle?.();
    this.releaseIdle = null;
    this.emit("finished", { meeting, dir, recording: this.recordingPath, shots, outcome, note });
  }

  /* ------------------------------------------------------------ live controls */

  private async ensureCamera(on: boolean) {
    const cur = await this.adapter!.isCameraOn(this.page!);
    if (cur !== null && cur !== on) await this.adapter!.toggleCamera(this.adapterCtx());
  }
  private async ensureMic(on: boolean) {
    const cur = await this.adapter!.isMicOn(this.page!);
    if (cur !== null && cur !== on) await this.adapter!.toggleMic(this.adapterCtx());
  }
  private setMode(mode: "off" | "image" | "live") {
    return this.page!.evaluate((m) => (window as unknown as { __cp: { setMode(m: string): string } }).__cp.setMode(m), mode);
  }

  async command(cmd: BotCommand): Promise<BotState> {
    if (this.state.phase !== "in-meeting" && cmd.type !== "leave") {
      if (cmd.type === "screenshot" && this.page) {
        // allow manual shots in the waiting room too
      } else throw new Error("Not in a meeting");
    }
    const ctx = this.adapterCtx();
    switch (cmd.type) {
      case "screenshot":
        await this.shotsEngine?.take("manual");
        break;
      case "burst":
        void this.shotsEngine?.burst(cmd.count);
        break;
      case "chat":
        await this.adapter!.chat(ctx, cmd.text);
        break;
      case "raise-hand":
        await this.adapter!.raiseHand(ctx);
        break;
      case "camera":
        if (cmd.mode === "off") {
          await this.setMode("off");
          await this.ensureCamera(false);
        } else {
          if (cmd.mode === "live" && this.state.camera !== "live" && !(await this.liveConnected()))
            throw new Error("Connect your phone camera first (Go live)");
          await this.setMode(cmd.mode === "live" ? "live" : "image");
          await this.ensureCamera(true);
        }
        this.set({ camera: cmd.mode });
        break;
      case "mic":
        if (cmd.mode === "live" && !(await this.liveConnected())) throw new Error("Connect your phone mic first (Go live)");
        await this.ensureMic(cmd.mode === "live");
        this.set({ mic: cmd.mode });
        break;
      case "leave":
        this.stopRequested = true;
        break;
    }
    return this.state;
  }

  private async liveConnected(): Promise<boolean> {
    return (await this.page?.evaluate(() => (window as unknown as { __cp: { mode: string } }).__cp.mode).catch(() => "off")) === "live";
  }

  /** Phone → meeting: accept the phone's WebRTC offer inside the meeting tab. */
  async acceptPhoneOffer(sdp: string): Promise<string> {
    if (!this.page || this.state.phase !== "in-meeting") throw new Error("Not in a meeting");
    const answer = await this.page.evaluate(
      (o) => (window as unknown as { __cp: { acceptOffer(s: string): Promise<string> } }).__cp.acceptOffer(o),
      sdp,
    );
    // Going live shows your camera immediately; the mic stays muted until you unmute.
    await this.ensureCamera(true);
    this.set({ camera: "live" });
    return answer;
  }

  async endLive() {
    if (!this.page) return;
    await this.page.evaluate(() => (window as unknown as { __cp: { endLive(): void } }).__cp.endLive()).catch(() => undefined);
    await this.ensureMic(false).catch(() => undefined);
    await this.ensureCamera(this.meeting?.presence === "static-image").catch(() => undefined);
    this.set({ camera: this.meeting?.presence === "static-image" ? "static-image" : "off", mic: "muted" });
  }

  /** JPEG of the current meeting tab (for previews). */
  async preview(): Promise<Buffer | null> {
    return this.page && !this.page.isClosed() ? this.page.screenshot({ type: "jpeg", quality: 60 }) : null;
  }
}
