import type { TokenScope } from "@cloudpilot/shared";
import { useState } from "react";
import { useApi, useAction, usePoll } from "../api";
import { Icon } from "../ui";

const SCOPES: { id: TokenScope; label: string; hint: string }[] = [
  { id: "mcp", label: "MCP tools", hint: "run commands, read and write files" },
  { id: "terminal", label: "Terminal", hint: "interactive shell" },
  { id: "files", label: "Files", hint: "upload and download" },
  { id: "view", label: "Watch desktop", hint: "read-only live view" },
  { id: "machine", label: "Start / stop", hint: "power the machine" },
];
const TTLS = [
  { h: 1, label: "1 hour" },
  { h: 24, label: "1 day" },
  { h: 168, label: "7 days" },
];

function left(iso: string) {
  const h = (Date.parse(iso) - Date.now()) / 3600_000;
  if (h <= 0) return "expired";
  return h >= 48 ? `${Math.round(h / 24)} days left` : h >= 1 ? `${Math.round(h)} h left` : `${Math.round(h * 60)} min left`;
}

export function Access() {
  const { client, toast } = useApi();
  const tokens = usePoll(() => client!.listTokens(), 30_000);
  const vm = usePoll(() => client!.vmStatus(), 60_000);
  const { busy, run } = useAction();
  const [label, setLabel] = useState("Claude Code");
  const [scopes, setScopes] = useState<TokenScope[]>(["mcp"]);
  const [ttl, setTtl] = useState(24);
  const [created, setCreated] = useState<string | null>(null);

  const fqdn = vm.data?.fqdn ?? "<your-machine>.cloudapp.azure.com";
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Copied"));
  const active = (tokens.data ?? []).filter((t) => !t.revoked && Date.parse(t.expiresAt) > Date.now());
  const devices = active.filter((t) => t.id.startsWith("dev_"));
  const links = active.filter((t) => !t.id.startsWith("dev_") && t.id !== "agent");

  const cmd = created ? `claude mcp add --transport http cloudpilot https://${fqdn}/mcp --header "Authorization: Bearer ${created}"` : "";

  return (
    <>
      <header className="page-head">
        <div>
          <h1>AI access</h1>
          <span className="sub">Give Claude Code or any MCP client an expiring key to this machine.</span>
        </div>
      </header>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await client!.createToken({ label, scopes, ttlHours: ttl });
            setCreated(r.token);
            tokens.reload();
          });
        }}
      >
        <h2>New access link</h2>
        <label className="field">
          <span>Name</span>
          <input required value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <legend className="label" style={{ marginBottom: 8 }}>
            Can
          </legend>
          {SCOPES.map((s) => {
            const on = scopes.includes(s.id);
            return (
              <button
                type="button"
                key={s.id}
                aria-pressed={on}
                title={s.hint}
                className={`btn btn-sm ${on ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setScopes(on ? scopes.filter((x) => x !== s.id) : [...scopes, s.id])}
              >
                {s.label}
              </button>
            );
          })}
        </fieldset>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="seg" role="radiogroup" aria-label="Expires after">
            {TTLS.map((t) => (
              <button type="button" key={t.h} role="radio" aria-checked={ttl === t.h} onClick={() => setTtl(t.h)}>
                {t.label}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" disabled={busy || !scopes.length}>
            Create link
          </button>
        </div>
        {created && (
          <div className="card" style={{ background: "var(--bg)" }}>
            <span className="label">Shown once — copy it now</span>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <code style={{ flex: 1, wordBreak: "break-all", color: "var(--accent-text)" }}>{cmd}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(cmd)} aria-label="Copy Claude Code command">
                <Icon name="copy" size={16} />
              </button>
            </div>
            <span className="sub">For clients that can't send headers (e.g. a claude.ai custom connector):</span>
            <div style={{ display: "flex", gap: 8 }}>
              <code style={{ flex: 1, wordBreak: "break-all" }}>{`https://${fqdn}/mcp/${created}`}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(`https://${fqdn}/mcp/${created}`)} aria-label="Copy MCP URL">
                <Icon name="copy" size={16} />
              </button>
            </div>
          </div>
        )}
      </form>

      {[
        { title: "Access links", list: links, empty: "No active links." },
        { title: "Signed-in devices", list: devices, empty: "No device sessions." },
      ].map((g) => (
        <section className="card" key={g.title}>
          <h2>
            {g.title} · {g.list.length}
          </h2>
          {g.list.length === 0 && <span className="sub">{g.empty}</span>}
          {g.list.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 12, alignItems: "center", borderTop: "1px solid var(--surface2)", paddingTop: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{t.label}</div>
                <span className="sub">
                  {t.scopes.join(", ")} · {left(t.expiresAt)} · {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleString()}` : "never used"}
                </span>
              </div>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => run(async () => (await client!.revokeToken(t.id), tokens.reload()), "Revoked")}>
                Revoke
              </button>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
