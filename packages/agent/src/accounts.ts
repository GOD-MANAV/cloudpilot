import { join } from "node:path";
import { z } from "zod";
import { JsonFile } from "./settings.js";

/**
 * Meeting-platform accounts live in the VM's own Chrome profile. You sign in ONCE
 * yourself (in the live desktop, with "Stay signed in" ticked); the bot then joins
 * as you. CloudPilot never stores your Microsoft/Zoom/Google password.
 */
export const ACCOUNT_PLATFORMS = {
  teams: {
    name: "Microsoft Teams",
    checkUrl: "https://teams.microsoft.com/v2/",
    loginUrl: "https://teams.microsoft.com/v2/",
    signedOutHosts: ["login.microsoftonline.com", "login.live.com", "login.microsoft.com"],
    cookieDomains: ["microsoftonline.com", "login.live.com", "teams.microsoft.com", "teams.live.com", "microsoft.com", "office.com", "skype.com"],
    tips: [
      "Use your institute account (e.g. you@college.edu) — the same one you use for classes.",
      "Approve the sign-in in Microsoft Authenticator if asked.",
      "Tick “Stay signed in” / “Don't show this again” so the bot stays logged in for weeks.",
      "If Teams asks “Use the app or the web?”, choose “Use the web app instead”.",
    ],
  },
  zoom: {
    name: "Zoom",
    checkUrl: "https://zoom.us/profile",
    loginUrl: "https://zoom.us/signin",
    signedOutHosts: [],
    signedOutPath: /\/signin|\/login/i,
    cookieDomains: ["zoom.us", "zoom.com"],
    tips: ["Optional — most Zoom meetings can be joined as a guest with just a name.", "Choose “Stay signed in”."],
  },
  google: {
    name: "Google (Meet)",
    checkUrl: "https://myaccount.google.com/",
    loginUrl: "https://accounts.google.com/",
    signedOutHosts: ["accounts.google.com"],
    cookieDomains: ["google.com", "accounts.google.com", "meet.google.com", "youtube.com"],
    tips: ["Only needed for Google Meet meetings restricted to signed-in users."],
  },
} as const;

export type AccountPlatform = keyof typeof ACCOUNT_PLATFORMS;
export const AccountPlatform = z.enum(["teams", "zoom", "google"]);

export const AccountStatus = z.object({
  platform: AccountPlatform,
  signedIn: z.boolean().nullable(), // null = never checked
  detail: z.string().nullable(),
  checkedAt: z.string().nullable(),
});
export type AccountStatus = z.infer<typeof AccountStatus>;

/** Decide signed-in/out from where the check URL ended up. Pure, for tests. */
export function judgeSignedIn(platform: AccountPlatform, finalUrl: string): boolean {
  const p = ACCOUNT_PLATFORMS[platform];
  let u: URL;
  try {
    u = new URL(finalUrl);
  } catch {
    return false;
  }
  if ((p.signedOutHosts as readonly string[]).includes(u.hostname)) return false;
  if ("signedOutPath" in p && p.signedOutPath.test(u.pathname)) return false;
  return true;
}

export interface BrowserProbe {
  /** Open url in a background tab, return where it ended up and the page title. */
  probe(url: string): Promise<{ url: string; title: string }>;
  clearCookies(domains: readonly string[]): Promise<void>;
  openForSignIn(url: string): Promise<void>;
  readonly busy: boolean;
}

export class Accounts {
  private file: JsonFile<Record<string, AccountStatus>>;

  constructor(
    dataDir: string,
    private readonly browser: BrowserProbe,
  ) {
    this.file = new JsonFile(join(dataDir, "accounts.json"), z.record(z.string(), AccountStatus), {});
  }

  async list(): Promise<(AccountStatus & { name: string; tips: readonly string[] })[]> {
    const saved = await this.file.read();
    return (Object.keys(ACCOUNT_PLATFORMS) as AccountPlatform[]).map((platform) => ({
      ...(saved[platform] ?? { platform, signedIn: null, detail: null, checkedAt: null }),
      name: ACCOUNT_PLATFORMS[platform].name,
      tips: ACCOUNT_PLATFORMS[platform].tips,
    }));
  }

  async check(platform: AccountPlatform): Promise<AccountStatus> {
    if (this.browser.busy) throw Object.assign(new Error("The bot is in a meeting — check accounts afterwards."), { statusCode: 409 });
    const r = await this.browser.probe(ACCOUNT_PLATFORMS[platform].checkUrl);
    const signedIn = judgeSignedIn(platform, r.url);
    const status: AccountStatus = {
      platform,
      signedIn,
      detail: signedIn ? r.title.replace(/\s+\|.*$/, "").slice(0, 80) || null : "Sign-in needed",
      checkedAt: new Date().toISOString(),
    };
    const all = await this.file.read();
    await this.file.write({ ...all, [platform]: status });
    return status;
  }

  async signIn(platform: AccountPlatform) {
    if (this.browser.busy) throw Object.assign(new Error("The bot is in a meeting right now."), { statusCode: 409 });
    await this.browser.openForSignIn(ACCOUNT_PLATFORMS[platform].loginUrl);
  }

  async signOut(platform: AccountPlatform) {
    if (this.browser.busy) throw Object.assign(new Error("The bot is in a meeting right now."), { statusCode: 409 });
    await this.browser.clearCookies(ACCOUNT_PLATFORMS[platform].cookieDomains);
    const all = await this.file.read();
    await this.file.write({ ...all, [platform]: { platform, signedIn: false, detail: "Signed out", checkedAt: new Date().toISOString() } });
  }
}
