import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex, signToken, type Meeting } from "@cloudpilot/shared";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { teamsWebUrl } from "./bot/adapters/teams.js";
import { countFromLabel } from "./bot/adapters/types.js";
import { zoomWebClientUrl } from "./bot/adapters/zoom.js";
import { ffmpegArgs } from "./bot/recorder.js";
import { ShotEngine } from "./bot/shots.js";
import { ControlLink } from "./control.js";
import { buildMime, summaryHtml } from "./delivery/email.js";
import { pickHighlights } from "./delivery/pipeline.js";
import { IdleWatch } from "./idle.js";
import { buildServer } from "./server.js";
import { settingsFile } from "./settings.js";

const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 320, height: 200, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
const split = () =>
  sharp({ create: { width: 320, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: { create: { width: 160, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } } }, left: 0, top: 0 }])
    .jpeg()
    .toBuffer();
const gradient = async () => {
  const w = 320, h = 200, buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf.fill(Math.round(((x + y * 2) % 97) * 2.6), (y * w + x) * 3, (y * w + x) * 3 + 3);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cp-agent-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("platform URLs", () => {
  it("rewrites Zoom invites to the web client", () => {
    expect(zoomWebClientUrl("https://us02web.zoom.us/j/81234567890?pwd=abc.1")).toBe(
      "https://app.zoom.us/wc/join/81234567890?pwd=abc.1",
    );
    expect(zoomWebClientUrl("https://example.zoom.us/my/someone")).toBe("https://example.zoom.us/my/someone");
  });
  it("forces Teams into the browser", () => {
    const u = new URL(teamsWebUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d"));
    expect(u.searchParams.get("msLaunch")).toBe("false");
    expect(u.searchParams.get("context")).toBe("{}");
  });
  it("parses participant counts", () => {
    expect(countFromLabel("Show everyone (12)")).toBe(12);
    expect(countFromLabel("People")).toBeNull();
  });
});

describe("recorder", () => {
  it("builds crash-safe low-CPU ffmpeg args", () => {
    const a = ffmpegArgs({ display: ":1", fps: 8, out: "/data/x.mp4" });
    expect(a).toContain("x11grab");
    expect(a.join(" ")).toContain("frag_keyframe");
    expect(a[a.indexOf("-framerate") + 1]).toBe("8");
    expect(a.at(-1)).toBe("/data/x.mp4");
  });
});

describe("ShotEngine", () => {
  it("captures manual shots and detects slide changes but not identical frames", async () => {
    const white = await solid(255, 255, 255);
    const changed = await split();
    const engine = new ShotEngine(join(dir, "m1"), "m1", async () => white);
    await engine.init();
    await engine.take("manual");
    expect(engine.shots).toHaveLength(1);
    expect(await engine.checkSlide(10, white)).toBe(false); // baseline
    expect(await engine.checkSlide(10, white)).toBe(false); // same slide
    expect(await engine.checkSlide(10, await gradient())).toBe(true); // new slide
    expect(await engine.checkSlide(10, changed)).toBe(false); // debounced (<8s)
    const index = JSON.parse(await readFile(join(dir, "m1", "shots.json"), "utf8"));
    expect(index.map((s: { reason: string }) => s.reason)).toEqual(["manual", "slide"]);
  });
});

describe("IdleWatch", () => {
  it("deallocates only after the idle window, never while held", async () => {
    let fired = 0;
    const w = new IdleWatch(20, async () => void fired++, async () => 0);
    const t0 = Date.now();
    expect(await w.check(t0 + 10 * 60_000)).toBe(false);
    const release = w.hold("meeting");
    expect(await w.check(t0 + 30 * 60_000)).toBe(false);
    release();
    expect(await w.check(Date.now() + 21 * 60_000)).toBe(true);
    expect(fired).toBe(1);
  });
  it("treats CPU load as activity", async () => {
    const w = new IdleWatch(1, async () => undefined, async () => 0.9);
    expect(await w.check(Date.now() + 5 * 60_000)).toBe(false);
  });
});

describe("delivery", () => {
  const shots = Array.from({ length: 40 }, (_, i) => ({
    reason: i === 5 ? "manual" : i % 7 === 0 ? "slide" : "random",
    takenAt: new Date(Date.UTC(2026, 10, 15, 4, i)).toISOString(),
  }));
  it("picks highlights spread across the meeting, keeping manual shots", () => {
    const h = pickHighlights(shots, 8);
    expect(h).toHaveLength(8);
    expect(h.some((s) => s.reason === "manual")).toBe(true);
    expect(h[0]!.takenAt < h[7]!.takenAt).toBe(true);
  });
  it("builds a valid multipart email with inline images", async () => {
    const meeting = {
      id: "m",
      title: "Ops <Lecture>",
      startAt: "2026-11-15T04:30:00Z",
      platform: "meet",
    } as unknown as Meeting;
    const jpeg = await solid(10, 20, 30);
    const shot = { id: "s", meetingId: "m", takenAt: "2026-11-15T04:35:00Z", reason: "slide" as const, file: "a.jpg", bytes: 1 };
    const html = summaryHtml({ meeting, outcome: "done", note: null, images: [{ cid: "c1", jpeg, shot }], totalShots: 3, driveUrl: "https://drive.google.com/x", recordingUrl: null });
    expect(html).toContain("Ops &lt;Lecture&gt;");
    expect(html).toContain("cid:c1");
    expect(html).toContain("+2 more");
    const mime = buildMime({ to: "me@example.com", subject: "Notes ✓", html, images: [{ cid: "c1", jpeg, shot }] });
    expect(mime).toMatch(/Content-Type: multipart\/related; boundary="cp_[0-9a-f]+"/);
    expect(mime).toContain("Content-ID: <c1>");
    expect(mime.split("\r\n").every((l) => l.length <= 998)).toBe(true);
  });
});

describe("HTTP server", async () => {
  const OWNER = "cp_owner";
  const KEY = "k";
  const home = await mkdtemp(join(tmpdir(), "cp-home-"));
  const cfg = {
    fqdn: "box.example.com",
    port: 0,
    ownerTokenSha256: await sha256Hex(OWNER),
    signingKey: KEY,
    controlUrl: "",
    dataDir: home,
    home,
    display: ":1",
    chromePath: "",
    chromeProfile: "",
    idleMinutes: 20,
  };
  const idle = new IdleWatch(20, async () => undefined, async () => 0);
  const { ActivityLog } = await import("./activity.js");
  const activity = new ActivityLog();
  const app = await buildServer({
    cfg,
    control: new ControlLink(cfg),
    bot: { state: { phase: "idle" }, on() {}, off() {} } as never,
    idle,
    google: { status: async () => ({ connected: false, email: null, redirectUri: "" }) } as never,
    delivery: {} as never,
    settings: settingsFile(home),
    activity,
    joinMeeting: async () => undefined,
  });
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  it("health is public; everything else needs a token", async () => {
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/status" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/status", headers: auth(OWNER) })).statusCode).toBe(200);
  });

  it("enforces scopes and keeps file access inside allowed roots", async () => {
    const viewer = await signToken(KEY, { id: "v", expiresAt: 4e9, scopes: ["view"] });
    expect((await app.inject({ url: "/files", headers: auth(viewer) })).statusCode).toBe(403);
    const put = await app.inject({
      method: "PUT",
      url: "/files?path=proj/hello.txt",
      headers: { ...auth(OWNER), "content-type": "application/octet-stream" },
      payload: Buffer.from("hi"),
    });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ url: "/files?path=proj/hello.txt", headers: auth(OWNER) })).body).toBe("hi");
    expect((await app.inject({ url: "/files?path=/etc/passwd", headers: auth(OWNER) })).statusCode).toBe(403);
    expect((await app.inject({ url: "/files?path=../../etc/passwd", headers: auth(OWNER) })).statusCode).toBe(403);
  });

  it("redacts secrets in settings and preserves them on round-trip", async () => {
    await app.inject({ method: "PUT", url: "/settings", headers: auth(OWNER), payload: { smtp: { host: "smtp.gmail.com", user: "u", pass: "secret" } } });
    const got = (await app.inject({ url: "/settings", headers: auth(OWNER) })).json();
    expect(got.smtp.pass).toBe("••••");
    await app.inject({ method: "PUT", url: "/settings", headers: auth(OWNER), payload: { smtp: got.smtp } });
    const raw = JSON.parse(await readFile(join(home, "settings.json"), "utf8"));
    expect(raw.smtp.pass).toBe("secret");
  });

  it("speaks MCP and lists tools for an mcp-scoped token (header or path)", async () => {
    const t = await signToken(KEY, { id: "ai", expiresAt: 4e9, scopes: ["mcp"] });
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    expect((await app.inject({ method: "POST", url: "/mcp", headers, payload: body })).statusCode).toBe(401);
    for (const req of [
      { url: "/mcp", headers: { ...headers, ...auth(t) } },
      { url: `/mcp/${t}`, headers },
    ]) {
      const r = await app.inject({ method: "POST", ...req, payload: body });
      expect(r.statusCode).toBe(200);
      const names = (r.json() as { result: { tools: { name: string }[] } }).result.tools.map((x) => x.name);
      expect(names).toEqual(expect.arrayContaining(["run_command", "read_file", "write_file", "list_directory", "machine_info"]));
    }
  });

  it("desktop login sets a host cookie and forward-auth accepts it", async () => {
    const viewer = await signToken(KEY, { id: "v2", expiresAt: 4e9, scopes: ["view"] });
    const r = await app.inject({ url: `/desktop/login?token=${viewer}` });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("https://box.example.com:8443/");
    const c = String(r.headers["set-cookie"]).split(";")[0]!;
    expect((await app.inject({ url: "/auth/desktop", headers: { cookie: c } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/auth/desktop" })).statusCode).toBe(401);
  });
});

describe("auto-leave when people are leaving", async () => {
  const { autoLeaveDecision, AutoLeave } = await import("./settings.js");
  const on = AutoLeave.parse({ enabled: true }); // minPeople 3, 25% of peak, 3 min grace, 10 min warm-up
  const t0 = 1_000_000;
  const at = (min: number) => t0 + min * 60_000;
  it("does nothing when disabled or during warm-up", () => {
    expect(autoLeaveDecision(AutoLeave.parse({}), { count: 1, peak: 40, joinedAt: t0, lowSince: null, now: at(30) }).leave).toBeNull();
    expect(autoLeaveDecision(on, { count: 2, peak: 40, joinedAt: t0, lowSince: null, now: at(5) }).leave).toBeNull();
  });
  it("needs the low headcount to last the grace period", () => {
    const first = autoLeaveDecision(on, { count: 3, peak: 40, joinedAt: t0, lowSince: null, now: at(60) });
    expect(first.leave).toBeNull();
    expect(first.lowSince).toBe(at(60));
    const later = autoLeaveDecision(on, { count: 3, peak: 40, joinedAt: t0, lowSince: first.lowSince, now: at(63.5) });
    expect(later.leave).toMatch(/only 3 people left/);
  });
  it("leaves when most of a big class has gone, and resets if people come back", () => {
    let s = autoLeaveDecision(on, { count: 9, peak: 40, joinedAt: t0, lowSince: null, now: at(80) });
    expect(s.lowSince).toBe(at(80)); // 9 <= 25% of 40
    expect(autoLeaveDecision(on, { count: 20, peak: 40, joinedAt: t0, lowSince: s.lowSince, now: at(82) }).lowSince).toBeNull();
    s = autoLeaveDecision(on, { count: 9, peak: 40, joinedAt: t0, lowSince: at(80), now: at(84) });
    expect(s.leave).toMatch(/9 of 40/);
  });
  it("ignores the percentage rule for tiny meetings", () => {
    expect(autoLeaveDecision(on, { count: 4, peak: 6, joinedAt: t0, lowSince: null, now: at(30) }).lowSince).toBeNull();
  });
});

describe("AI activity feed", () => {
  it("logs MCP calls with the link name, and blocks them while paused", async () => {
    const { ActivityLog } = await import("./activity.js");
    const { buildMcpServer } = await import("./mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const log = new ActivityLog();
    const events: string[] = [];
    log.on("event", (e) => events.push(e.type));
    const server = buildMcpServer({ home: dir, fqdn: "x", onActivity: () => undefined, activity: log, actor: { id: "t1", label: "Claude Code" } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    await client.callTool({ name: "write_file", arguments: { path: "x.txt", content: "hello" } });
    await client.callTool({ name: "read_file", arguments: { path: "x.txt" } });
    expect(log.list()[0]).toMatchObject({ actor: "Claude Code", tool: "read_file", status: "ok" });
    expect(events).toEqual(expect.arrayContaining(["start", "end"]));
    log.pause(5);
    const r = (await client.callTool({ name: "read_file", arguments: { path: "x.txt" } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    expect(log.list()[0]!.status).toBe("blocked");
    log.pause(0);
    expect(log.paused).toBe(false);
  });
});
