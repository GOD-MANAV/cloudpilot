import { join } from "node:path";
import type { Meeting } from "@cloudpilot/shared";
import { randomBytes } from "node:crypto";
import { Accounts } from "./accounts.js";
import { ActivityLog } from "./activity.js";
import { BotRunner } from "./bot/runner.js";
import { loadConfig } from "./config.js";
import { ControlLink } from "./control.js";
import { Google } from "./delivery/google.js";
import { Delivery } from "./delivery/pipeline.js";
import { IdleWatch } from "./idle.js";
import { buildServer } from "./server.js";
import { settingsFile } from "./settings.js";

const cfg = loadConfig();
const settings = settingsFile(cfg.dataDir);
const control = new ControlLink(cfg);
await control.loadRevoked(); // revoked links stay revoked across reboots, before the first sync
const idle = new IdleWatch(cfg.idleMinutes);
const bot = new BotRunner(cfg, idle, () => settings.read());
const google = new Google(cfg.dataDir, cfg.fqdn, async () => (await settings.read()).google);
const delivery = new Delivery(google, () => settings.read());
const activity = new ActivityLog();
const accounts = new Accounts(cfg.dataDir, bot);

// Give every machine its own private ntfy topic on first boot.
{
  const s = await settings.read();
  if (!s.ntfy.topic) await settings.write({ ...s, ntfy: { ...s.ntfy, topic: `cloudpilot-${randomBytes(12).toString("hex")}` } });
}

function applySettings(s: Awaited<ReturnType<typeof settings.read>>) {
  idle.idleMinutes = s.idleMinutes ?? cfg.idleMinutes;
}
applySettings(await settings.read());

// Tell your phone when an AI starts working on the machine (once per link per 30 min).
const lastAiPush = new Map<string, number>();
activity.on("event", async (ev) => {
  if (ev.type !== "start" || ev.entry.actorId === "owner") return;
  const { notify } = await settings.read();
  const last = lastAiPush.get(ev.entry.actorId) ?? 0;
  if (!notify.aiActivity || Date.now() - last < 30 * 60_000) return;
  lastAiPush.set(ev.entry.actorId, Date.now());
  void push("AI is using your machine", `${ev.entry.actor}: ${ev.entry.summary.slice(0, 80)}`);
});

/** Meetings already handled this boot, so we don't rejoin after finishing. */
const handled = new Set<string>();

async function joinMeeting(id: string) {
  const m: Meeting | undefined = control.meetings.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown meeting ${id}`);
  if (bot.busy) return;
  handled.add(id);
  await control.patchMeeting(id, { status: "joining", note: null });
  await bot.join(m);
}

async function push(title: string, detail: string) {
  const { pushTokens, ntfy, privateNotifications } = await settings.read();
  // Notifications travel through ntfy.sh / Expo; "Hide meeting titles" keeps titles and commands out of them.
  const body = privateNotifications ? "Open CloudPilot for details." : detail;
  if (ntfy.enabled && ntfy.topic) {
    await fetch(`${ntfy.server.replace(/\/$/, "")}/${ntfy.topic}`, {
      method: "POST",
      headers: { Title: encodeURIComponent(title).length === title.length ? title : "CloudPilot", Tags: "cloud", Priority: "default" },
      body: encodeURIComponent(title).length === title.length ? body : `${title}: ${body}`,
    }).catch((e) => console.warn("ntfy failed", e));
  }
  if (!pushTokens.length) return;
  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(pushTokens.map((to) => ({ to, title, body, sound: "default", channelId: "meetings" }))),
  }).catch((e) => console.warn("push failed", e));
}

bot.on("notify", async (n) => {
  const { notify } = await settings.read();
  if (n.title === "Joined" && !notify.joined) return;
  if (n.title === "In the waiting room" && !notify.waitingRoom) return;
  void push(n.title, n.body);
});
bot.on("state", (s) => {
  if (s.meetingId && s.phase === "in-meeting") void control.patchMeeting(s.meetingId, { status: "live" });
});
bot.on("finished", async (f) => {
  await control.patchMeeting(f.meeting.id, { status: f.outcome, note: f.note });
  const release = idle.hold("delivery");
  try {
    const r = await delivery.deliver(f);
    const bits = [
      f.outcome === "failed" && f.note ? f.note : null,
      `${f.shots.length} screenshots`,
      r.driveFolderUrl ? "saved to Drive" : null,
      r.emailed ? "emailed" : null,
      r.errors.length ? `⚠️ ${r.errors.join("; ")}` : null,
    ].filter(Boolean);
    if ((await settings.read()).notify.finished) void push(f.outcome === "done" ? "Meeting finished" : "Meeting didn't complete", `${f.meeting.title}: ${bits.join(" · ")}`);
    if (r.errors.length) await control.patchMeeting(f.meeting.id, { note: r.errors.join("; ") });
  } finally {
    release();
  }
});

async function syncLoop() {
  try {
    const { due } = await control.sync();
    for (const id of due) {
      if (!handled.has(id) && !bot.busy) {
        void joinMeeting(id).catch((e) => console.error("join", e));
        break;
      }
    }
    // A "Join now" press on an already-handled meeting means "join again".
    for (const m of control.meetings)
      if (m.joinNowAt && handled.has(m.id) && Date.now() - Date.parse(m.joinNowAt) < 60_000 && !bot.busy) {
        handled.delete(m.id);
      }
  } catch (e) {
    console.warn("sync failed:", (e as Error).message);
  }
}

const app = await buildServer({ cfg, control, bot, idle, google, delivery, settings, activity, accounts, onSettings: applySettings, joinMeeting });
await app.listen({ host: "127.0.0.1", port: cfg.port });
console.log(`CloudPilot agent on 127.0.0.1:${cfg.port} for https://${cfg.fqdn}`);

idle.start();
await syncLoop();
setInterval(() => void syncLoop(), 30_000).unref();
setInterval(async () => void delivery.prune(join(cfg.dataDir, "meetings"), (await settings.read()).pruneAfterDays), 6 * 3600_000).unref();

for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, async () => {
    if (bot.busy) await bot.command({ type: "leave" }).catch(() => undefined);
    await app.close();
    process.exit(0);
  });

// A minute after boot, make sure the accounts needed by upcoming meetings are still signed in,
// so you hear about an expired Teams login before the class — not when the bot fails to join.
setTimeout(async () => {
  const needed = new Set(
    control.meetings
      .filter((m) => m.joinAs === "profile" && Date.parse(m.endAt) > Date.now())
      .map((m) => (m.platform === "meet" ? "google" : m.platform))
      .filter((p): p is "teams" | "zoom" | "google" => p === "teams" || p === "zoom" || p === "google"),
  );
  for (const p of needed) {
    if (bot.busy) return;
    const s = await accounts.check(p).catch(() => null);
    if (s && s.signedIn === false)
      void push("Sign-in needed", `The machine is signed out of ${p === "teams" ? "Microsoft Teams" : p}. Open the app → Settings → Meeting accounts.`);
  }
}, 60_000).unref();
