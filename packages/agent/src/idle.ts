import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Tracks activity (API calls, terminal/MCP sessions, meetings, CPU load) and
 * deallocates the VM through its managed identity once idle for long enough.
 */
export class IdleWatch {
  private lastActivity = Date.now();
  private holds = new Map<string, number>(); // reason → count
  private timer: NodeJS.Timeout | null = null;
  /** Epoch ms until which the user asked to keep the machine on. */
  keepOnUntil = 0;

  constructor(
    public idleMinutes: number,
    private readonly onIdle: () => Promise<void> = deallocateSelf,
    private readonly loadAvg: () => Promise<number> = currentLoad,
  ) {}

  touch() {
    this.lastActivity = Date.now();
  }

  /** Prevent idling while something is running (e.g. a meeting, a terminal). Returns a release fn. */
  hold(reason: string): () => void {
    this.holds.set(reason, (this.holds.get(reason) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.holds.get(reason) ?? 1) - 1;
      if (n <= 0) this.holds.delete(reason);
      else this.holds.set(reason, n);
      this.touch();
    };
  }

  status() {
    const idleMs = Date.now() - this.lastActivity;
    return {
      idleMinutes: Math.floor(idleMs / 60_000),
      shutdownInMinutes: this.idleMinutes > 0 ? Math.max(0, this.idleMinutes - Math.floor(idleMs / 60_000)) : null,
      holds: Object.fromEntries(this.holds),
      keepOnUntil: this.keepOnUntil ? new Date(this.keepOnUntil).toISOString() : null,
    };
  }

  /** Exposed for tests. */
  async check(now = Date.now()): Promise<boolean> {
    if (this.idleMinutes <= 0 || this.holds.size > 0 || now < this.keepOnUntil) return false;
    // Busy compiles/tests count as activity even with nobody connected.
    if ((await this.loadAvg()) > 0.6) {
      this.lastActivity = now;
      return false;
    }
    if (now - this.lastActivity < this.idleMinutes * 60_000) return false;
    await this.onIdle();
    return true;
  }

  start() {
    this.timer = setInterval(() => void this.check().catch((e) => console.error("idle check", e)), 60_000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

async function currentLoad(): Promise<number> {
  const { loadavg, cpus } = await import("node:os");
  return loadavg()[0]! / Math.max(1, cpus().length);
}

/** Deallocate this VM using the instance metadata service + managed identity. */
export async function deallocateSelf(): Promise<void> {
  const imds = "http://169.254.169.254/metadata";
  const h = { Metadata: "true" };
  const tok = (await (
    await fetch(`${imds}/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/`, {
      headers: h,
    })
  ).json()) as { access_token: string };
  const inst = (await (await fetch(`${imds}/instance/compute?api-version=2021-02-01`, { headers: h })).json()) as {
    resourceId: string;
  };
  console.log("Idle: deallocating", inst.resourceId);
  // Flush disks before the platform stops us.
  await exec("sync").catch(() => undefined);
  const res = await fetch(`https://management.azure.com${inst.resourceId}/deallocate?api-version=2024-07-01`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  if (!res.ok && res.status !== 202) throw new Error(`deallocate failed: ${res.status} ${await res.text()}`);
}
