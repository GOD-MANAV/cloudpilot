import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, statfs, writeFile } from "node:fs/promises";
import { extname, join, posix } from "node:path";
import websocket from "@fastify/websocket";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BotCommand, hasScope, type AuthResult, type TokenScope } from "@cloudpilot/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { AccountPlatform, type Accounts } from "./accounts.js";
import type { ActivityLog } from "./activity.js";
import { X11 } from "./bot/x11.js";
import type { BotRunner } from "./bot/runner.js";
import type { AgentConfig } from "./config.js";
import type { ControlLink } from "./control.js";
import type { Delivery, DeliveryReport } from "./delivery/pipeline.js";
import type { Google } from "./delivery/google.js";
import type { IdleWatch } from "./idle.js";
import { buildMcpServer } from "./mcp.js";
import { SandboxFs, cleanEnv, type Sandbox } from "./sandbox.js";
import { Settings, redact, type JsonFile } from "./settings.js";

export interface ServerDeps {
  cfg: AgentConfig;
  control: ControlLink;
  bot: BotRunner;
  idle: IdleWatch;
  google: Google;
  delivery: Delivery;
  settings: JsonFile<Settings>;
  activity: ActivityLog;
  accounts: Accounts;
  onSettings?: (s: Settings) => void;
  joinMeeting: (id: string) => Promise<void>;
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function cookie(req: FastifyRequest, name: string): string | null {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(/;\s*/)) {
    const [k, ...v] = part.split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function bearerOf(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  const q = (req.query as Record<string, string | undefined>)?.token;
  return q ?? null;
}

export async function buildServer(d: ServerDeps) {
  const { cfg, control, bot, idle } = d;
  // Small default body limit; only the authenticated upload routes raise it.
  const app = Fastify({ logger: { level: "warn" }, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  await app.register(websocket);
  app.addContentTypeParser(["application/octet-stream", "image/jpeg", "image/png"], { parseAs: "buffer" }, (_r, body, done) =>
    done(null, body),
  );

  // CORS: the website (GitHub Pages) and the app call us with bearer tokens, never cookies.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "authorization, content-type, mcp-session-id, mcp-protocol-version");
    reply.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    reply.header("access-control-expose-headers", "mcp-session-id");
    if (req.method === "OPTIONS") return reply.code(204).send();
  });

  const authOf = async (req: FastifyRequest, token?: string | null): Promise<AuthResult> => control.auth(token ?? bearerOf(req));
  /** Route-level auth. Used as an onRequest hook, so it runs before any request body is read. */
  const guard = (scope: TokenScope) => async (req: FastifyRequest, reply: FastifyReply) => {
    const a = await authOf(req);
    if (!a) return reply.code(401).send({ error: "Missing or invalid token" });
    if (!hasScope(a, scope)) return reply.code(403).send({ error: `Token lacks scope "${scope}"` });
    idle.touch();
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: z.prettifyError(err) });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      console.error(err);
      return reply.code(500).send({ error: "Internal error" }); // no internals to the client
    }
    return reply.code(status >= 400 ? status : 500).send({ error: (err as Error).message });
  });

  /* ------------------------------------------------------------ public */
  app.get("/health", async () => ({ ok: true, phase: bot.state.phase }));

  /* ------------------------------------------------------------ live desktop (KasmVNC behind Caddy :8443) */
  // The desktop gives full mouse and keyboard control of the signed-in Chrome, so it needs the
  // "owner" scope. The cookie holds a random session id (8 h), never the account token itself.
  const desktopSessions = new Map<string, { tokenId: string | null; expires: number }>();
  app.get("/auth/desktop", async (req, reply) => {
    const sid = cookie(req, "cp_desktop");
    const sess = sid ? desktopSessions.get(sid) : undefined;
    if (!sess || sess.expires < Date.now() || (sess.tokenId && control.isRevoked(sess.tokenId))) {
      if (sid) desktopSessions.delete(sid);
      return reply.code(401).send("Open the live desktop from the CloudPilot app.");
    }
    idle.touch();
    return reply.code(200).send("ok");
  });
  // The app asks for a one-time ticket (with its token in the header), then opens
  // /desktop/login?ticket=… so no long-lived token ends up in a URL or browser history.
  const desktopTickets = new Map<string, { tokenId: string | null; expires: number }>();
  app.post("/desktop/ticket", { onRequest: guard("owner") }, async (req) => {
    const a = await authOf(req);
    for (const [k, v] of desktopTickets) if (v.expires < Date.now()) desktopTickets.delete(k);
    const ticket = randomBytes(24).toString("base64url");
    desktopTickets.set(ticket, { tokenId: a?.kind === "scoped" ? a.claims.id : null, expires: Date.now() + 60_000 });
    return { url: `https://${cfg.fqdn}/desktop/login?ticket=${ticket}` };
  });
  app.get("/desktop/login", async (req, reply) => {
    const ticket = (req.query as { ticket?: string }).ticket ?? "";
    const t = desktopTickets.get(ticket);
    desktopTickets.delete(ticket); // single use
    if (!t || t.expires < Date.now() || (t.tokenId && control.isRevoked(t.tokenId)))
      return reply.code(401).send({ error: "This desktop link has expired. Open the live desktop from the app again." });
    for (const [k, v] of desktopSessions) if (v.expires < Date.now()) desktopSessions.delete(k);
    const sid = randomBytes(32).toString("base64url");
    desktopSessions.set(sid, { tokenId: t.tokenId, expires: Date.now() + 8 * 3600_000 });
    reply.header("set-cookie", `cp_desktop=${sid}; Domain=${cfg.fqdn}; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax`);
    reply.header("referrer-policy", "no-referrer");
    return reply.redirect(`https://${cfg.fqdn}:8443/`);
  });

  /* ------------------------------------------------------------ status */
  app.get("/status", { onRequest: guard("view") }, async () => {
    const fs = await statfs(cfg.dataDir).catch(() => null);
    return {
      bot: bot.state,
      idle: idle.status(),
      control: { lastSyncAt: control.lastSyncAt?.toISOString() ?? null, meetings: control.meetings.length },
      diskFreeGb: fs ? Math.round(((fs.bavail * fs.bsize) / 1e9) * 10) / 10 : null,
      google: await d.google.status(),
    };
  });
  app.post("/keep-on", { onRequest: guard("machine") }, async (req) => {
    const { hours } = z.object({ hours: z.number().min(0).max(12) }).parse(req.body);
    idle.keepOnUntil = Date.now() + hours * 3600_000;
    return idle.status();
  });

  /* ------------------------------------------------------------ bot */
  app.get("/bot/state", { onRequest: guard("view") }, async () => bot.state);
  app.post("/bot/command", { onRequest: guard("meetings") }, async (req) => bot.command(BotCommand.parse(req.body)));
  app.post("/bot/join", { onRequest: guard("meetings") }, async (req) => {
    const { meetingId } = z.object({ meetingId: z.string() }).parse(req.body);
    await control.sync().catch(() => undefined);
    void d.joinMeeting(meetingId);
    return { ok: true };
  });
  app.post("/bot/signin", { onRequest: guard("owner") }, async (req) => {
    const { url } = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
    await bot.openForSignIn(url);
    return { ok: true, desktop: `https://${cfg.fqdn}:8443/` };
  });
  app.get("/bot/preview.jpg", { onRequest: guard("view") }, async (_req, reply) => {
    const img = await bot.preview();
    if (!img) return reply.code(404).send({ error: "No meeting open" });
    return reply.header("content-type", "image/jpeg").header("cache-control", "no-store").send(img);
  });

  /** Phone → meeting live takeover (WebRTC signalling, non-trickle). */
  app.get("/live", { websocket: true }, async (socket, req) => {
    const a = await authOf(req);
    if (!hasScope(a, "meetings")) return socket.close(4401, "unauthorized");
    const release = idle.hold("live");
    socket.on("message", async (raw: Buffer) => {
      try {
        const msg = z
          .discriminatedUnion("type", [z.object({ type: z.literal("offer"), sdp: z.string() }), z.object({ type: z.literal("end") })])
          .parse(JSON.parse(raw.toString()));
        if (msg.type === "offer") socket.send(JSON.stringify({ type: "answer", sdp: await bot.acceptPhoneOffer(msg.sdp) }));
        else await bot.endLive();
      } catch (e) {
        socket.send(JSON.stringify({ type: "error", error: (e as Error).message }));
      }
    });
    const onState = (s: unknown) => socket.readyState === 1 && socket.send(JSON.stringify({ type: "state", state: s }));
    bot.on("state", onState);
    socket.send(JSON.stringify({ type: "state", state: bot.state }));
    socket.on("close", () => {
      bot.off("state", onState);
      void bot.endLive();
      release();
    });
  });

  /* ------------------------------------------------------------ meeting artifacts */
  const meetingsDir = join(cfg.dataDir, "meetings");
  const safeId = (id: string) => {
    if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error("bad id"), { statusCode: 400 });
    return id;
  };

  app.get("/meetings/recent", { onRequest: guard("meetings") }, async () => {
    const ids = await readdir(meetingsDir).catch(() => [] as string[]);
    const out = [];
    for (const id of ids) {
      const dir = join(meetingsDir, id);
      const shots = JSON.parse(await readFile(join(dir, "shots.json"), "utf8").catch(() => "[]")) as unknown[];
      const delivery = JSON.parse(await readFile(join(dir, "delivery.json"), "utf8").catch(() => "null")) as DeliveryReport | null;
      const rec = await stat(join(dir, "recording.mp4")).catch(() => null);
      out.push({ id, screenshots: shots.length, recordingBytes: rec?.size ?? null, delivery, modifiedAt: (await stat(dir)).mtime });
    }
    return out.sort((a, b) => +b.modifiedAt - +a.modifiedAt);
  });
  app.get("/meetings/:id/screenshots", { onRequest: guard("meetings") }, async (req) => {
    const { id } = req.params as { id: string };
    return JSON.parse(await readFile(join(meetingsDir, safeId(id), "shots.json"), "utf8").catch(() => "[]"));
  });
  app.get("/meetings/:id/files/:file", { onRequest: guard("meetings") }, async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    if (!/^[\w.-]+$/.test(file)) return reply.code(400).send({ error: "bad file" });
    return sendFile(reply, req, join(meetingsDir, safeId(id), file));
  });
  app.post("/meetings/:id/deliver", { onRequest: guard("meetings") }, async (req) => {
    const { id } = req.params as { id: string };
    const meeting = control.meetings.find((m) => m.id === id);
    if (!meeting) throw Object.assign(new Error("Meeting not in the current schedule"), { statusCode: 404 });
    const dir = join(meetingsDir, safeId(id));
    const shots = JSON.parse(await readFile(join(dir, "shots.json"), "utf8").catch(() => "[]"));
    const rec = join(dir, "recording.mp4");
    return d.delivery.deliver({
      meeting,
      dir,
      shots,
      recording: (await stat(rec).catch(() => null)) ? rec : null,
      outcome: "done",
      note: null,
    });
  });

  /* ------------------------------------------------------------ settings & integrations */
  app.get("/settings", { onRequest: guard("owner") }, async () => redact(await d.settings.read()));
  app.put("/settings", { onRequest: guard("owner") }, async (req) => {
    const cur = await d.settings.read();
    const patch = Settings.partial().parse(req.body);
    // Keep secrets when the client sends back the redacted placeholder.
    if (patch.google?.clientSecret === "••••" && cur.google) patch.google.clientSecret = cur.google.clientSecret;
    if (patch.smtp?.pass === "••••" && cur.smtp) patch.smtp.pass = cur.smtp.pass;
    const next = Settings.parse({ ...cur, ...patch });
    await d.settings.write(next);
    d.onSettings?.(next);
    return redact(next);
  });
  app.post("/settings/static-image", { onRequest: guard("owner"), bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length < 100) throw Object.assign(new Error("Send image bytes"), { statusCode: 400 });
    const ext = req.headers["content-type"] === "image/png" ? ".png" : ".jpg";
    const file = join(cfg.dataDir, `presence${ext}`);
    await writeFile(file, buf);
    const cur = await d.settings.read();
    await d.settings.write({ ...cur, staticImageFile: file });
    return { ok: true };
  });
  app.post("/push/register", { onRequest: guard("meetings") }, async (req) => {
    const { token } = z.object({ token: z.string().startsWith("ExponentPushToken[") }).parse(req.body);
    const cur = await d.settings.read();
    if (!cur.pushTokens.includes(token)) await d.settings.write({ ...cur, pushTokens: [...cur.pushTokens, token].slice(-5) });
    return { ok: true };
  });

  const oauthStates = new Map<string, number>();
  app.get("/google/status", { onRequest: guard("owner") }, async () => d.google.status());
  app.post("/google/connect", { onRequest: guard("owner") }, async () => {
    const state = crypto.randomUUID();
    oauthStates.set(state, Date.now());
    return { url: await d.google.authUrl(state) };
  });
  app.get("/google/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const t = q.state ? oauthStates.get(q.state) : undefined;
    if (!t || Date.now() - t > 10 * 60_000) return reply.code(400).type("text/html").send(page("Link expired — start again from the app."));
    oauthStates.delete(q.state!);
    if (q.error || !q.code) return reply.code(400).type("text/html").send(page(`Google said: ${q.error ?? "no code"}`));
    await d.google.handleCallback(q.code);
    return reply.type("text/html").send(page("Google connected ✅ You can close this tab."));
  });
  app.post("/google/disconnect", { onRequest: guard("owner") }, async () => {
    await d.google.disconnect();
    return { ok: true };
  });

  /* ------------------------------------------------------------ files */
  // Everything here runs as the unprivileged sandbox user, so a link with the "files"
  // scope can't reach the agent's secrets, the Chrome sign-ins or /data.
  const sandbox: Sandbox = { user: cfg.aiUser, home: cfg.aiHome };
  const sfs = new SandboxFs(sandbox);
  app.get("/files", { onRequest: guard("files") }, async (req, reply) => {
    const p = sfs.resolve((req.query as { path?: string }).path ?? sandbox.home);
    const s = await sfs.stat(p);
    if (s.type === "dir") return sfs.list(p);
    if (s.type !== "file") return reply.code(400).send({ error: "Not a file" });
    const name = posix.basename(p).replace(/["\\\r\n]/g, "_");
    reply.header("content-type", "application/octet-stream").header("content-length", s.size);
    reply.header("content-disposition", `attachment; filename="${name}"`).header("x-content-type-options", "nosniff");
    return reply.send(sfs.stream(p));
  });
  app.put("/files", { onRequest: guard("files"), bodyLimit: 512 * 1024 * 1024 }, async (req) => {
    const p = sfs.resolve((req.query as { path?: string }).path ?? "");
    await sfs.write(p, req.body as Buffer);
    return { ok: true, path: p };
  });
  app.delete("/files", { onRequest: guard("files") }, async (req) => {
    await sfs.remove(sfs.resolve((req.query as { path?: string }).path ?? ""));
    return { ok: true };
  });

  /* ------------------------------------------------------------ terminal */
  app.get("/terminal", { websocket: true }, async (socket, req) => {
    const a = await authOf(req);
    if (!hasScope(a, "terminal")) return socket.close(4401, "unauthorized");
    const pty = await import("node-pty");
    const release = idle.hold("terminal");
    // Your own devices get the admin shell; AI and shared links get the sandbox user.
    // Neither inherits the agent's environment (which holds the signing key).
    const asOwner = hasScope(a, "owner") || !sandbox.user;
    const home = asOwner ? cfg.home : sandbox.home;
    const [file, args]: [string, string[]] = asOwner
      ? ["bash", ["-l"]]
      : ["sudo", ["-n", "-u", sandbox.user, "-H", "--preserve-env=TERM", "--", "bash", "-lc", "cd ~ && exec bash -l"]];
    const sh = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: asOwner ? home : "/",
      env: cleanEnv(home, { TERM: "xterm-256color" }),
    });
    sh.onData((data) => socket.readyState === 1 && socket.send(data));
    sh.onExit(() => socket.close());
    socket.on("message", (raw: Buffer) => {
      idle.touch();
      try {
        const m = JSON.parse(raw.toString()) as { t: "i"; d: string } | { t: "r"; c: number; r: number };
        if (m.t === "i") sh.write(m.d);
        else if (m.t === "r") sh.resize(Math.max(10, m.c), Math.max(5, m.r));
      } catch {
        sh.write(raw.toString());
      }
    });
    socket.on("close", () => {
      sh.kill();
      release();
    });
  });

  /* ------------------------------------------------------------ meeting accounts (Teams / Zoom / Google) */
  app.get("/accounts", { onRequest: guard("meetings") }, async () => d.accounts.list());
  app.post("/accounts/:platform/check", { onRequest: guard("meetings") }, async (req) =>
    d.accounts.check(AccountPlatform.parse((req.params as { platform: string }).platform)),
  );
  app.post("/accounts/:platform/signin", { onRequest: guard("owner") }, async (req) => {
    await d.accounts.signIn(AccountPlatform.parse((req.params as { platform: string }).platform));
    return { ok: true };
  });
  app.post("/accounts/:platform/signout", { onRequest: guard("owner") }, async (req) => {
    await d.accounts.signOut(AccountPlatform.parse((req.params as { platform: string }).platform));
    return { ok: true };
  });

  /* ------------------------------------------------------------ type into the desktop from the phone */
  const x11 = new X11(cfg.display);
  const KEYS = ["Return", "Tab", "BackSpace", "Escape", "ctrl+a", "ctrl+v", "ctrl+l", "F5", "Up", "Down", "Left", "Right"] as const;
  app.post("/desktop/type", { onRequest: guard("owner") }, async (req) => {
    // Text is typed once into whatever field has focus and is never stored or logged.
    const { text, enter } = z.object({ text: z.string().max(2000), enter: z.boolean().default(false) }).parse(req.body);
    idle.touch();
    if (text) await x11.type(text);
    if (enter) await x11.key("Return");
    return { ok: true };
  });
  app.post("/desktop/key", { onRequest: guard("owner") }, async (req) => {
    const { key } = z.object({ key: z.enum(KEYS) }).parse(req.body);
    idle.touch();
    await x11.key(key);
    return { ok: true };
  });

  /* ------------------------------------------------------------ AI activity: watch & control */
  app.get("/activity", { onRequest: guard("view") }, async () => ({
    entries: d.activity.list(),
    pausedUntil: d.activity.paused ? new Date(d.activity.pausedUntil).toISOString() : null,
  }));
  app.get("/activity/stream", { websocket: true }, async (socket, req) => {
    if (!hasScope(await authOf(req), "view")) return socket.close(4401, "unauthorized");
    const on = (ev: unknown) => socket.readyState === 1 && socket.send(JSON.stringify(ev));
    d.activity.on("event", on);
    socket.on("close", () => d.activity.off("event", on));
  });
  app.post("/activity/:id/kill", { onRequest: guard("owner") }, async (req) => ({ killed: d.activity.kill((req.params as { id: string }).id) }));
  app.post("/ai/pause", { onRequest: guard("owner") }, async (req) => {
    const { minutes } = z.object({ minutes: z.number().min(0).max(24 * 60) }).parse(req.body);
    d.activity.pause(minutes);
    return { pausedUntil: d.activity.paused ? new Date(d.activity.pausedUntil).toISOString() : null };
  });

  /* ------------------------------------------------------------ MCP (for Claude & other AI clients) */
  const mcpHandler = async (req: FastifyRequest, reply: FastifyReply, token: string | null) => {
    const a = await authOf(req, token);
    if (!hasScope(a, "mcp")) return reply.code(401).send({ error: "MCP token required" });
    idle.touch();
    const actor =
      a?.kind === "scoped"
        ? { id: a.claims.id, label: control.labels.get(a.claims.id) ?? `Link ${a.claims.id}` }
        : { id: "owner", label: "Owner key" };
    const server = buildMcpServer({ sandbox, fqdn: cfg.fqdn, onActivity: () => idle.touch(), activity: d.activity, actor });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };
  // Header auth (Claude Code: --header "Authorization: Bearer …") or token-in-path for clients that can't set headers.
  app.route({ method: ["GET", "POST", "DELETE"], url: "/mcp", handler: (req, reply) => mcpHandler(req, reply, bearerOf(req)) });
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/:token",
    handler: (req, reply) => mcpHandler(req, reply, (req.params as { token: string }).token),
  });

  return app;
}

/** Serve a file with HTTP Range support (so recordings stream/seek in the app). */
async function sendFile(reply: FastifyReply, req: FastifyRequest, path: string, download = false) {
  const s = await stat(path).catch(() => null);
  if (!s?.isFile()) return reply.code(404).send({ error: "Not found" });
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  reply.header("content-type", type).header("accept-ranges", "bytes");
  if (download) reply.header("content-disposition", `attachment; filename="${path.split(/[\\/]/).pop()}"`);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), s.size - 1) : s.size - 1;
    if (start > end || start >= s.size) return reply.code(416).header("content-range", `bytes */${s.size}`).send();
    reply.code(206).header("content-range", `bytes ${start}-${end}/${s.size}`).header("content-length", end - start + 1);
    return reply.send(createReadStream(path, { start, end }));
  }
  reply.header("content-length", s.size);
  return reply.send(createReadStream(path));
}

const page = (msg: string) =>
  `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>CloudPilot</title>` +
  `<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;background:#0b1020;color:#e7e9f3"><p>${msg.replace(/</g, "&lt;")}</p>`;
