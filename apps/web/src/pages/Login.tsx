import { CloudPilotClient, parsePairingUri } from "@cloudpilot/shared";
import { useState, type FormEvent } from "react";
import { useApi } from "../api";
import { Logo } from "../ui";

export function Login() {
  const { signIn } = useApi();
  const [controlUrl, setControlUrl] = useState("");
  const [ownerKey, setOwnerKey] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPaste = (v: string) => {
    const p = parsePairingUri(v.trim());
    if (p) {
      setControlUrl(p.controlUrl);
      setOwnerKey(p.ownerToken);
    } else setOwnerKey(v);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = controlUrl.trim().replace(/\/$/, "");
      const r = await CloudPilotClient.login({
        controlUrl: url,
        ownerToken: ownerKey.trim(),
        code,
        deviceName: navigator.userAgent.includes("Windows") ? "Windows browser" : "Browser",
        kind: "web",
      });
      signIn({ controlUrl: url, token: r.token, expiresAt: r.info.expiresAt });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo size={44} />
          <div>
            <h1 style={{ fontSize: 26 }}>CloudPilot</h1>
            <span className="sub">Sign in to your cloud computer</span>
          </div>
        </div>
        <label className="field">
          <span>Control URL</span>
          <input required type="url" placeholder="https://cloudpilot-ctl-….azurewebsites.net/api" value={controlUrl} onChange={(e) => setControlUrl(e.target.value)} />
        </label>
        <label className="field">
          <span>Owner key (or paste the pairing link)</span>
          <input required type="password" autoComplete="current-password" value={ownerKey} onChange={(e) => onPaste(e.target.value)} />
        </label>
        <label className="field">
          <span>6-digit code from your authenticator app</span>
          <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <span className="sub">This browser gets a 12-hour session you can revoke from AI access → Devices.</span>
      </form>
    </div>
  );
}
