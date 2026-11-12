import type { Page } from "playwright-core";
import { sleep } from "../x11.js";
import { anyText, countFromLabel, firstVisible, type AdapterContext, type MeetingAdapter, type Where } from "./types.js";

/** Buttons by accessible name — robust to class-name churn. */
const btn = (page: Page, name: RegExp) => page.getByRole("button", { name });

export const meet: MeetingAdapter = {
  name: "Google Meet",

  joinUrl(url) {
    const u = new URL(url);
    u.searchParams.set("hl", "en"); // stable English UI strings for our selectors
    return u.toString();
  },

  async join(ctx) {
    const { page, x11 } = ctx;
    await page.waitForLoadState("domcontentloaded");
    // Dismiss first-run dialogs.
    for (const name of [/^got it$/i, /^dismiss$/i, /^continue without/i, /^close$/i]) {
      const b = await firstVisible([btn(page, name)], 800);
      if (b) await b.click().catch(() => undefined);
    }
    if (ctx.guestName) {
      const input = await firstVisible(
        [page.getByLabel(/your name/i), page.getByPlaceholder(/your name/i), page.locator('input[type="text"]')],
        15_000,
      );
      if (input) {
        await x11.clickLocator(page, input);
        await input.fill("");
        await x11.type(ctx.guestName);
      }
    }
    // Pre-join toggles: mic always off; camera per presence.
    const micOff = await firstVisible([btn(page, /turn off microphone/i)], 3000);
    if (micOff) await micOff.click().catch(() => undefined);
    if (!ctx.startWithCamera) {
      const camOff = await firstVisible([btn(page, /turn off camera/i)], 1500);
      if (camOff) await camOff.click().catch(() => undefined);
    }
    const join = await firstVisible(
      [btn(page, /^join now$/i), btn(page, /^ask to join$/i), btn(page, /^join$/i), btn(page, /switch here/i)],
      30_000,
    );
    if (!join) throw new Error("Couldn't find the Join button (are you signed in / is the link valid?)");
    await sleep(600 + Math.random() * 800);
    await x11.clickLocator(page, join); // real X11 click — CDP clicks get refused here
  },

  async where(page): Promise<Where> {
    if (await anyText(page, [/you left the meeting/i, /you've been removed/i, /the call has ended/i, /meeting has ended/i, /return to home screen/i]))
      return "ended";
    if (await btn(page, /leave call/i).first().isVisible().catch(() => false)) return "in-meeting";
    if (await anyText(page, [/asking to be let in/i, /please wait until a meeting host/i, /someone in the meeting will let you in/i]))
      return "waiting";
    if (await anyText(page, [/you can't join this video call/i, /no one can join a meeting unless invited/i, /you can't create a meeting yourself/i]))
      return "ended";
    if (await firstVisible([btn(page, /join now|ask to join/i)])) return "prejoin";
    return "unknown";
  },

  async participants(page) {
    const people = await firstVisible([page.locator('[aria-label*="Show everyone" i]'), page.locator('[aria-label*="People" i]')]);
    const n = countFromLabel((await people?.getAttribute("aria-label")) ?? null);
    if (n !== null) return n;
    const badge = await people?.innerText().catch(() => null);
    return countFromLabel(badge ?? null);
  },

  async isCameraOn(page) {
    if (await btn(page, /turn off camera/i).first().isVisible().catch(() => false)) return true;
    if (await btn(page, /turn on camera/i).first().isVisible().catch(() => false)) return false;
    return null;
  },
  async isMicOn(page) {
    if (await btn(page, /turn off microphone/i).first().isVisible().catch(() => false)) return true;
    if (await btn(page, /turn on microphone/i).first().isVisible().catch(() => false)) return false;
    return null;
  },
  async toggleCamera({ x11 }) {
    await x11.key("ctrl+e");
  },
  async toggleMic({ x11 }) {
    await x11.key("ctrl+d");
  },

  async chat({ page }, text) {
    let box = await firstVisible([page.getByLabel(/send a message/i), page.getByPlaceholder(/send a message/i)]);
    if (!box) {
      const open = await firstVisible([btn(page, /chat with everyone/i), btn(page, /^chat$/i)], 3000);
      await open?.click();
      box = await firstVisible([page.getByLabel(/send a message/i), page.getByPlaceholder(/send a message/i)], 5000);
    }
    if (!box) throw new Error("Chat box not found (chat may be disabled by the host)");
    await box.fill(text);
    await box.press("Enter");
  },

  async raiseHand({ page }) {
    const b = await firstVisible([btn(page, /raise hand/i), btn(page, /lower hand/i)], 3000);
    if (!b) throw new Error("Raise-hand button not found");
    await b.click();
  },

  async leave({ page }) {
    const b = await firstVisible([btn(page, /leave call/i)], 3000);
    await b?.click();
  },
};
