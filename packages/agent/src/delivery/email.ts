import { randomBytes } from "node:crypto";
import type { Meeting, Screenshot } from "@cloudpilot/shared";

export interface InlineImage {
  cid: string;
  jpeg: Buffer;
  shot: Screenshot;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const REASON: Record<Screenshot["reason"], string> = {
  manual: "You",
  random: "Random",
  slide: "New slide",
  burst: "Burst",
};

export function summaryHtml(opts: {
  meeting: Meeting;
  outcome: "done" | "failed";
  note: string | null;
  images: InlineImage[];
  totalShots: number;
  driveUrl: string | null;
  recordingUrl: string | null;
  tz?: string;
}): string {
  const { meeting: m, images, driveUrl, recordingUrl } = opts;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { timeZone: opts.tz ?? "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: opts.tz ?? "Asia/Kolkata", timeStyle: "short" });
  const cells = images
    .map(
      (i) => `<td style="padding:6px;width:50%;vertical-align:top">
        <img src="cid:${i.cid}" width="280" style="width:100%;max-width:280px;border-radius:10px;border:1px solid #e3e6ef;display:block" alt="">
        <div style="font:12px/1.4 system-ui,sans-serif;color:#5b6478;margin-top:4px">${time(i.shot.takenAt)} · ${REASON[i.shot.reason]}</div></td>`,
    )
    .reduce<string[]>((rows, cell, idx) => {
      if (idx % 2 === 0) rows.push(cell);
      else rows[rows.length - 1] += cell;
      return rows;
    }, [])
    .map((r) => `<tr>${r}</tr>`)
    .join("");
  const btn = (href: string, label: string) =>
    `<a href="${esc(href)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:10px;margin:4px 8px 4px 0">${label}</a>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f5fa">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;padding:24px">
    <tr><td style="font:600 12px system-ui,sans-serif;letter-spacing:.08em;color:#4f46e5;text-transform:uppercase">CloudPilot · meeting notes</td></tr>
    <tr><td style="font:700 22px/1.3 system-ui,sans-serif;color:#0b1020;padding-top:6px">${esc(m.title)}</td></tr>
    <tr><td style="font:14px/1.5 system-ui,sans-serif;color:#5b6478;padding:6px 0 14px">${fmt(m.startAt)} · ${m.platform === "meet" ? "Google Meet" : m.platform === "zoom" ? "Zoom" : "Teams"} · ${opts.totalShots} screenshots${opts.outcome === "failed" ? ` · <b style="color:#dc2626">${esc(opts.note ?? "did not complete")}</b>` : ""}</td></tr>
    <tr><td>${driveUrl ? btn(driveUrl, "Open Drive folder") : ""}${recordingUrl ? btn(recordingUrl, "Watch recording") : ""}</td></tr>
    <tr><td style="padding-top:12px"><table role="presentation" width="100%">${cells}</table></td></tr>
    ${opts.totalShots > images.length ? `<tr><td style="font:13px system-ui,sans-serif;color:#5b6478;padding-top:8px">+${opts.totalShots - images.length} more in the Drive folder.</td></tr>` : ""}
    <tr><td style="font:12px system-ui,sans-serif;color:#9aa1b2;padding-top:20px">Sent by your CloudPilot machine.</td></tr>
  </table></td></tr></table></body></html>`;
}

/** RFC 2822 multipart/related message with inline images (for the Gmail API). */
export function buildMime(opts: { from?: string; to: string; subject: string; html: string; images: InlineImage[] }): string {
  const b = `cp_${randomBytes(8).toString("hex")}`;
  const subject = `=?UTF-8?B?${Buffer.from(opts.subject).toString("base64")}?=`;
  const head = [
    ...(opts.from ? [`From: ${opts.from}`] : []),
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${b}"`,
    "",
  ];
  const parts = [
    `--${b}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(opts.html).toString("base64")),
    ...opts.images.flatMap((i) => [
      `--${b}`,
      "Content-Type: image/jpeg",
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${i.cid}>`,
      `Content-Disposition: inline; filename="${i.shot.file}"`,
      "",
      wrap(i.jpeg.toString("base64")),
    ]),
    `--${b}--`,
    "",
  ];
  return [...head, ...parts].join("\r\n");
}

const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
