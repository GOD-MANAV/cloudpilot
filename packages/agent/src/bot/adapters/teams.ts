import type { Page } from "playwright-core";
import { sleep } from "../x11.js";
import { anyText, countFromLabel, firstVisible, type MeetingAdapter, type Where } from "./types.js";

const btn = (page: Page, name: RegExp) => page.getByRole("button", { name });

/** Force the in-browser experience instead of "Open Teams app?". */
export function teamsWebUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("msLaunch", "false");
  u.searchParams.set("directDl", "true");
  u.searchParams.set("suppressPrompt", "true");
  u.searchParams.set("enableMobilePage", "false");
  return u.toString();
}

export const teams: MeetingAdapter = {
  name: "Microsoft Teams",
  joinUrl: teamsWebUrl,

  async join(ctx) {
    const { page, x11 } = ctx;
    await page.waitForLoadState("domcontentloaded");
    const browser = await firstVisible(
      [btn(page, /continue on this browser/i), page.getByRole("link", { name: /continue on this browser/i }), btn(page, /join on the web instead/i)],
      20_000,
    );
    await browser?.click().catch(() => undefined);
    const name = await firstVisible([page.getByPlaceholder(/type your name/i), page.getByLabel(/type your name|your name/i)], 20_000);
    if (name && ctx.guestName) await name.fill(ctx.guestName);
    // Pre-join switches are toggles with accessible names "Camera"/"Microphone".
    const mic = page.getByRole("switch", { name: /microphone/i }).first();
    if ((await mic.getAttribute("aria-checked").catch(() => null)) === "true") await mic.click().catch(() => undefined);
    const cam = page.getByRole("switch", { name: /camera|video/i }).first();
    const camOn = (await cam.getAttribute("aria-checked").catch(() => null)) === "true";
    if (camOn !== ctx.startWithCamera) await cam.click().catch(() => undefined);
    const join = await firstVisible([btn(page, /^join now$/i), page.locator("#prejoin-join-button")], 30_000);
    if (!join) throw new Error("Teams: Join button not found");
    await sleep(500);
    await x11.clickLocator(page, join);
  },

  async where(page): Promise<Where> {
    if (await anyText(page, [/you've been removed/i, /the meeting has ended/i, /you left the meeting/i, /call ended/i, /rejoin/i]))
      return "ended";
    if (await anyText(page, [/someone will let you in shortly/i, /we've let people in the meeting know you're waiting/i, /when the meeting starts, we'll let people know/i]))
      return "waiting";
    if (await firstVisible([page.locator("#hangup-button"), btn(page, /^leave/i)])) return "in-meeting";
    if (await firstVisible([btn(page, /^join now$/i)])) return "prejoin";
    return "unknown";
  },

  async participants(page) {
    const b = await firstVisible([page.locator("#roster-button"), btn(page, /^people/i)]);
    return countFromLabel((await b?.innerText().catch(() => null)) ?? (await b?.getAttribute("aria-label")) ?? null);
  },
  async isCameraOn(page) {
    const b = await firstVisible([page.locator("#video-button"), btn(page, /camera/i)]);
    const l = ((await b?.getAttribute("aria-label")) ?? "").toLowerCase();
    if (l.includes("turn camera off")) return true;
    if (l.includes("turn camera on")) return false;
    return null;
  },
  async isMicOn(page) {
    const b = await firstVisible([page.locator("#microphone-button"), btn(page, /^(mute|unmute)/i)]);
    const l = ((await b?.getAttribute("aria-label")) ?? "").toLowerCase();
    if (l.startsWith("mute")) return true;
    if (l.startsWith("unmute")) return false;
    return null;
  },
  async toggleCamera({ x11 }) {
    await x11.key("ctrl+shift+o");
  },
  async toggleMic({ x11 }) {
    await x11.key("ctrl+shift+m");
  },
  async chat({ page }, text) {
    let box = await firstVisible([page.getByRole("textbox", { name: /type a message|type a new message/i })]);
    if (!box) {
      await (await firstVisible([page.locator("#chat-button"), btn(page, /^chat/i)], 3000))?.click();
      box = await firstVisible([page.getByRole("textbox", { name: /type a message|type a new message/i })], 5000);
    }
    if (!box) throw new Error("Teams chat not available");
    await box.click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  },
  async raiseHand({ x11 }) {
    await x11.key("ctrl+shift+k");
  },
  async leave({ page }) {
    await (await firstVisible([page.locator("#hangup-button"), btn(page, /^leave/i)], 3000))?.click();
  },
};
