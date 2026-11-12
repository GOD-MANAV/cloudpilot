import { ACCENTS, VM_SIZES, type AgentSettings, type VmSize } from "@cloudpilot/shared";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAction, usePoll } from "../../src/hooks";
import { Cols, MaxWidth } from "../../src/layout";
import { useSession } from "../../src/session";
import { Btn, Card, Chip, Empty, F, Row, Seg, T, Toggle } from "../../src/ui";

function Stepper({ value, options, onChange, fmt, label }: { value: number; options: number[]; onChange: (n: number) => void; fmt: (n: number) => string; label: string }) {
  const { c } = useSession();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, gap: 10 }}>
      <T style={{ flex: 1 }}>{label}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: 220 }} contentContainerStyle={{ gap: 6 }}>
        {options.map((o) => (
          <Pressable
            key={o}
            accessibilityRole="radio"
            accessibilityState={{ checked: o === value }}
            accessibilityLabel={`${label}: ${fmt(o)}`}
            onPress={() => onChange(o)}
            style={{ minHeight: 36, paddingHorizontal: 10, borderRadius: 10, justifyContent: "center", backgroundColor: o === value ? c.accent : c.surface2 }}
          >
            <T style={{ fontFamily: F.semi, fontSize: 13, color: o === value ? c.onAccent : c.textMuted }}>{fmt(o)}</T>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default function Settings() {
  const { client, c, prefs, setPrefs, signOut } = useSession();
  const vm = usePoll(() => client!.vmStatus(), 20_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const stopped = vm.data?.power === "deallocated" || vm.data?.power === "stopped";
  const remote = usePoll(running ? () => client!.getSettings() : null, 0, [running]);
  const google = usePoll(running ? () => client!.googleStatus() : null, 0, [running]);
  const [s, setS] = useState<AgentSettings | null>(null);
  const [gid, setGid] = useState("");
  const [gsec, setGsec] = useState("");
  const { busy, run } = useAction();
  useEffect(() => {
    setS(remote.data);
    setGid(remote.data?.google?.clientId ?? "");
  }, [remote.data]);

  const save = (patch: Partial<AgentSettings>) => run(async () => setS(await client!.putSettings(patch)));
  const input = { height: 48, borderRadius: 14, borderWidth: 1, borderColor: c.borderStrong, color: c.text, paddingHorizontal: 12, fontFamily: F.medium } as const;
  const al = s?.autoLeave;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <MaxWidth>
          <T v="h1">Settings</T>
          <Cols>
            <View style={{ gap: 14 }}>
              <Card>
                <T v="label">Appearance</T>
                <Seg
                  value={prefs.theme}
                  onChange={(theme) => setPrefs({ theme })}
                  options={[
                    { v: "system", label: "Auto" },
                    { v: "dark", label: "Dark" },
                    { v: "light", label: "Light" },
                    { v: "amoled", label: "AMOLED" },
                  ]}
                />
                <View style={{ flexDirection: "row", gap: 12 }} accessibilityRole="radiogroup">
                  {ACCENTS.map((a) => (
                    <Pressable
                      key={a.value}
                      accessibilityRole="radio"
                      accessibilityLabel={a.name}
                      accessibilityState={{ checked: prefs.accent === a.value }}
                      onPress={() => setPrefs({ accent: a.value })}
                      style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: a.value, borderWidth: 3, borderColor: prefs.accent === a.value ? c.text : c.surface }}
                    />
                  ))}
                </View>
              </Card>

              <Card style={{ gap: 0 }}>
                <T v="label" style={{ marginBottom: 4 }}>
                  Security
                </T>
                <Row first title="Fingerprint / face lock" sub="Ask on launch and after 5 min away" right={<Toggle value={prefs.biometricLock} onChange={(v) => setPrefs({ biometricLock: v })} label="Fingerprint lock" />} />
                <Row title="Devices and access links" sub="See and revoke sessions" onPress={() => router.push("/ai")} />
                <Row
                  title="Sign out of this phone"
                  onPress={() =>
                    Alert.alert("Sign out?", "You'll need the pairing QR and an authenticator code to sign in again.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
                    ])
                  }
                />
              </Card>

              <Card>
                <T v="label">Machine</T>
                <T v="sub">Size {stopped ? "" : "(stop the machine to change it)"}</T>
                {Object.entries(VM_SIZES).map(([k, v]) => (
                  <Pressable
                    key={k}
                    disabled={!stopped || busy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: vm.data?.size === k, disabled: !stopped }}
                    onPress={() => run(async () => (await client!.vmResize(k as VmSize), vm.reload()))}
                    style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, borderRadius: 14, borderWidth: 1, borderColor: vm.data?.size === k ? c.accent : c.border, opacity: stopped ? 1 : 0.6 }}
                  >
                    <T>{v.label}</T>
                    <T v="sub">${v.usdPerHour.toFixed(3)}/h</T>
                  </Pressable>
                ))}
                {s && (
                  <Stepper
                    label="Stop when idle after"
                    value={s.idleMinutes ?? 20}
                    options={[10, 20, 30, 60, 120, 0]}
                    fmt={(n) => (n === 0 ? "Never" : `${n} min`)}
                    onChange={(n) => save({ idleMinutes: n })}
                  />
                )}
                <Btn
                  small
                  kind="secondary"
                  label="Allow going over budget this month"
                  onPress={() =>
                    Alert.alert("Override budget?", "The machine will be allowed to start even though this month's budget is used up.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Allow", onPress: () => run(() => client!.overrideBudget()) },
                    ])
                  }
                />
              </Card>
            </View>

            <View style={{ gap: 14 }}>
              {!running || !s ? (
                <Empty text="Start the machine to change meeting, delivery and notification settings — they're stored on the machine." />
              ) : (
                <>
                  <Card>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <T v="h3" style={{ flex: 1 }}>
                        Auto-leave when people go
                      </T>
                      <Toggle value={al!.enabled} onChange={(v) => save({ autoLeave: { ...al!, enabled: v } })} label="Auto-leave when people go" />
                    </View>
                    <T v="sub">Besides leaving when Teams ends the call, CloudPilot leaves once only a few people remain — for when the host forgets to end it.</T>
                    <View style={{ opacity: al!.enabled ? 1 : 0.5 }} pointerEvents={al!.enabled ? "auto" : "none"}>
                      <Stepper label="When people left ≤" value={al!.minPeople} options={[1, 2, 3, 4, 5, 8, 10]} fmt={(n) => String(n)} onChange={(n) => save({ autoLeave: { ...al!, minPeople: n } })} />
                      <Stepper label="…or headcount drops to" value={al!.dropFraction} options={[0.1, 0.2, 0.25, 0.33, 0.5]} fmt={(n) => `${Math.round(n * 100)}%`} onChange={(n) => save({ autoLeave: { ...al!, dropFraction: n } })} />
                      <Stepper label="For at least" value={al!.graceMinutes} options={[1, 2, 3, 5, 10]} fmt={(n) => `${n} min`} onChange={(n) => save({ autoLeave: { ...al!, graceMinutes: n } })} />
                      <Stepper label="Ignore the first" value={al!.warmupMinutes} options={[0, 5, 10, 15, 20]} fmt={(n) => `${n} min`} onChange={(n) => save({ autoLeave: { ...al!, warmupMinutes: n } })} />
                    </View>
                  </Card>

                  <Card style={{ gap: 0 }}>
                    <T v="label" style={{ marginBottom: 4 }}>
                      Notifications
                    </T>
                    {(
                      [
                        ["joined", "Bot joined a meeting"],
                        ["waitingRoom", "Waiting to be admitted"],
                        ["finished", "Meeting finished + notes sent"],
                        ["aiActivity", "An AI started using the machine"],
                      ] as const
                    ).map(([k, label], i) => (
                      <Row key={k} first={i === 0} title={label} right={<Toggle value={s.notify[k]} onChange={(v) => save({ notify: { ...s.notify, [k]: v } })} label={label} />} />
                    ))}
                  </Card>

                  <Card>
                    <T v="label">Meeting accounts & camera photo</T>
                    <T v="sub">Sign in to Microsoft Teams (and Zoom/Google) once in the machine's own Chrome so the bot joins as you. Passwords never touch CloudPilot.</T>
                    <Btn icon="monitor" label="Open sign-in browser" busy={busy} onPress={() => run(async () => (await client!.botSignIn("https://teams.microsoft.com/"), router.push("/desktop")))} />
                    <Btn
                      kind="secondary"
                      icon="image"
                      label="Choose camera-off photo"
                      onPress={() =>
                        run(async () => {
                          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [16, 9], quality: 0.85 });
                          const a = r.assets?.[0];
                          if (r.canceled || !a) return;
                          const blob = await (await fetch(a.uri)).blob();
                          await client!.uploadPresenceImage(blob, a.mimeType === "image/png" ? "image/png" : "image/jpeg");
                        })
                      }
                    />
                  </Card>

                  <Card>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <T v="label">Google Drive & Gmail</T>
                      {google.data?.connected ? <Chip tone="ok" label="Connected" /> : <Chip label="Not connected" />}
                    </View>
                    <T v="sub">Your own OAuth client (Web application). Redirect URI:</T>
                    <T v="mono">{google.data?.redirectUri}</T>
                    <TextInput style={input} placeholder="Client ID" placeholderTextColor={c.textSubtle} autoCapitalize="none" value={gid} onChangeText={setGid} />
                    <TextInput style={input} placeholder={s.google ? "Client secret (unchanged)" : "Client secret"} placeholderTextColor={c.textSubtle} autoCapitalize="none" secureTextEntry value={gsec} onChangeText={setGsec} />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Btn style={{ flex: 1 }} kind="secondary" label="Save" disabled={!gid} onPress={() => save({ google: { clientId: gid.trim(), clientSecret: gsec.trim() || "••••" } })} />
                      {google.data?.connected ? (
                        <Btn style={{ flex: 1 }} kind="danger" label="Disconnect" onPress={() => run(async () => (await client!.googleDisconnect(), google.reload()))} />
                      ) : (
                        <Btn style={{ flex: 1 }} label="Connect" disabled={!s.google} onPress={() => run(async () => void Linking.openURL((await client!.googleConnect()).url))} />
                      )}
                    </View>
                    <TextInput
                      style={input}
                      placeholder={`Send notes to (default: ${google.data?.email ?? "your Google account"})`}
                      placeholderTextColor={c.textSubtle}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      defaultValue={s.emailTo ?? ""}
                      onEndEditing={(e) => e.nativeEvent.text !== (s.emailTo ?? "") && save({ emailTo: e.nativeEvent.text || undefined })}
                    />
                  </Card>

                  <Card>
                    <T v="label">Recording & storage</T>
                    <Stepper label="Recording smoothness" value={s.recordingFps} options={[4, 8, 12, 15, 24]} fmt={(n) => `${n} fps`} onChange={(n) => save({ recordingFps: n })} />
                    <Stepper label="Delete local copy after upload" value={s.pruneAfterDays} options={[0, 1, 3, 7, 30]} fmt={(n) => (n === 0 ? "Never" : `${n} d`)} onChange={(n) => save({ pruneAfterDays: n })} />
                    <T v="sub">Lower fps uses less CPU on the small machine; 8 fps is plenty for slides.</T>
                  </Card>
                </>
              )}
            </View>
          </Cols>
        </MaxWidth>
      </ScrollView>
    </SafeAreaView>
  );
}
