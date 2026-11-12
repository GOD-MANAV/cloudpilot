import type { Locator, Page } from "playwright-core";
import type { X11 } from "../x11.js";

export type Where = "prejoin" | "waiting" | "in-meeting" | "ended" | "unknown";

export interface AdapterContext {
  page: Page;
  x11: X11;
  guestName: string | null; // null → use the signed-in profile
  startWithCamera: boolean;
}

/**
 * One per platform. Selectors favour accessible names / visible text, which
 * survive UI redesigns far better than CSS classes. Keyboard shortcuts are used
 * for camera/mic because they are the most stable surface of all.
 */
export interface MeetingAdapter {
  readonly name: string;
  /** Rewrite the invite URL into one that opens the in-browser client. */
  joinUrl(url: string): string;
  /** Fill name, set camera/mic, click Join. */
  join(ctx: AdapterContext): Promise<void>;
  where(page: Page): Promise<Where>;
  participants(page: Page): Promise<number | null>;
  isCameraOn(page: Page): Promise<boolean | null>;
  isMicOn(page: Page): Promise<boolean | null>;
  toggleCamera(ctx: AdapterContext): Promise<void>;
  toggleMic(ctx: AdapterContext): Promise<void>;
  chat(ctx: AdapterContext, text: string): Promise<void>;
  raiseHand(ctx: AdapterContext): Promise<void>;
  leave(ctx: AdapterContext): Promise<void>;
}

/** First visible locator among candidates, or null. */
export async function firstVisible(cands: Locator[], timeoutMs = 0): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const c of cands) {
      const l = c.first();
      if (await l.isVisible().catch(() => false)) return l;
    }
    if (Date.now() < deadline) await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < deadline);
  return null;
}

export async function anyText(page: Page, patterns: RegExp[]): Promise<boolean> {
  for (const p of patterns) if (await page.getByText(p).first().isVisible().catch(() => false)) return true;
  return false;
}

/** Parse "Show everyone (12)" / "People 12" style labels. */
export function countFromLabel(label: string | null): number | null {
  if (!label) return null;
  const m = /(\d{1,4})/.exec(label);
  return m ? Number(m[1]) : null;
}
