import { VM_SIZES, type Meeting, type VmSize } from "@cloudpilot/shared";
import { useEffect, useState } from "react";
import { useApi, useAction, usePoll } from "../api";
import { BotChip, Icon, PowerChip, fmtDay, fmtDuration, fmtTime } from "../ui";

export function Overview({ go }: { go: (r: string) => void }) {
  const { client } = useApi();
  const vm = usePoll(() => client!.vmStatus(), 8000);
  const usage = usePoll(() => client!.usage(), 60_000);
  const meetings = usePoll(() => client!.listMeetings(), 60_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const agent = usePoll(running ? () => client!.agentStatus() : null, 8000, [running]);
  const { busy, run } = useAction();
  // On but not answering for 6+ minutes: say so instead of "Starting…" forever.
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  const on = vm.data?.power === "running";
  useEffect(() => {
    if (on && !running) setWaitingSince((w) => w ?? Date.now());
    else setWaitingSince(null);
  }, [on, running]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const stuck = waitingSince !== null && Date.now() - waitingSince > 6 * 60_000;

  const next: Meeting | undefined = meetings.data?.find((m) => Date.parse(m.endAt) > Date.now() && m.status !== "cancelled");
  const size = vm.data?.size as VmSize | undefined;
  const u = usage.data;
  const pct = u ? Math.min(100, (u.monthToDateUsd / Math.max(u.budgetUsd, 0.01)) * 100) : 0;
  const hoursLeft = u && size && VM_SIZES[size] ? Math.max(0, (u.budgetUsd - u.monthToDateUsd) / VM_SIZES[size].usdPerHour) : null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Your machine</h1>
          <span className="sub">{vm.data?.fqdn ?? (vm.data ? `${vm.data.region} · stopped` : "Connecting…")}</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {vm.data?.power === "running" ? (
            <>
              <select
                className="btn btn-secondary"
                aria-label="Keep the machine on"
                disabled={busy || !running}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  let hours: number | "forever" | null = v === "forever" ? "forever" : v === "custom" ? null : Number(v);
                  if (v === "custom") {
                    const n = Number(prompt("Keep it on for how many hours? (1–24)") ?? "");
                    if (!(n >= 1 && n <= 24)) return;
                    hours = Math.round(n);
                  }
                  if (hours === null) return;
                  void run(
                    async () => (await client!.keepOn(hours), agent.reload()),
                    hours === "forever" ? "Stays on until you press Stop" : hours === 0 ? "Keep-on cancelled" : `Kept on for ${hours} h`,
                  );
                }}
              >
                <option value="" disabled>
                  Keep on…
                </option>
                <option value="1">1 hour</option>
                <option value="2">2 hours</option>
                <option value="3">3 hours</option>
                <option value="6">6 hours</option>
                <option value="custom">Custom…</option>
                <option value="forever">Until I stop it</option>
                {(agent.data?.idle.keepOnUntil || agent.data?.idle.keepOnForever) && <option value="0">Cancel keep-on</option>}
              </select>
              <button className="btn btn-danger" disabled={busy} onClick={() => run(async () => (await client!.vmStop(), vm.reload()), "Stopping…")}>
                <Icon name="power" /> Stop
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={busy || vm.data?.power === "starting"} onClick={() => run(async () => (await client!.vmStart(), vm.reload()), "Starting — about a minute")}>
              <Icon name="power" /> Start machine
            </button>
          )}
        </div>
      </header>
      {vm.error && <div className="error">{vm.error}</div>}

      <div className="grid">
        <section className="card">
          <span className="label">Machine</span>
          <PowerChip power={vm.data?.power} />
          <span className="sub">
            {vm.data?.power === "running"
              ? `On for ${fmtDuration(vm.data.since)}${
                  agent.data?.idle.keepOnForever
                    ? " · stays on until you press Stop"
                    : agent.data?.idle.keepOnUntil
                      ? ` · kept on until ${fmtTime(agent.data.idle.keepOnUntil)}`
                      : agent.data?.idle.shutdownInMinutes != null
                        ? ` · stops in ${agent.data.idle.shutdownInMinutes} min if idle`
                        : ""
                }`
              : "Costs nothing while stopped (just the disk)."}
          </span>
          {vm.data?.power === "running" && !running && (
            <span className="sub" style={{ color: stuck ? "var(--warn-text)" : undefined }}>
              {stuck
                ? "The machine is on, but CloudPilot on it isn't answering. Stop it to save credit, then repair it from Azure Cloud Shell (Troubleshooting in the self-hosting guide)."
                : "Starting services… (about 1–2 minutes)"}
            </span>
          )}
          {size && <span className="sub">{VM_SIZES[size]?.label ?? size}</span>}
        </section>
        <section className="card">
          <span className="label">This month</span>
          <span className="big">
            ${u?.monthToDateUsd.toFixed(2) ?? "–"} <span className="sub">of ${u?.budgetUsd ?? "–"}</span>
          </span>
          <div className="bar" aria-label={`${pct.toFixed(0)}% of budget used`}>
            <div style={{ width: `${pct}%`, background: pct > 85 ? "var(--danger)" : undefined }} />
          </div>
          <span className="sub">{hoursLeft != null ? `≈ ${Math.floor(hoursLeft)} h of runtime left` : ""}</span>
        </section>
        <section className="card">
          <span className="label">Bot</span>
          {agent.data ? <BotChip bot={agent.data.bot} /> : <span className="chip">Machine off</span>}
          <span className="sub">
            {agent.data ? `${agent.data.diskFreeGb ?? "?"} GB free · Google ${agent.data.google.connected ? "connected" : "not connected"}` : "Start the machine to see live status."}
          </span>
        </section>
      </div>

      <section className="card">
        <div className="page-head">
          <h2>Next meeting</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => go("meetings")}>
            All meetings
          </button>
        </div>
        {next ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ font: "600 19px var(--display)" }}>{next.title}</div>
              <span className="sub">
                {fmtDay(next.startAt)} {fmtTime(next.startAt)} – {fmtTime(next.endAt)} · {next.platform} · auto-join {next.autoJoin ? "on" : "off"}
              </span>
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => (await client!.joinNow(next.id), go("live")), "Joining — starting the machine if needed")}>
              Join now
            </button>
          </div>
        ) : (
          <div className="empty">No upcoming meetings. Add one or import your calendar.</div>
        )}
      </section>
    </>
  );
}
