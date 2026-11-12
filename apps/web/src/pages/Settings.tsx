import { ACCENTS, VM_SIZES, type AgentSettings, type ThemeName, type VmSize } from "@cloudpilot/shared";
import { useEffect, useState } from "react";
import { useApi, useAction, usePoll } from "../api";

export function Settings() {
  const { client, theme, accent, setTheme, setAccent, signOut } = useApi();
  const vm = usePoll(() => client!.vmStatus(), 20_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const stopped = vm.data?.power === "deallocated" || vm.data?.power === "stopped";
  const settings = usePoll(running ? () => client!.getSettings() : null, 0, [running]);
  const google = usePoll(running ? () => client!.googleStatus() : null, 0, [running]);
  const accounts = usePoll(running ? () => client!.accounts() : null, 0, [running]);
  const { busy, run } = useAction();
  const [s, setS] = useState<AgentSettings | null>(null);
  useEffect(() => setS(settings.data), [settings.data]);

  const save = (patch: Partial<AgentSettings>) => run(async () => setS(await client!.putSettings(patch)), "Saved");

  return (
    <>
      <header className="page-head">
        <h1>Settings</h1>
        <button className="btn btn-secondary" onClick={signOut}>
          Sign out
        </button>
      </header>

      <section className="card">
        <h2>Appearance</h2>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <div className="seg" role="radiogroup" aria-label="Theme">
            {(["dark", "light", "amoled"] as ThemeName[]).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} onClick={() => setTheme(t)}>
                {t === "amoled" ? "AMOLED" : t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Accent colour" style={{ display: "flex", gap: 10 }}>
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                role="radio"
                aria-checked={accent === a.value}
                aria-label={a.name}
                onClick={() => setAccent(a.value)}
                style={{ width: 34, height: 34, borderRadius: "50%", padding: 0, background: a.value, border: `3px solid ${accent === a.value ? "var(--text)" : "var(--surface)"}` }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Machine</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="field" style={{ minWidth: 260 }}>
            <span>Size {stopped ? "" : "(stop the machine to change)"}</span>
            <select
              value={vm.data?.size ?? ""}
              disabled={!stopped || busy}
              onChange={(e) => run(async () => (await client!.vmResize(e.target.value as VmSize), vm.reload()), "Size changed")}
            >
              {Object.entries(VM_SIZES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label} — ${v.usdPerHour.toFixed(3)}/h
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-secondary" disabled={busy} onClick={() => confirm("Allow starting past this month's budget?") && run(() => client!.overrideBudget(), "Budget override on for this month")}>
            Allow over budget this month
          </button>
        </div>
      </section>

      {!running ? (
        <div className="empty">Start the machine to change delivery, Google and meeting defaults (they're stored on the machine).</div>
      ) : (
        s && (
          <>
            <section className="card">
              <h2>Meeting accounts</h2>
              <span className="sub">
                Sign in to Google, Microsoft or Zoom once in the machine's own Chrome. The bot then joins as you, including org-only meetings. Your passwords never touch CloudPilot.
              </span>
              {(accounts.data ?? []).map((a) => (
                <div key={a.platform} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--surface2)", paddingTop: 10 }}>
                  <div style={{ flex: "1 1 220px" }}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <span className={`chip ${a.signedIn ? "ok" : a.signedIn === false ? "warn" : ""}`}>
                      {a.signedIn ? "Signed in" : a.signedIn === false ? "Sign-in needed" : "Not checked"}
                    </span>
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => (await client!.signInAccount(a.platform), window.open(await client!.desktopUrl(), "_blank", "noopener")))}>
                    Sign in on the machine
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(async () => (await client!.checkAccount(a.platform), accounts.reload()))}>
                    Check
                  </button>
                </div>
              ))}
              <label className="field">
                <span>Photo shown when camera mode is Photo</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  style={{ paddingTop: 9 }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void run(() => client!.uploadPresenceImage(f, f.type === "image/png" ? "image/png" : "image/jpeg"), "Photo updated");
                  }}
                />
              </label>
            </section>

            <form
              className="card"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void save({
                  google: { clientId: String(fd.get("cid")), clientSecret: String(fd.get("csec")) || "••••" },
                  emailTo: String(fd.get("to")) || undefined,
                });
              }}
            >
              <h2>Google Drive and Gmail</h2>
              <span className="sub">
                Use your own Google Cloud OAuth client (Web application). Redirect URI: <code>{google.data?.redirectUri}</code>. Publish the consent screen so access doesn't expire after 7 days.
              </span>
              <div className="grid">
                <label className="field">
                  <span>Client ID</span>
                  <input name="cid" defaultValue={s.google?.clientId ?? ""} required />
                </label>
                <label className="field">
                  <span>Client secret</span>
                  <input name="csec" type="password" placeholder={s.google ? "•••• (unchanged)" : ""} />
                </label>
                <label className="field">
                  <span>Send notes to</span>
                  <input name="to" type="email" defaultValue={s.emailTo ?? ""} placeholder={google.data?.email ?? "you@example.com"} />
                </label>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn btn-secondary" disabled={busy}>
                  Save
                </button>
                {google.data?.connected ? (
                  <>
                    <span className="chip ok">Connected{google.data.email ? ` · ${google.data.email}` : ""}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(async () => (await client!.googleDisconnect(), google.reload()), "Disconnected")}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={busy || !s.google} onClick={() => run(async () => window.open((await client!.googleConnect()).url, "_blank", "noopener"))}>
                    Connect Google
                  </button>
                )}
              </div>
            </form>

            <form
              className="card"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void save({
                  smtp: {
                    host: String(fd.get("host")),
                    port: Number(fd.get("port")),
                    secure: Number(fd.get("port")) === 465,
                    user: String(fd.get("user")),
                    pass: String(fd.get("pass")) || "••••",
                  },
                });
              }}
            >
              <h2>Email without Google (SMTP)</h2>
              <div className="grid">
                <label className="field">
                  <span>Server</span>
                  <input name="host" defaultValue={s.smtp?.host ?? "smtp.gmail.com"} required />
                </label>
                <label className="field">
                  <span>Port</span>
                  <input name="port" type="number" defaultValue={s.smtp?.port ?? 465} required />
                </label>
                <label className="field">
                  <span>Username</span>
                  <input name="user" defaultValue={s.smtp?.user ?? ""} required />
                </label>
                <label className="field">
                  <span>App password</span>
                  <input name="pass" type="password" placeholder={s.smtp ? "•••• (unchanged)" : ""} />
                </label>
              </div>
              <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={busy}>
                Save SMTP
              </button>
            </form>

            <section className="card">
              <div className="page-head">
                <h2>Auto-leave when people go</h2>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={s.autoLeave.enabled}
                  aria-label="Auto-leave when people go"
                  onClick={() => save({ autoLeave: { ...s.autoLeave, enabled: !s.autoLeave.enabled } })}
                />
              </div>
              <span className="sub">
                Besides leaving when the meeting ends, CloudPilot leaves once only a few people remain. Handy when the host forgets to end a Teams
                call.
              </span>
              <div className="grid">
                <label className="field">
                  <span>Leave when this many or fewer remain</span>
                  <select value={s.autoLeave.minPeople} disabled={!s.autoLeave.enabled} onChange={(e) => save({ autoLeave: { ...s.autoLeave, minPeople: Number(e.target.value) } })}>
                    {[1, 2, 3, 4, 5, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "(only me)" : "people"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>…or when headcount drops to</span>
                  <select value={s.autoLeave.dropFraction} disabled={!s.autoLeave.enabled} onChange={(e) => save({ autoLeave: { ...s.autoLeave, dropFraction: Number(e.target.value) } })}>
                    {[0.1, 0.2, 0.25, 0.33, 0.5].map((n) => (
                      <option key={n} value={n}>
                        {Math.round(n * 100)}% of the peak
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>For at least</span>
                  <select value={s.autoLeave.graceMinutes} disabled={!s.autoLeave.enabled} onChange={(e) => save({ autoLeave: { ...s.autoLeave, graceMinutes: Number(e.target.value) } })}>
                    {[1, 2, 3, 5, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} min
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Ignore the first</span>
                  <select value={s.autoLeave.warmupMinutes} disabled={!s.autoLeave.enabled} onChange={(e) => save({ autoLeave: { ...s.autoLeave, warmupMinutes: Number(e.target.value) } })}>
                    {[0, 5, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} min (people still joining)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="card">
              <h2>Defaults</h2>
              <div className="grid">
                <label className="field">
                  <span>Recording frames per second</span>
                  <select value={s.recordingFps} onChange={(e) => save({ recordingFps: Number(e.target.value) })}>
                    {[4, 8, 12, 15, 24].map((n) => (
                      <option key={n} value={n}>
                        {n} fps{n <= 8 ? " · light on CPU" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Delete local recordings after upload</span>
                  <select value={s.pruneAfterDays} onChange={(e) => save({ pruneAfterDays: Number(e.target.value) })}>
                    {[0, 1, 3, 7, 30].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "Never" : `${n} days`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Guest name</span>
                  <input defaultValue={s.defaultGuestName} onBlur={(e) => e.target.value !== s.defaultGuestName && save({ defaultGuestName: e.target.value })} />
                </label>
              </div>
            </section>
          </>
        )
      )}
    </>
  );
}
