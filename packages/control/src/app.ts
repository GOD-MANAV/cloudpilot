import {
  CreateTokenInput,
  Meeting,
  MeetingInput,
  PUBLIC_IP_USD_PER_HOUR,
  VM_SIZES,
  VmSize,
  authenticate,
  detectPlatform,
  hasScope,
  newId,
  parseIcs,
  sha256Hex,
  safeEqual,
  signToken,
  verifyTotp,
  type AccessTokenInfo,
  type AuthResult,
  type TokenScope,
  type UsageSummary,
  type VmStatus,
} from "@cloudpilot/shared";
import { z } from "zod";
import type { VmController } from "./azure.js";
import type { Store } from "./store.js";

export interface AppDeps {
  store: Store;
  vm: VmController;
  ownerTokenSha256: string;
  signingKey: string;
  /** Base32 TOTP secret; when set, device login requires a 6-digit authenticator code. */
  totpSecret?: string;
  budgetUsd: number;
  prejoinMinutes: number;
  now?: () => Date;
  fetch?: typeof fetch;
  /** Probe https://<fqdn>/health. */
  probeAgent?: (fqdn: string) => Promise<boolean>;
}

export interface Req {
  method: string;
  path: string; // without /api prefix, e.g. "/vm/status"
  headers: Record<string, string | undefined>;
  body?: unknown;
}
export interface Res {
  status: number;
  body?: unknown;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Meetings the VM should be on for, right now. */
export function dueMeetings(meetings: Meeting[], now: Date, prejoinMinutes: number): Meeting[] {
  const t = now.getTime();
  return meetings.filter((m) => {
    if (m.status === "cancelled" || m.status === "done" || m.status === "failed") return false;
    if (m.joinNowAt && t - Date.parse(m.joinNowAt) < 15 * 60_000) return true;
    if (!m.autoJoin) return false;
    const start = Date.parse(m.startAt) - prejoinMinutes * 60_000;
    const end = Date.parse(m.endAt) + m.overrunMinutes * 60_000;
    return t >= start && t < end;
  });
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const { store, vm } = deps;

  async function revokedIds(): Promise<Set<string>> {
    return new Set((await store.listTokens()).filter((t) => t.revoked).map((t) => t.id));
  }

  async function auth(req: Req): Promise<AuthResult> {
    const h = req.headers["authorization"] ?? req.headers["Authorization"];
    const bearer = h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
    const revoked = bearer?.startsWith("cpt_") ? await revokedIds() : new Set<string>();
    const a = await authenticate(bearer, deps.ownerTokenSha256, deps.signingKey, (id) => revoked.has(id));
    if (a?.kind === "scoped") {
      // best-effort lastUsedAt
      const t = (await store.listTokens()).find((x) => x.id === a.claims.id);
      if (t) await store.putToken({ ...t, lastUsedAt: now().toISOString() });
    }
    return a;
  }

  function need(a: AuthResult, scope: TokenScope) {
    if (!a) throw new HttpError(401, "Missing or invalid token");
    if (!hasScope(a, scope)) throw new HttpError(403, `Token lacks scope "${scope}"`);
  }

  async function fullStatus(): Promise<VmStatus> {
    const s = await vm.status();
    let agentHealthy = false;
    if (s.power === "running" && s.fqdn && deps.probeAgent) agentHealthy = await deps.probeAgent(s.fqdn);
    return { ...s, agentHealthy };
  }

  async function usage(): Promise<UsageSummary> {
    const d = now();
    const u = await store.getUsage(monthOf(d));
    const dayOfMonth = d.getUTCDate() + d.getUTCHours() / 24;
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return {
      monthToDateHours: round(u.hours),
      monthToDateUsd: round(u.usd),
      budgetUsd: deps.budgetUsd,
      projectedUsd: round((u.usd / Math.max(dayOfMonth, 1)) * daysInMonth),
    };
  }

  async function overBudget(): Promise<boolean> {
    const d = now();
    const u = await store.getUsage(monthOf(d));
    const override = await store.getFlag("budget-override");
    return deps.budgetUsd > 0 && u.usd >= deps.budgetUsd && override !== monthOf(d);
  }

  async function startVm(): Promise<VmStatus> {
    if (await overBudget()) throw new HttpError(402, "Monthly budget reached. Override it in Settings to start anyway.");
    const s = await vm.status();
    if (s.power !== "running" && s.power !== "starting") await vm.start();
    return { ...(await vm.status()), agentHealthy: false };
  }

  async function routes(req: Req): Promise<Res> {
    const { method, path } = req;
    const seg = path.split("/").filter(Boolean);

    if (method === "GET" && path === "/health") return { status: 200, body: { ok: true, totp: !!deps.totpSecret } };
    if (method === "POST" && path === "/auth/login") return login(req.body);

    const a = await auth(req);

    // ---------------- machine
    if (seg[0] === "vm") {
      need(a, "machine");
      if (method === "GET" && seg[1] === "status") return ok(await fullStatus());
      if (method === "POST" && seg[1] === "start") return ok(await startVm());
      if (method === "POST" && seg[1] === "stop") {
        await vm.deallocate();
        return ok({ ...(await vm.status()), agentHealthy: false });
      }
      if (method === "POST" && seg[1] === "resize") {
        const { size } = z.object({ size: VmSize }).parse(req.body);
        const s = await vm.status();
        if (s.power !== "deallocated" && s.power !== "stopped")
          throw new HttpError(409, "Stop the machine before changing its size.");
        await vm.resize(size);
        return ok({ ...(await vm.status()), agentHealthy: false });
      }
    }
    if (method === "GET" && path === "/usage") {
      need(a, "machine");
      return ok(await usage());
    }
    if (method === "POST" && path === "/budget/override") {
      need(a, "owner");
      await store.setFlag("budget-override", monthOf(now()));
      return { status: 204 };
    }

    // ---------------- meetings
    if (seg[0] === "meetings") {
      need(a, "meetings");
      if (method === "GET" && seg.length === 1) {
        const list = await store.listMeetings();
        return ok(list.sort((x, y) => x.startAt.localeCompare(y.startAt)));
      }
      if (method === "POST" && seg.length === 1) {
        const input = MeetingInput.parse(req.body);
        if (Date.parse(input.endAt) <= Date.parse(input.startAt)) throw new HttpError(400, "endAt must be after startAt");
        const m: Meeting = Meeting.parse({
          ...input,
          id: newId("mtg"),
          platform: detectPlatform(input.url),
          status: "scheduled",
          createdAt: now().toISOString(),
          source: "manual",
        });
        await store.putMeeting(m);
        return { status: 201, body: m };
      }
      if (method === "POST" && seg[1] === "import-ics") {
        const { icsUrl } = z.object({ icsUrl: z.string().url() }).parse(req.body);
        return ok(await importIcs(icsUrl));
      }
      const id = seg[1];
      if (!id) throw new HttpError(404, "Not found");
      const existing = await store.getMeeting(id);
      if (!existing) throw new HttpError(404, "Meeting not found");
      if (method === "PATCH" && seg.length === 2) {
        const patch = MeetingInput.partial()
          .extend({ status: Meeting.shape.status.optional(), note: z.string().nullable().optional() })
          .parse(req.body);
        const merged = Meeting.parse({ ...existing, ...stripUndefined(patch) });
        merged.platform = detectPlatform(merged.url);
        await store.putMeeting(merged);
        return ok(merged);
      }
      if (method === "DELETE" && seg.length === 2) {
        await store.deleteMeeting(id);
        return { status: 204 };
      }
      if (method === "POST" && seg[2] === "join-now") {
        const m = { ...existing, joinNowAt: now().toISOString(), status: "scheduled" as const };
        await store.putMeeting(m);
        await startVm();
        return ok(m);
      }
    }

    // ---------------- tokens
    if (seg[0] === "tokens") {
      need(a, "owner");
      if (method === "GET" && seg.length === 1)
        return ok((await store.listTokens()).sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
      if (method === "POST" && seg.length === 1) {
        const input = CreateTokenInput.parse(req.body);
        const created = now();
        const expires = new Date(created.getTime() + input.ttlHours * 3600_000);
        const info: AccessTokenInfo = {
          id: newId(),
          label: input.label,
          scopes: input.scopes,
          createdAt: created.toISOString(),
          expiresAt: expires.toISOString(),
          lastUsedAt: null,
          revoked: false,
        };
        const token = await signToken(deps.signingKey, {
          id: info.id,
          expiresAt: Math.floor(expires.getTime() / 1000),
          scopes: info.scopes,
        });
        await store.putToken(info);
        return { status: 201, body: { info, token } };
      }
      if (method === "DELETE" && seg[1]) {
        const t = (await store.listTokens()).find((x) => x.id === seg[1]);
        if (!t) throw new HttpError(404, "Token not found");
        await store.putToken({ ...t, revoked: true });
        return { status: 204 };
      }
    }

    // ---------------- agent sync (the VM polls this)
    if (method === "GET" && path === "/agent/sync") {
      need(a, "meetings");
      const t = now().getTime();
      const meetings = (await store.listMeetings()).filter(
        (m) => Date.parse(m.endAt) + m.overrunMinutes * 60_000 > t && Date.parse(m.startAt) - t < 24 * 3600_000,
      );
      return ok({
        meetings,
        due: dueMeetings(meetings, now(), 1).map((m) => m.id),
        revoked: [...(await revokedIds())],
        tokenLabels: Object.fromEntries((await store.listTokens()).map((t) => [t.id, t.label])),
        serverTime: now().toISOString(),
      });
    }

    throw new HttpError(404, "Not found");
  }

  /** Owner key + authenticator code → revocable device session token. */
  async function login(body: unknown): Promise<Res> {
    const input = z
      .object({
        ownerToken: z.string().min(8).max(200),
        code: z.string().max(10).default(""),
        deviceName: z.string().min(1).max(60),
        kind: z.enum(["phone", "web"]),
      })
      .parse(body);
    const lockUntil = Number((await store.getFlag("login-lock")) ?? 0);
    if (now().getTime() < lockUntil) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    const keyOk = safeEqual(await sha256Hex(input.ownerToken), deps.ownerTokenSha256.toLowerCase());
    const codeOk = !deps.totpSecret || (await verifyTotp(deps.totpSecret, input.code, now().getTime()));
    if (!keyOk || !codeOk) {
      const fails = Number((await store.getFlag("login-fails")) ?? 0) + 1;
      await store.setFlag("login-fails", String(fails));
      if (fails >= 5) {
        await store.setFlag("login-lock", String(now().getTime() + 15 * 60_000));
        await store.setFlag("login-fails", "0");
      }
      throw new HttpError(401, keyOk ? "Wrong authenticator code" : "Wrong owner key");
    }
    await store.setFlag("login-fails", "0");
    const created = now();
    const ttlHours = input.kind === "phone" ? 24 * 30 : 12;
    const expires = new Date(created.getTime() + ttlHours * 3600_000);
    const info: AccessTokenInfo = {
      id: newId("dev"),
      label: `${input.kind === "phone" ? "Phone" : "Browser"} · ${input.deviceName}`,
      scopes: ["owner"],
      createdAt: created.toISOString(),
      expiresAt: expires.toISOString(),
      lastUsedAt: null,
      revoked: false,
    };
    const token = await signToken(deps.signingKey, { id: info.id, expiresAt: Math.floor(expires.getTime() / 1000), scopes: ["owner"] });
    await store.putToken(info);
    return { status: 201, body: { info, token } };
  }

  async function importIcs(icsUrl: string): Promise<Meeting[]> {
    const f = deps.fetch ?? fetch;
    const res = await f(icsUrl);
    if (!res.ok) throw new HttpError(400, `Couldn't fetch calendar (${res.status})`);
    const events = parseIcs(await res.text());
    const t = now().getTime();
    const horizon = t + 14 * 24 * 3600_000;
    const out: Meeting[] = [];
    for (const e of events) {
      if (!e.meetingUrl || e.end.getTime() < t || e.start.getTime() > horizon) continue;
      const id = "ics_" + (await shortHash(`${e.uid}|${e.start.toISOString()}`));
      const prev = await store.getMeeting(id);
      const m = Meeting.parse({
        ...(prev ?? {}),
        title: e.title,
        url: e.meetingUrl,
        startAt: e.start.toISOString(),
        endAt: e.end.toISOString(),
        id,
        platform: detectPlatform(e.meetingUrl),
        status: prev?.status ?? "scheduled",
        createdAt: prev?.createdAt ?? now().toISOString(),
        source: "ics",
        autoJoin: prev?.autoJoin ?? false, // imported meetings are opt-in
      });
      await store.putMeeting(m);
      out.push(m);
    }
    await store.setFlag("ics-url", icsUrl);
    return out;
  }

  /**
   * Runs every 5 minutes: meter usage, release idle public IP, enforce budget,
   * and wake the VM for upcoming meetings.
   */
  async function tick(): Promise<string[]> {
    const log: string[] = [];
    const d = now();
    const s = await vm.status();

    // 1. usage metering
    const u = await store.getUsage(monthOf(d));
    if (s.power === "running" || s.power === "starting") {
      const last = u.lastSampleAt ? Date.parse(u.lastSampleAt) : d.getTime() - 5 * 60_000;
      const hours = Math.min(Math.max(0, d.getTime() - last), 10 * 60_000) / 3600_000;
      const rate = (VM_SIZES[s.size as VmSize]?.usdPerHour ?? 0.05) + PUBLIC_IP_USD_PER_HOUR;
      u.hours += hours;
      u.usd += hours * rate;
    }
    u.lastSampleAt = d.toISOString();
    await store.putUsage(u);

    // 2. release the public IP once deallocated
    if ((s.power === "deallocated" || s.power === "stopped") && s.publicIp) {
      if (await vm.releasePublicIp()) log.push("released public IP");
    }

    // 3. budget guard (never interrupts a live meeting)
    const meetings = await store.listMeetings();
    const live = meetings.some((m) => m.status === "live" || m.status === "joining");
    if (s.power === "running" && !live && (await overBudget())) {
      await vm.deallocate();
      log.push("budget reached: deallocating");
      return log;
    }

    // 4. wake for meetings
    const due = dueMeetings(meetings, d, deps.prejoinMinutes);
    if (due.length && (s.power === "deallocated" || s.power === "stopped")) {
      if (await overBudget()) log.push("meeting due but budget reached");
      else {
        await vm.start();
        log.push(`starting for ${due.map((m) => m.id).join(",")}`);
      }
    }

    // 5. refresh ICS once an hour
    const icsUrl = await store.getFlag("ics-url");
    if (icsUrl && d.getUTCMinutes() < 5) {
      try {
        await importIcs(icsUrl);
        log.push("ics refreshed");
      } catch (e) {
        log.push(`ics refresh failed: ${(e as Error).message}`);
      }
    }
    return log;
  }

  async function handle(req: Req): Promise<Res> {
    try {
      return await routes(req);
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      if (e instanceof z.ZodError) return { status: 400, body: { error: z.prettifyError(e) } };
      console.error(e);
      return { status: 500, body: { error: "Internal error" } };
    }
  }

  return { handle, tick };
}

const ok = (body: unknown): Res => ({ status: 200, body });
const round = (n: number) => Math.round(n * 100) / 100;
function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
async function shortHash(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}
