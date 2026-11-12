import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dHashFromGray9x8, hammingHex, newId, randomDelayMs, type Screenshot, type ScreenshotPolicy } from "@cloudpilot/shared";
import sharp from "sharp";

export type Grab = () => Promise<Buffer>; // JPEG bytes of the current meeting view

export async function dHashOf(img: Buffer): Promise<string> {
  const gray = await sharp(img).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  return dHashFromGray9x8(gray);
}

/**
 * Screenshot engine: manual, random-interval, burst and slide-change capture.
 * Index is kept in shots.json next to the images.
 */
export class ShotEngine {
  private randomTimer: NodeJS.Timeout | null = null;
  private slideTimer: NodeJS.Timeout | null = null;
  private lastHash: string | null = null;
  private lastSlideAt = 0;
  readonly shots: Screenshot[] = [];

  constructor(
    private readonly dir: string,
    private readonly meetingId: string,
    private readonly grab: Grab,
    private readonly onShot: (s: Screenshot) => void = () => undefined,
  ) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      this.shots.push(...(JSON.parse(await readFile(join(this.dir, "shots.json"), "utf8")) as Screenshot[]));
    } catch {
      /* first run */
    }
  }

  async take(reason: Screenshot["reason"], img?: Buffer): Promise<Screenshot> {
    const bytes = img ?? (await this.grab());
    const takenAt = new Date();
    const file = `${takenAt.toISOString().replace(/[:.]/g, "-")}_${reason}.jpg`;
    await writeFile(join(this.dir, file), bytes);
    const s: Screenshot = {
      id: newId("shot"),
      meetingId: this.meetingId,
      takenAt: takenAt.toISOString(),
      reason,
      file,
      bytes: (await stat(join(this.dir, file))).size,
    };
    this.shots.push(s);
    await writeFile(join(this.dir, "shots.json"), JSON.stringify(this.shots, null, 1));
    this.onShot(s);
    return s;
  }

  async burst(count: number, gapMs = 1500) {
    for (let i = 0; i < count; i++) {
      await this.take("burst");
      if (i < count - 1) await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  start(policy: ScreenshotPolicy) {
    this.stop();
    if (!policy.enabled) return;
    const scheduleRandom = () => {
      this.randomTimer = setTimeout(async () => {
        await this.take("random").catch((e) => console.warn("random shot failed", e));
        scheduleRandom();
      }, randomDelayMs(policy.randomMinMinutes, policy.randomMaxMinutes));
    };
    scheduleRandom();
    if (policy.onSlideChange) {
      this.slideTimer = setInterval(() => void this.checkSlide(policy.slideSensitivity), 5000);
    }
  }

  /** Exposed for tests: compare a frame to the previous one and capture if it changed enough. */
  async checkSlide(sensitivity: number, img?: Buffer): Promise<boolean> {
    try {
      const frame = img ?? (await this.grab());
      const h = await dHashOf(frame);
      const prev = this.lastHash;
      this.lastHash = h;
      // Debounce: animations/video shouldn't produce a flood of "slides".
      if (prev && hammingHex(prev, h) >= sensitivity && Date.now() - this.lastSlideAt > 8000) {
        this.lastSlideAt = Date.now();
        await this.take("slide", frame);
        return true;
      }
    } catch (e) {
      console.warn("slide check failed", e);
    }
    return false;
  }

  stop() {
    if (this.randomTimer) clearTimeout(this.randomTimer);
    if (this.slideTimer) clearInterval(this.slideTimer);
    this.randomTimer = this.slideTimer = null;
  }
}
