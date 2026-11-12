import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import sharp from "sharp";
import type { FinishedMeeting } from "../bot/runner.js";
import type { Settings } from "../settings.js";
import { buildMime, summaryHtml, type InlineImage } from "./email.js";
import type { Google } from "./google.js";

export interface DeliveryReport {
  meetingId: string;
  at: string;
  driveFolderUrl: string | null;
  recordingUrl: string | null;
  emailed: boolean;
  errors: string[];
}

/** Pick up to `n` screenshots, spread across the meeting, preferring slides and manual shots. */
export function pickHighlights<T extends { reason: string; takenAt: string }>(shots: T[], n: number): T[] {
  if (shots.length <= n) return shots;
  const prio = (s: T) => (s.reason === "manual" ? 0 : s.reason === "slide" ? 1 : 2);
  const sorted = [...shots].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const chosen = new Set<T>(sorted.filter((s) => prio(s) === 0).slice(0, n));
  const buckets = n - chosen.size;
  if (buckets > 0) {
    const rest = sorted.filter((s) => !chosen.has(s));
    for (let i = 0; i < buckets && rest.length; i++) {
      const slice = rest.slice(Math.floor((i * rest.length) / buckets), Math.floor(((i + 1) * rest.length) / buckets));
      const best = [...slice].sort((a, b) => prio(a) - prio(b))[0];
      if (best) chosen.add(best);
    }
  }
  return sorted.filter((s) => chosen.has(s));
}

export class Delivery {
  constructor(
    private readonly google: Google,
    private readonly getSettings: () => Promise<Settings>,
  ) {}

  async deliver(f: FinishedMeeting): Promise<DeliveryReport> {
    const settings = await this.getSettings();
    const pol = f.meeting.delivery;
    const report: DeliveryReport = {
      meetingId: f.meeting.id,
      at: new Date().toISOString(),
      driveFolderUrl: null,
      recordingUrl: null,
      emailed: false,
      errors: [],
    };
    const gStatus = await this.google.status();

    // 1. Drive
    if (pol.drive) {
      try {
        if (!gStatus.connected) throw new Error("Google not connected");
        const root = await this.google.rootFolder(settings.google?.driveFolderId);
        const day = f.meeting.startAt.slice(0, 10);
        const folder = await this.google.createFolder(`${day} · ${f.meeting.title}`, root);
        report.driveFolderUrl = folder.webViewLink;
        for (const s of f.shots) await retry(() => this.google.upload(join(f.dir, s.file), folder.id, "image/jpeg"));
        if (pol.includeRecording && f.recording && (await exists(f.recording))) {
          const up = await retry(() => this.google.upload(f.recording!, folder.id, "video/mp4"));
          report.recordingUrl = up.webViewLink;
        }
      } catch (e) {
        report.errors.push(`Drive: ${(e as Error).message}`);
      }
    }

    // 2. Email
    if (pol.email) {
      try {
        const to = pol.emailTo ?? settings.emailTo ?? gStatus.email;
        if (!to) throw new Error("No recipient (set an email in Settings)");
        const highlights = pickHighlights(f.shots, 12);
        const images: InlineImage[] = [];
        for (const [i, shot] of highlights.entries()) {
          const jpeg = await sharp(await readFile(join(f.dir, shot.file)))
            .resize({ width: 640, withoutEnlargement: true })
            .jpeg({ quality: 70 })
            .toBuffer();
          images.push({ cid: `shot${i}@cloudpilot`, jpeg, shot });
        }
        const html = summaryHtml({
          meeting: f.meeting,
          outcome: f.outcome,
          note: f.note,
          images,
          totalShots: f.shots.length,
          driveUrl: report.driveFolderUrl,
          recordingUrl: report.recordingUrl,
        });
        const subject = `${f.outcome === "done" ? "📝" : "⚠️"} ${f.meeting.title} — ${f.shots.length} screenshots`;
        if (gStatus.connected) {
          await retry(() => this.google.sendRaw(buildMime({ to, subject, html, images })));
        } else if (settings.smtp) {
          const t = nodemailer.createTransport({
            host: settings.smtp.host,
            port: settings.smtp.port,
            secure: settings.smtp.secure,
            auth: { user: settings.smtp.user, pass: settings.smtp.pass },
          });
          await t.sendMail({
            from: settings.smtp.from ?? settings.smtp.user,
            to,
            subject,
            html,
            attachments: images.map((i) => ({ filename: i.shot.file, content: i.jpeg, cid: i.cid })),
          });
        } else throw new Error("Connect Google or configure SMTP to send email");
        report.emailed = true;
      } catch (e) {
        report.errors.push(`Email: ${(e as Error).message}`);
      }
    }

    await writeFile(join(f.dir, "delivery.json"), JSON.stringify(report, null, 2));

    // 3. Local retention
    const uploaded = pol.drive && report.errors.every((e) => !e.startsWith("Drive"));
    if (!pol.keepOnVm && uploaded) await rm(f.dir, { recursive: true, force: true });
    return report;
  }

  /** Remove local copies of meetings that were uploaded more than N days ago. */
  async prune(meetingsDir: string, days: number) {
    if (days <= 0) return;
    const cutoff = Date.now() - days * 86_400_000;
    for (const id of await readdir(meetingsDir).catch(() => [] as string[])) {
      const p = join(meetingsDir, id, "delivery.json");
      try {
        const r = JSON.parse(await readFile(p, "utf8")) as DeliveryReport;
        if (r.driveFolderUrl && !r.errors.some((e) => e.startsWith("Drive")) && Date.parse(r.at) < cutoff)
          await rm(join(meetingsDir, id, "recording.mp4"), { force: true });
      } catch {
        /* not delivered */
      }
    }
  }
}

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw last;
}
