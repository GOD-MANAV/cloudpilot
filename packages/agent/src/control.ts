import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authenticate, signToken, type AuthResult, type Meeting } from "@cloudpilot/shared";
import type { AgentConfig } from "./config.js";

/**
 * Talks to the always-on control plane: pulls the meeting schedule and the
 * token revocation list, pushes meeting status.
 */
export class ControlLink {
  private revoked = new Set<string>();
  private token: { value: string; exp: number } | null = null;
  meetings: Meeting[] = [];
  /** Token id -> human label, for the activity feed. */
  labels = new Map<string, string>();
  due: string[] = [];
  lastSyncAt: Date | null = null;

  constructor(private readonly cfg: AgentConfig) {}

  private get revokedFile() {
    return join(this.cfg.dataDir, "revoked.json");
  }

  /** Load the last known revocation list, so a reboot doesn't briefly re-enable revoked links. */
  async loadRevoked() {
    try {
      const ids = JSON.parse(await readFile(this.revokedFile, "utf8")) as unknown;
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") this.revoked.add(id);
    } catch {
      /* first boot */
    }
  }

  private async selfToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    if (this.token && this.token.exp - nowSec > 300) return this.token.value;
    const exp = nowSec + 3600;
    const value = await signToken(this.cfg.signingKey, { id: "agent", expiresAt: exp, scopes: ["meetings"] });
    this.token = { value, exp };
    return value;
  }

  private async call(path: string, init: RequestInit = {}) {
    if (!this.cfg.controlUrl) throw new Error("CP_CONTROL_URL not set");
    const res = await fetch(this.cfg.controlUrl.replace(/\/$/, "") + path, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.selfToken()}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`control ${path} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  async sync() {
    const r = (await this.call("/agent/sync")) as { meetings: Meeting[]; due: string[]; revoked: string[]; tokenLabels?: Record<string, string> };
    this.labels = new Map(Object.entries(r.tokenLabels ?? {}));
    this.meetings = r.meetings;
    this.due = r.due;
    // Union with what we knew: revocation is permanent, so never drop an id.
    const before = this.revoked.size;
    this.revoked = new Set([...this.revoked, ...r.revoked]);
    if (this.revoked.size !== before) await writeFile(this.revokedFile, JSON.stringify([...this.revoked]), { mode: 0o600 }).catch(() => undefined);
    this.lastSyncAt = new Date();
    return r;
  }

  async patchMeeting(id: string, patch: Partial<Pick<Meeting, "status" | "note">>) {
    try {
      await this.call(`/meetings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (e) {
      console.warn("patchMeeting failed", e);
    }
  }

  isRevoked(id: string): boolean {
    return this.revoked.has(id);
  }

  /** Authenticate a bearer token presented to the agent. */
  auth(bearer: string | null | undefined): Promise<AuthResult> {
    // The raw owner key is only for signing in (with the authenticator code) at the control plane.
    return authenticate(bearer, this.cfg.ownerTokenSha256, this.cfg.signingKey, (id) => this.revoked.has(id), false);
  }
}
