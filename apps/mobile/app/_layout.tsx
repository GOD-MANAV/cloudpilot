import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono";
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { useFonts } from "expo-font";
import * as LocalAuthentication from "expo-local-authentication";
import { Redirect, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../src/session";
import { Btn, Logo, T } from "../src/ui";

void SplashScreen.preventAutoHideAsync();

/** Fingerprint / face lock on launch and after 5 minutes in the background. */
function LockGate({ children }: { children: React.ReactNode }) {
  const { prefs, session, c } = useSession();
  const [unlocked, setUnlocked] = useState(false);
  const bgAt = useRef<number | null>(null);
  const needLock = prefs.biometricLock && !!session;

  const unlock = async () => {
    const has = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (!has) return setUnlocked(true);
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock CloudPilot", fallbackLabel: "Use PIN" });
    if (r.success) setUnlocked(true);
  };

  useEffect(() => {
    if (needLock && !unlocked) void unlock();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") bgAt.current = Date.now();
      if (s === "active" && bgAt.current && Date.now() - bgAt.current > 5 * 60_000) {
        bgAt.current = null;
        setUnlocked(false);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needLock, unlocked]);

  if (!needLock || unlocked) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 }}>
      <Logo size={64} />
      <T v="h2">CloudPilot is locked</T>
      <Btn label="Unlock" icon="key" onPress={() => void unlock()} />
    </View>
  );
}

function Root() {
  const { ready, session, c, dark } = useSession();
  const segments = useSegments();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg);
  }, [c.bg]);
  if (!ready) return null;
  const onPair = segments[0] === "pair";
  if (!session && !onPair) return <Redirect href="/pair" />;
  return (
    <LockGate>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerTitleStyle: { fontFamily: "SpaceGrotesk_600SemiBold" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ headerShown: false }} />
        <Stack.Screen name="meeting-new" options={{ title: "New meeting", presentation: "modal" }} />
        <Stack.Screen name="notes" options={{ title: "Meeting notes" }} />
        <Stack.Screen name="desktop" options={{ title: "Live desktop" }} />
        <Stack.Screen name="terminal" options={{ title: "Terminal" }} />
        <Stack.Screen name="accounts" options={{ title: "Meeting accounts" }} />
      </Stack>
    </LockGate>
  );
}

export default function Layout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular,
  });
  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Root />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
