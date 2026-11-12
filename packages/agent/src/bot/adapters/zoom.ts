import type { Page } from "playwright-core";
import { sleep } from "../x11.js";
import { anyText, countFromLabel, firstVisible, type MeetingAdapter, type Where } from "./types.js";

const btn = (page: Page, name: RegExp) => page.getByRole("button", { name });

/** Turn any Zoom invite (…/j/123?pwd=…) into the Zoom Web Client join URL. */
export function zoomWebClientUrl(url: string): string {
  const u = new URL(url);
  const id = /\/(?:j|w|s|wc\/join|wc)\/(\d{9,12})/.exec(u.pathname)?.[1];
  if (!id) return url;
  const out = new URL(`https://app.zoom.us/wc/join/${id}`);
  const pwd = u.searchParams.get("pwd");
  if (pwd) out.searchParams.set("pwd", pwd);
  return out.toString();
}

export const zoom: MeetingAdapter = {
  name: "Zoom",
  joinUrl: zoomWebClientUrl,

  async join(ctx) {
    const { page, x11 } = ctx;
    await page.waitForLoadState("domcontentloaded");
    const cookie = await firstVisible([btn(page, /accept cookies/i), btn(page, /^accept$/i)], 2000);
    await cookie?.click().catch(() => undefined);
    const name = await firstVisible([page.locator("#input-for-name"), page.getByLabel(/your name/i), page.getByPlaceholder(/your name/i)], 25_000);
    if (name) {
      const current = await name.inputValue().catch(() => "");
      if (!current || ctx.guestName) {
        await name.fill(ctx.guestName ?? current ?? "CloudPilot");
      }
    }
    // Pre-join: mute + camera per presence (buttons say "Mute"/"Stop Video" when on).
    const mute = await firstVisible([btn(page, /^mute$/i)], 2000);
    await mute?.click().catch(() => undefined);
    if (!ctx.startWithCamera) {
      const stop = await firstVisible([btn(page, /stop video/i)], 1500);
      await stop?.click().catch(() => undefined);
    }
    const join = await firstVisible([btn(page, /^join$/i), page.locator("button.preview-join-button")], 20_000);
    if (!join) throw new Error("Zoom: Join button not found (does the meeting need a passcode?)");
    await sleep(400);
    await x11.clickLocator(page, join);
    // Some meetings ask to join computer audio after entering.
    const audio = await firstVisible([btn(page, /join audio by computer/i), btn(page, /join with computer audio/i)], 20_000);
    await audio?.click().catch(() => undefined);
  },

  async where(page): Promise<Where> {
    if (await anyText(page, [/this meeting has been ended/i, /you have been removed/i, /the host has ended this meeting/i, /meeting is ended/i]))
      return "ended";
    if (await anyText(page, [/please wait, the meeting host will let you in soon/i, /waiting for the host to start/i, /host has joined\. we've let them know you're here/i]))
      return "waiting";
    if (await firstVisible([btn(page, /^leave$/i), page.locator(".footer__leave-btn")])) return "in-meeting";
    if (await firstVisible([btn(page, /^join$/i)])) return "prejoin";
    return "unknown";
  },

  async participants(page) {
    const b = await firstVisible([page.locator(".footer-button__number-counter"), btn(page, /participants/i)]);
    return countFromLabel((await b?.innerText().catch(() => null)) ?? (await b?.getAttribute("aria-label")) ?? null);
  },
  async isCameraOn(page) {
    if (await firstVisible([btn(page, /stop video/i)])) return true;
    if (await firstVisible([btn(page, /start video/i)])) return false;
    return null;
  },
  async isMicOn(page) {
    if (await firstVisible([btn(page, /^mute/i)])) return true;
    if (await firstVisible([btn(page, /^unmute/i)])) return false;
    return null;
  },
  async toggleCamera({ x11 }) {
    await x11.key("alt+v");
  },
  async toggleMic({ x11 }) {
    await x11.key("alt+a");
  },
  async chat({ page }, text) {
    let box = await firstVisible([page.locator(".chat-box__chat-textarea"), page.getByRole("textbox", { name: /chat|message/i })]);
    if (!box) {
      await (await firstVisible([btn(page, /^chat/i)], 3000))?.click();
      box = await firstVisible([page.locator(".chat-box__chat-textarea"), page.getByRole("textbox", { name: /chat|message/i })], 5000);
    }
    if (!box) throw new Error("Zoom chat not available");
    await box.click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  },
  async raiseHand({ x11 }) {
    await x11.key("alt+y");
  },
  async leave({ page }) {
    await (await firstVisible([btn(page, /^leave$/i)], 3000))?.click();
    await (await firstVisible([btn(page, /leave meeting/i)], 3000))?.click();
  },
};
