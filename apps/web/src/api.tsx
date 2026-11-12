import { CloudPilotClient, palette, type ThemeName } from "@cloudpilot/shared";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface Session {
  controlUrl: string;
  token: string;
  expiresAt: string;
}

const KEY = "cloudpilot.session";
const PREFS = "cloudpilot.prefs";

function loadSession(): Session | null {
  try {
    localStorage.removeItem(KEY); // older versions kept it here
    // Per-tab storage: the session ends when the tab closes and is never shared across tabs.
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null;
    if (s && Date.parse(s.expiresAt) > Date.now()) return s;
  } catch {
    /* ignore */
  }
  return null;
}

interface Ctx {
  client: CloudPilotClient | null;
  session: Session | null;
  signIn: (s: Session) => void;
  signOut: () => void;
  theme: ThemeName;
  accent: string;
  setTheme: (t: ThemeName) => void;
  setAccent: (a: string) => void;
  toast: (msg: string) => void;
}

const C = createContext<Ctx | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [prefs, setPrefs] = useState<{ theme: ThemeName; accent: string }>(() => {
    try {
      return { theme: "dark", accent: "#6553F5", ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") };
    } catch {
      return { theme: "dark", accent: "#6553F5" };
    }
  });
  const [msg, setMsg] = useState<string | null>(null);
  const client = session ? new CloudPilotClient({ controlUrl: session.controlUrl, token: session.token }) : null;
  const clientRef = useRef(client);
  if (clientRef.current?.token !== client?.token) clientRef.current = client;

  useEffect(() => {
    const p = palette(prefs.theme, prefs.accent);
    const r = document.documentElement.style;
    const map: Record<string, string> = {
      "--bg": p.bg, "--surface": p.surface, "--surface2": p.surface2, "--border": p.border, "--border-strong": p.borderStrong,
      "--text": p.text, "--muted": p.textMuted, "--subtle": p.textSubtle, "--accent": p.accent, "--accent-text": p.accentText,
      "--ok": p.ok, "--ok-text": p.okText, "--ok-bg": p.okBg, "--warn-text": p.warnText, "--warn-bg": p.warnBg,
      "--danger-text": p.dangerText, "--danger-bg": p.dangerBg, "--danger-solid": p.dangerSolid,
    };
    for (const [k, v] of Object.entries(map)) r.setProperty(k, v);
    r.setProperty("color-scheme", prefs.theme === "light" ? "light" : "dark");
    try {
      localStorage.setItem(PREFS, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const toast = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3500);
  }, []);

  const value: Ctx = {
    client: clientRef.current,
    session,
    signIn: (s) => {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        /* ignore */
      }
      setSession(s);
    },
    signOut: () => {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      setSession(null);
    },
    theme: prefs.theme,
    accent: prefs.accent,
    setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
    setAccent: (accent) => setPrefs((p) => ({ ...p, accent })),
    toast,
  };
  return (
    <C.Provider value={value}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </C.Provider>
  );
}

export function useApi() {
  const c = useContext(C);
  if (!c) throw new Error("useApi outside provider");
  return c;
}

/** Poll an async loader; returns data, error and a manual reload. */
export function usePoll<T>(load: (() => Promise<T>) | null, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!load) return;
    let alive = true;
    const run = () =>
      load()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    void run();
    const t = ms > 0 ? setInterval(run, ms) : null;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, reload: () => setTick((x) => x + 1) };
}

/** Run an action with a busy flag and a toast on failure. */
export function useAction() {
  const { toast } = useApi();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
