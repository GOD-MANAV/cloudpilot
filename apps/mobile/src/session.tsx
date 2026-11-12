import { CloudPilotClient, palette, type Palette, type ThemeName } from "@cloudpilot/shared";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export interface Session {
  controlUrl: string;
  token: string;
  expiresAt: string;
}
interface Prefs {
  theme: ThemeName | "system";
  accent: string;
  biometricLock: boolean;
}

const SESSION_KEY = "cp.session";
const PREFS_KEY = "cp.prefs";
const DEFAULT_PREFS: Prefs = { theme: "system", accent: "#6553F5", biometricLock: true };

interface Ctx {
  ready: boolean;
  session: Session | null;
  client: CloudPilotClient | null;
  signIn(s: Session): Promise<void>;
  signOut(): Promise<void>;
  prefs: Prefs;
  setPrefs(p: Partial<Prefs>): void;
  c: Palette;
  dark: boolean;
}

const C = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    void (async () => {
      try {
        const s = JSON.parse((await SecureStore.getItemAsync(SESSION_KEY)) ?? "null") as Session | null;
        if (s && Date.parse(s.expiresAt) > Date.now()) setSession(s);
        const p = JSON.parse((await SecureStore.getItemAsync(PREFS_KEY)) ?? "{}") as Partial<Prefs>;
        setPrefsState({ ...DEFAULT_PREFS, ...p });
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      void SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const theme: ThemeName = prefs.theme === "system" ? (scheme === "light" ? "light" : "dark") : prefs.theme;
  const client = useMemo(() => (session ? new CloudPilotClient({ controlUrl: session.controlUrl, token: session.token }) : null), [session]);

  const value: Ctx = {
    ready,
    session,
    client,
    signIn: async (s) => {
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
      setSession(s);
    },
    signOut: async () => {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      setSession(null);
    },
    prefs,
    setPrefs,
    c: palette(theme, prefs.accent),
    dark: theme !== "light",
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useSession() {
  const c = useContext(C);
  if (!c) throw new Error("useSession outside provider");
  return c;
}
