import { join } from "node:path";
import type { Meeting } from "@cloudpilot/shared";
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
const idle = new IdleWatch(cfg.idleMinutes);
const bot = new BotRunner(cfg, idle, () => settings.read());
const google = new Google(cfg.dataDir, cfg.fqdn, async () => (await settings.read()).google);
const delivery = new Delivery(google, () => settings.read());
const activity = new ActivityLog();

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

async function push(title: string, body: string) {
  const { pushTokens } = await settings.read();
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

const app = await buildServer({ cfg, control, bot, idle, google, delivery, settings, activity, onSettings: applySettings, joinMeeting });
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
