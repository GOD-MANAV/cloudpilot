import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { JsonFile } from "../settings.js";

/**
 * Google Drive + Gmail via plain REST (no 100 MB googleapis dependency).
 * Uses YOUR OAuth client (Settings → Google). Scopes:
 *   drive.file  — only files CloudPilot creates (non-sensitive)
 *   gmail.send  — send-only, cannot read your mail
 * Set the OAuth consent screen to "In production" so refresh tokens don't expire after 7 days.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.send",
];

const Creds = z.object({
  refreshToken: z.string(),
  email: z.string().nullable(),
  rootFolderId: z.string().nullable().default(null),
});
type Creds = z.infer<typeof Creds>;

export class Google {
  private access: { token: string; exp: number } | null = null;
  private readonly creds: JsonFile<Creds | null>;

  constructor(
    dataDir: string,
    private readonly fqdn: string,
    private readonly client: () => Promise<{ clientId: string; clientSecret: string } | undefined>,
  ) {
    this.creds = new JsonFile(`${dataDir}/secrets/google.json`, Creds.nullable(), null);
  }

  get redirectUri() {
    return `https://${this.fqdn}/google/callback`;
  }

  async status() {
    const c = await this.creds.read();
    return { connected: !!c, email: c?.email ?? null, redirectUri: this.redirectUri };
  }

  async authUrl(state: string): Promise<string> {
    const cl = await this.client();
    if (!cl) throw new Error("Add your Google OAuth client id/secret in Settings first");
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: cl.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return u.toString();
  }

  async handleCallback(code: string) {
    const cl = await this.client();
    if (!cl) throw new Error("Google client not configured");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cl.clientId,
        client_secret: cl.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const j = (await r.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; id_token?: string; error?: string };
    if (!r.ok || !j.refresh_token) throw new Error(`Google token exchange failed: ${j.error ?? r.status}`);
    let email: string | null = null;
    if (j.id_token) {
      try {
        email = (JSON.parse(Buffer.from(j.id_token.split(".")[1]!, "base64url").toString()) as { email?: string }).email ?? null;
      } catch {
        /* ignore */
      }
    }
    await this.creds.write({ refreshToken: j.refresh_token, email, rootFolderId: null });
    this.access = { token: j.access_token!, exp: Date.now() + (j.expires_in ?? 3000) * 1000 };
  }

  async disconnect() {
    await this.creds.write(null);
    this.access = null;
  }

  private async token(): Promise<string> {
    if (this.access && this.access.exp - Date.now() > 60_000) return this.access.token;
    const c = await this.creds.read();
    const cl = await this.client();
    if (!c || !cl) throw new Error("Google not connected");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: c.refreshToken,
        client_id: cl.clientId,
        client_secret: cl.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !j.access_token)
      throw new Error(
        j.error === "invalid_grant"
          ? "Google access expired. Reconnect Google in Settings (and publish your OAuth app to avoid the 7-day expiry)."
          : `Google token refresh failed: ${j.error ?? r.status}`,
      );
    this.access = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3000) * 1000 };
    return this.access.token;
  }

  private async api<T>(url: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${await this.token()}`, ...init.headers } });
    if (!r.ok) throw new Error(`Google API ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return (await r.json()) as T;
  }

  /* ------------------------------------------------------------ Drive */

  async createFolder(name: string, parent?: string): Promise<{ id: string; webViewLink: string }> {
    return this.api("https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : undefined }),
    });
  }

  /** The app's root folder ("CloudPilot"), created once. drive.file can only see folders it created. */
  async rootFolder(preferred?: string): Promise<string> {
    if (preferred) return preferred;
    const c = await this.creds.read();
    if (c?.rootFolderId) return c.rootFolderId;
    const f = await this.createFolder("CloudPilot");
    if (c) await this.creds.write({ ...c, rootFolderId: f.id });
    return f.id;
  }

  /** Resumable upload in 8 MiB chunks — works for multi-GB recordings. */
  async upload(path: string, parent: string, mimeType: string): Promise<{ id: string; webViewLink: string }> {
    const size = (await stat(path)).size;
    const init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.token()}`,
        "content-type": "application/json",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name: basename(path), parents: [parent] }),
    });
    if (!init.ok) throw new Error(`Drive upload init ${init.status}: ${await init.text()}`);
    const session = init.headers.get("location")!;
    const CHUNK = 8 * 1024 * 1024;
    const fh = await open(path, "r");
    try {
      let offset = 0;
      while (true) {
        const len = Math.min(CHUNK, size - offset);
        const buf = Buffer.alloc(len);
        if (len > 0) await fh.read(buf, 0, len, offset);
        const end = offset + len - 1;
        const r = await fetch(session, {
          method: "PUT",
          headers: { "content-range": size === 0 ? "bytes */0" : `bytes ${offset}-${end}/${size}` },
          body: buf,
        });
        if (r.status === 308) {
          const range = r.headers.get("range");
          offset = range ? Number(range.split("-")[1]) + 1 : offset + len;
          continue;
        }
        if (!r.ok) throw new Error(`Drive upload ${r.status}: ${await r.text()}`);
        return (await r.json()) as { id: string; webViewLink: string };
      }
    } finally {
      await fh.close();
    }
  }

  /* ------------------------------------------------------------ Gmail */

  async sendRaw(mime: string) {
    await this.api("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }),
    });
  }

  async email() {
    return (await this.creds.read())?.email ?? null;
  }
}
