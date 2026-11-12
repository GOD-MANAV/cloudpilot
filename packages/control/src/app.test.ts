import { sha256Hex, type VmPowerState } from "@cloudpilot/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type Req } from "./app.js";
import type { VmController } from "./azure.js";
import { MemoryStore } from "./store.js";

const OWNER = "cp_owner_token";
const KEY = "signing";

class FakeVm implements VmController {
  power: VmPowerState = "deallocated";
  size = "Standard_B2als_v2";
  ip: string | null = "1.2.3.4";
  calls: string[] = [];
  async status() {
    return {
      power: this.power,
      size: this.size,
      region: "centralindia",
      fqdn: this.ip ? "box.centralindia.cloudapp.azure.com" : null,
      publicIp: this.ip,
      since: null,
    };
  }
  async start() {
    this.calls.push("start");
    this.ip = "1.2.3.4";
    this.power = "running";
  }
  async deallocate() {
    this.calls.push("deallocate");
    this.power = "deallocated";
  }
  async releasePublicIp() {
    this.calls.push("release");
    const had = !!this.ip;
    this.ip = null;
    return had;
  }
  async resize(s: string) {
    this.calls.push(`resize:${s}`);
    this.size = s;
  }
}

let store: MemoryStore;
let vm: FakeVm;
let clock: Date;
let api: ReturnType<typeof createApp>;

const call = (method: string, path: string, body?: unknown, token: string | null = OWNER) =>
  api.handle({
    method,
    path,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } satisfies Req);

beforeEach(async () => {
  store = new MemoryStore();
  vm = new FakeVm();
  clock = new Date("2026-11-15T04:00:00Z");
  api = createApp({
    store,
    vm,
    ownerTokenSha256: await sha256Hex(OWNER),
    signingKey: KEY,
    budgetUsd: 8,
    prejoinMinutes: 8,
    now: () => clock,
  });
});

const meeting = {
  title: "Ops Mgmt",
  url: "https://meet.google.com/abc-defg-hij",
  startAt: "2026-11-15T04:30:00Z",
  endAt: "2026-11-15T06:00:00Z",
};

describe("auth", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await call("GET", "/vm/status", undefined, null)).status).toBe(401);
    expect((await call("GET", "/vm/status", undefined, "nope")).status).toBe(401);
    expect((await call("GET", "/health", undefined, null)).status).toBe(200);
  });

  it("mints scoped tokens, enforces scope and revocation", async () => {
    const r = await call("POST", "/tokens", { label: "Claude Code", scopes: ["mcp"], ttlHours: 2 });
    expect(r.status).toBe(201);
    const { token, info } = r.body as { token: string; info: { id: string } };
    expect((await call("GET", "/vm/status", undefined, token)).status).toBe(403);
    expect((await call("GET", "/tokens", undefined, token)).status).toBe(403);
    // scoped token with meetings scope can sync
    const r2 = await call("POST", "/tokens", { label: "agent", scopes: ["meetings"], ttlHours: 2 });
    const t2 = (r2.body as { token: string }).token;
    expect((await call("GET", "/agent/sync", undefined, t2)).status).toBe(200);
    await call("DELETE", `/tokens/${info.id}`);
    const sync = (await call("GET", "/agent/sync", undefined, t2)).body as { revoked: string[] };
    expect(sync.revoked).toContain(info.id);
  });
});

describe("machine", () => {
  it("starts, stops and only resizes when stopped", async () => {
    expect((await call("POST", "/vm/start")).status).toBe(200);
    expect(vm.power).toBe("running");
    expect((await call("POST", "/vm/resize", { size: "Standard_B2as_v2" })).status).toBe(409);
    await call("POST", "/vm/stop");
    expect((await call("POST", "/vm/resize", { size: "Standard_B2as_v2" })).status).toBe(200);
    expect(vm.size).toBe("Standard_B2as_v2");
    expect((await call("POST", "/vm/resize", { size: "Standard_D64s_v5" })).status).toBe(400);
  });

  it("blocks start when over budget unless overridden", async () => {
    await store.putUsage({ month: "2026-11", hours: 200, usd: 8.5, lastSampleAt: null });
    expect((await call("POST", "/vm/start")).status).toBe(402);
    expect((await call("POST", "/budget/override")).status).toBe(204);
    expect((await call("POST", "/vm/start")).status).toBe(200);
  });
});

describe("meetings + tick", () => {
  it("creates a meeting with defaults and platform detection", async () => {
    const r = await call("POST", "/meetings", meeting);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ platform: "meet", status: "scheduled", presence: "camera-off" });
    expect((await call("POST", "/meetings", { ...meeting, endAt: meeting.startAt })).status).toBe(400);
  });

  it("wakes the VM 8 minutes before an auto-join meeting, not earlier", async () => {
    await call("POST", "/meetings", meeting);
    clock = new Date("2026-11-15T04:20:00Z");
    await api.tick();
    expect(vm.calls).not.toContain("start");
    clock = new Date("2026-11-15T04:23:00Z");
    await api.tick();
    expect(vm.calls).toContain("start");
  });

  it("releases the public IP after deallocation and meters usage while running", async () => {
    await api.tick(); // deallocated with IP → release
    expect(vm.calls).toContain("release");
    vm.power = "running";
    vm.ip = "1.2.3.4";
    clock = new Date(clock.getTime() + 5 * 60_000);
    await api.tick();
    const u = await store.getUsage("2026-11");
    expect(u.hours).toBeCloseTo(5 / 60, 5);
    expect(u.usd).toBeGreaterThan(0);
  });

  it("join-now marks the meeting and starts the VM", async () => {
    const m = (await call("POST", "/meetings", { ...meeting, autoJoin: false })).body as { id: string };
    const r = await call("POST", `/meetings/${m.id}/join-now`);
    expect(r.status).toBe(200);
    expect(vm.power).toBe("running");
    const sync = (await call("GET", "/agent/sync")).body as { due: string[] };
    expect(sync.due).toContain(m.id);
  });

  it("imports meetings from an ICS feed (opt-in auto-join)", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:1",
      "SUMMARY:Lecture",
      "DTSTART:20261116T043000Z",
      "DTEND:20261116T060000Z",
      "LOCATION:https://us02web.zoom.us/j/123?pwd=x",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:2",
      "SUMMARY:No link",
      "DTSTART:20261116T043000Z",
      "DTEND:20261116T060000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    api = createApp({
      store,
      vm,
      ownerTokenSha256: await sha256Hex(OWNER),
      signingKey: KEY,
      budgetUsd: 8,
      prejoinMinutes: 8,
      now: () => clock,
      fetch: (async () => new Response(ics)) as typeof fetch,
    });
    const r = await call("POST", "/meetings/import-ics", { icsUrl: "https://calendar.example.com/x.ics" });
    expect(r.status).toBe(200);
    const list = r.body as { platform: string; autoJoin: boolean }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ platform: "zoom", autoJoin: false });
  });
});

describe("device login (owner key + authenticator code)", () => {
  const SECRET = "JBSWY3DPEHPK3PXP";
  it("issues a revocable device token only with both factors, and locks after 5 failures", async () => {
    const { totpAt } = await import("@cloudpilot/shared");
    const login = createApp({
      store,
      vm,
      ownerTokenSha256: await sha256Hex(OWNER),
      signingKey: KEY,
      totpSecret: SECRET,
      budgetUsd: 8,
      prejoinMinutes: 8,
      now: () => clock,
    });
    const code = await totpAt(SECRET, clock.getTime());
    const go = (ownerToken: string, c: string) =>
      login.handle({ method: "POST", path: "/auth/login", headers: {}, body: { ownerToken, code: c, deviceName: "Pixel", kind: "phone" } });
    expect((await go(OWNER, "000000")).status).toBe(401);
    expect((await go("cp_wrong_key", code)).status).toBe(401);
    const ok = await go(OWNER, code);
    expect(ok.status).toBe(201);
    const { token, info } = ok.body as { token: string; info: { id: string; label: string } };
    expect(info.label).toBe("Phone · Pixel");
    const st = await login.handle({ method: "GET", path: "/vm/status", headers: { authorization: `Bearer ${token}` } });
    expect(st.status).toBe(200);
    await login.handle({ method: "DELETE", path: `/tokens/${info.id}`, headers: { authorization: `Bearer ${OWNER}` } });
    expect((await login.handle({ method: "GET", path: "/vm/status", headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    for (let i = 0; i < 5; i++) await go(OWNER, "111111");
    expect((await go(OWNER, code)).status).toBe(429);
  });
});
