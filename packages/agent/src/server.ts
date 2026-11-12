import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import websocket from "@fastify/websocket";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BotCommand, hasScope, type AuthResult, type TokenScope } from "@cloudpilot/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActivityLog } from "./activity.js";
import type { BotRunner } from "./bot/runner.js";
import type { AgentConfig } from "./config.js";
import type { ControlLink } from "./control.js";
import type { Delivery, DeliveryReport } from "./delivery/pipeline.js";
import type { Google } from "./delivery/google.js";
import type { IdleWatch } from "./idle.js";
import { buildMcpServer } from "./mcp.js";
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
  const app = Fastify({ logger: { level: "warn" }, bodyLimit: 512 * 1024 * 1024, trustProxy: true });
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
  const guard = (scope: TokenScope) => async (req: FastifyRequest, reply: FastifyReply) => {
    const a = await authOf(req);
    if (!a) return reply.code(401).send({ error: "Missing or invalid token" });
    if (!hasScope(a, scope)) return reply.code(403).send({ error: `Token lacks scope "${scope}"` });
    idle.touch();
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: z.prettifyError(err) });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) console.error(err);
    return reply.code(status >= 400 ? status : 500).send({ error: (err as Error).message });
  });

  /* ------------------------------------------------------------ public */
  app.get("/health", async () => ({ ok: true, phase: bot.state.phase }));

  /* ------------------------------------------------------------ live desktop (KasmVNC behind Caddy :8443) */
  app.get("/auth/desktop", async (req, reply) => {
    const a = await authOf(req, cookie(req, "cp_desktop"));
    if (!hasScope(a, "view")) return reply.code(401).send("Open the live desktop from the CloudPilot app.");
    idle.touch();
    return reply.code(200).send("ok");
  });
  app.get("/desktop/login", async (req, reply) => {
    const token = bearerOf(req);
    if (!hasScope(await authOf(req, token), "view")) return reply.code(401).send({ error: "Invalid token" });
    reply.header(
      "set-cookie",
      `cp_desktop=${encodeURIComponent(token!)}; Domain=${cfg.fqdn}; Path=/; Max-Age=43200; Secure; HttpOnly; SameSite=Lax`,
    );
    return reply.redirect(`https://${cfg.fqdn}:8443/`);
  });

  /* ------------------------------------------------------------ status */
  app.get("/status", { preHandler: guard("view") }, async () => {
    const fs = await statfs(cfg.dataDir).catch(() => null);
    return {
      bot: bot.state,
      idle: idle.status(),
      control: { lastSyncAt: control.lastSyncAt?.toISOString() ?? null, meetings: control.meetings.length },
      diskFreeGb: fs ? Math.round(((fs.bavail * fs.bsize) / 1e9) * 10) / 10 : null,
      google: await d.google.status(),
    };
  });
  app.post("/keep-on", { preHandler: guard("machine") }, async (req) => {
    const { hours } = z.object({ hours: z.number().min(0).max(12) }).parse(req.body);
    idle.keepOnUntil = Date.now() + hours * 3600_000;
    return idle.status();
  });

  /* ------------------------------------------------------------ bot */
  app.get("/bot/state", { preHandler: guard("view") }, async () => bot.state);
  app.post("/bot/command", { preHandler: guard("meetings") }, async (req) => bot.command(BotCommand.parse(req.body)));
  app.post("/bot/join", { preHandler: guard("meetings") }, async (req) => {
    const { meetingId } = z.object({ meetingId: z.string() }).parse(req.body);
    await control.sync().catch(() => undefined);
    void d.joinMeeting(meetingId);
    return { ok: true };
  });
  app.post("/bot/signin", { preHandler: guard("owner") }, async (req) => {
    const { url } = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
    await bot.openForSignIn(url);
    return { ok: true, desktop: `https://${cfg.fqdn}:8443/` };
  });
  app.get("/bot/preview.jpg", { preHandler: guard("view") }, async (_req, reply) => {
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

  app.get("/meetings/recent", { preHandler: guard("meetings") }, async () => {
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
  app.get("/meetings/:id/screenshots", { preHandler: guard("meetings") }, async (req) => {
    const { id } = req.params as { id: string };
    return JSON.parse(await readFile(join(meetingsDir, safeId(id), "shots.json"), "utf8").catch(() => "[]"));
  });
  app.get("/meetings/:id/files/:file", { preHandler: guard("meetings") }, async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    if (!/^[\w.-]+$/.test(file)) return reply.code(400).send({ error: "bad file" });
    return sendFile(reply, req, join(meetingsDir, safeId(id), file));
  });
  app.post("/meetings/:id/deliver", { preHandler: guard("meetings") }, async (req) => {
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
  app.get("/settings", { preHandler: guard("owner") }, async () => redact(await d.settings.read()));
  app.put("/settings", { preHandler: guard("owner") }, async (req) => {
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
  app.post("/settings/static-image", { preHandler: guard("owner") }, async (req) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length < 100) throw Object.assign(new Error("Send image bytes"), { statusCode: 400 });
    const ext = req.headers["content-type"] === "image/png" ? ".png" : ".jpg";
    const file = join(cfg.dataDir, `presence${ext}`);
    await writeFile(file, buf);
    const cur = await d.settings.read();
    await d.settings.write({ ...cur, staticImageFile: file });
    return { ok: true };
  });
  app.post("/push/register", { preHandler: guard("meetings") }, async (req) => {
    const { token } = z.object({ token: z.string().startsWith("ExponentPushToken[") }).parse(req.body);
    const cur = await d.settings.read();
    if (!cur.pushTokens.includes(token)) await d.settings.write({ ...cur, pushTokens: [...cur.pushTokens, token].slice(-5) });
    return { ok: true };
  });

  const oauthStates = new Map<string, number>();
  app.get("/google/status", { preHandler: guard("owner") }, async () => d.google.status());
  app.post("/google/connect", { preHandler: guard("owner") }, async () => {
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
  app.post("/google/disconnect", { preHandler: guard("owner") }, async () => {
    await d.google.disconnect();
    return { ok: true };
  });

  /* ------------------------------------------------------------ files */
  const roots = [cfg.home, cfg.dataDir];
  const resolvePath = (p: string) => {
    const full = normalize(isAbsolute(p) ? p : resolve(cfg.home, p));
    if (!roots.some((r) => full === r || full.startsWith(r + "/") || full.startsWith(r + "\\")))
      throw Object.assign(new Error("Path outside allowed roots"), { statusCode: 403 });
    return full;
  };
  app.get("/files", { preHandler: guard("files") }, async (req, reply) => {
    const p = resolvePath((req.query as { path?: string }).path ?? cfg.home);
    const s = await stat(p);
    if (!s.isDirectory()) return sendFile(reply, req, p, true);
    const entries = await readdir(p, { withFileTypes: true });
    return Promise.all(
      entries.map(async (e) => {
        const st = await stat(join(p, e.name)).catch(() => null);
        return { name: e.name, dir: e.isDirectory(), size: st?.size ?? 0, modifiedAt: st?.mtime ?? null };
      }),
    );
  });
  app.put("/files", { preHandler: guard("files") }, async (req) => {
    const p = resolvePath((req.query as { path?: string }).path ?? "");
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, req.body as Buffer);
    return { ok: true, path: p };
  });
  app.delete("/files", { preHandler: guard("files") }, async (req) => {
    const p = resolvePath((req.query as { path?: string }).path ?? "");
    if (roots.includes(p)) throw Object.assign(new Error("Refusing to delete a root"), { statusCode: 400 });
    await rm(p, { recursive: true, force: true });
    return { ok: true };
  });

  /* ------------------------------------------------------------ terminal */
  app.get("/terminal", { websocket: true }, async (socket, req) => {
    const a = await authOf(req);
    if (!hasScope(a, "terminal")) return socket.close(4401, "unauthorized");
    const pty = await import("node-pty");
    const release = idle.hold("terminal");
    const sh = pty.spawn("bash", ["-l"], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: cfg.home,
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
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

  /* ------------------------------------------------------------ AI activity: watch & control */
  app.get("/activity", { preHandler: guard("view") }, async () => ({
    entries: d.activity.list(),
    pausedUntil: d.activity.paused ? new Date(d.activity.pausedUntil).toISOString() : null,
  }));
  app.get("/activity/stream", { websocket: true }, async (socket, req) => {
    if (!hasScope(await authOf(req), "view")) return socket.close(4401, "unauthorized");
    const on = (ev: unknown) => socket.readyState === 1 && socket.send(JSON.stringify(ev));
    d.activity.on("event", on);
    socket.on("close", () => d.activity.off("event", on));
  });
  app.post("/activity/:id/kill", { preHandler: guard("owner") }, async (req) => ({ killed: d.activity.kill((req.params as { id: string }).id) }));
  app.post("/ai/pause", { preHandler: guard("owner") }, async (req) => {
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
    const server = buildMcpServer({ home: cfg.home, fqdn: cfg.fqdn, onActivity: () => idle.touch(), activity: d.activity, actor });
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
