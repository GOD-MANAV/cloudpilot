import type { AccountInfo } from "@cloudpilot/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useAction, usePoll } from "../src/hooks";
import { Cols, MaxWidth } from "../src/layout";
import { useSession } from "../src/session";
import { Btn, Card, Chip, Empty, T } from "../src/ui";

/**
 * Meeting accounts. You sign in yourself, once, on the machine's own Chrome
 * (through the live desktop). The login stays on the machine's disk; CloudPilot
 * never sees or stores your password.
 */
export default function Accounts() {
  const { client, c } = useSession();
  const vm = usePoll(() => client!.vmStatus(), 20_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const list = usePoll(running ? () => client!.accounts() : null, 0, [running]);
  const { busy, run } = useAction();
  const [checking, setChecking] = useState<string | null>(null);

  const status = (a: AccountInfo) =>
    a.signedIn === true ? <Chip tone="ok" label={a.detail ? `Signed in · ${a.detail}` : "Signed in"} /> : a.signedIn === false ? <Chip tone="warn" label="Sign-in needed" /> : <Chip label="Not checked yet" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <MaxWidth>
        <Card>
          <T v="h3">How signing in works</T>
          <T v="sub">1. Tap “Sign in” below. The machine's Chrome opens the Microsoft (or Zoom/Google) sign-in page and the live desktop opens here.</T>
          <T v="sub">2. Type your institute email and password into that page — use the keyboard bar under the desktop if tapping the page doesn't bring up your keyboard.</T>
          <T v="sub">3. Approve the request in Microsoft Authenticator if asked, and choose “Stay signed in”.</T>
          <T v="sub">4. Come back and tap “Check”. The machine stays signed in for weeks; CloudPilot warns you before a meeting if it ever gets signed out.</T>
          <T v="sub" color={c.okText}>Your password goes only to Microsoft/Zoom/Google — CloudPilot never stores it.</T>
        </Card>
        {!running ? (
          <Empty text="Start the machine first — accounts live in its browser." />
        ) : (
          <Cols>
            {(list.data ?? []).map((a) => (
              <Card key={a.platform}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <T v="h3" style={{ flex: 1 }}>
                    {a.name}
                  </T>
                  {a.platform === "teams" && <Chip tone="accent" dot={false} label="Most used" />}
                </View>
                {status(a)}
                {a.checkedAt && <T v="sub">Checked {new Date(a.checkedAt).toLocaleString()}</T>}
                {a.tips.map((t) => (
                  <T key={t} v="sub">
                    • {t}
                  </T>
                ))}
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Btn
                    small
                    icon="monitor"
                    label={a.signedIn ? "Open" : "Sign in"}
                    disabled={busy}
                    onPress={() => run(async () => (await client!.signInAccount(a.platform), router.push("/desktop")))}
                  />
                  <Btn
                    small
                    kind="secondary"
                    label="Check"
                    busy={checking === a.platform}
                    onPress={() =>
                      run(async () => {
                        setChecking(a.platform);
                        try {
                          await client!.checkAccount(a.platform);
                          await list.reload();
                        } finally {
                          setChecking(null);
                        }
                      })
                    }
                  />
                  {a.signedIn && (
                    <Btn
                      small
                      kind="danger"
                      label="Sign out"
                      onPress={() =>
                        Alert.alert(`Sign the machine out of ${a.name}?`, "The bot will join as a guest until you sign in again.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Sign out", style: "destructive", onPress: () => run(async () => (await client!.signOutAccount(a.platform), list.reload())) },
                        ])
                      }
                    />
                  )}
                </View>
              </Card>
            ))}
          </Cols>
        )}
        <T v="sub">
          Don't want to sign in? Set a meeting to “Join as a guest” — most Teams and Zoom meetings let guests in by name (the organiser may need to admit them).
        </T>
      </MaxWidth>
    </ScrollView>
  );
}
