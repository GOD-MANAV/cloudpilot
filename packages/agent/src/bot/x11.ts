import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Locator, Page } from "playwright-core";

const exec = promisify(execFile);

/**
 * Real X11 input via xdotool. Google Meet (and sometimes Teams) refuse joins
 * driven purely through CDP; a genuine OS-level click on the Join button works.
 */
export class X11 {
  constructor(private readonly display: string) {}

  private run(args: string[]) {
    return exec("xdotool", args, { env: { ...process.env, DISPLAY: this.display } });
  }

  async click(x: number, y: number) {
    await this.run(["mousemove", "--sync", String(Math.round(x)), String(Math.round(y))]);
    await sleep(80 + Math.random() * 120);
    await this.run(["click", "1"]);
  }

  async key(combo: string) {
    await this.run(["key", "--clearmodifiers", combo]);
  }

  async type(text: string) {
    await this.run(["type", "--delay", "35", text]);
  }

  /** Click a Playwright locator with a real mouse. Falls back to Playwright's click. */
  async clickLocator(page: Page, loc: Locator) {
    const box = await loc.boundingBox();
    if (!box) return loc.click();
    const off = await page.evaluate(() => ({
      x: window.screenX + (window.outerWidth - window.innerWidth) / 2,
      y: window.screenY + (window.outerHeight - window.innerHeight),
    }));
    try {
      await this.click(off.x + box.x + box.width / 2, off.y + box.y + box.height / 2);
    } catch {
      await loc.click();
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
