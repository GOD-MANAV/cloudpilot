import { ACCENTS, VM_SIZES, hoursLeftAt, type AgentSettings, type VmSize } from "@cloudpilot/shared";
import * as Clipboard from "expo-clipboard";
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

function SizePicker({ label, value, deployed, disabled, onChange }: { label: string; value: string; deployed: string; disabled: boolean; onChange: (s: string) => void }) {
  const { c } = useSession();
  const options: [string, string, string][] = [
    ...(deployed in VM_SIZES ? [] : [[deployed, `As set up (${deployed})`, ""] as [string, string, string]]),
    ...Object.entries(VM_SIZES).map(([k, v]) => [k, k === deployed ? `${v.label} · as set up` : v.label, `$${v.usdPerHour.toFixed(3)}/h`] as [string, string, string]),
  ];
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <T style={{ fontFamily: F.semi }}>{label}</T>
      {options.map(([k, name, price]) => (
        <Pressable
          key={k}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === k }}
          onPress={() => value !== k && onChange(k)}
          style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: value === k ? c.accent : c.border }}
        >
          <T style={{ flex: 1 }}>{name}</T>
          <T v="sub">{price}</T>
        </Pressable>
      ))}
    </View>
  );
}

export default function Settings() {
  const { client, c, prefs, setPrefs, signOut } = useSession();
  const vm = usePoll(() => client!.vmStatus(), 20_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const profiles = usePoll(() => client!.vmProfiles(), 0);
  const usage = usePoll(() => client!.usage(), 60_000);
  const [advanced, setAdvanced] = useState(false);
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
                {vm.data && <T v="sub">Current size: {VM_SIZES[vm.data.size as VmSize]?.label ?? vm.data.size}</T>}
                <Row
                  first
                  title="Advanced: machine size"
                  sub={advanced ? "Applies each time the machine starts" : "Separate sizes for your work and for meetings"}
                  onPress={() => setAdvanced(!advanced)}
                  right={<T v="sub">{advanced ? "Hide" : "Show"}</T>}
                />
                {advanced && profiles.data && (
                  <View style={{ gap: 10 }}>
                    <SizePicker
                      label="When you start it (AI links, terminal, builds)"
                      value={profiles.data.dev}
                      deployed={profiles.data.deployed}
                      disabled={busy}
                      onChange={(dev) => run(async () => (await client!.setVmProfiles({ dev }), profiles.reload()))}
                    />
                    {usage.data && hoursLeftAt(profiles.data.dev, usage.data) !== null && (
                      <T v="sub">At this size, the rest of this month's budget covers about {Math.floor(hoursLeftAt(profiles.data.dev, usage.data)!)} hours.</T>
                    )}
                    {vm.data?.power === "running" && vm.data.size !== profiles.data.dev && (
                      <Btn
                        small
                        label="Restart at this size"
                        busy={busy}
                        onPress={() =>
                          Alert.alert("Restart at your work size?", "Running commands and terminals stop. It's back in about 2 minutes.", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Restart", onPress: () => run(async () => (await client!.vmRestart("dev"), vm.reload())) },
                          ])
                        }
                      />
                    )}
                    <SizePicker
                      label="For meetings (default: the size it was set up with)"
                      value={profiles.data.meetings}
                      deployed={profiles.data.deployed}
                      disabled={busy}
                      onChange={(meetings) => run(async () => (await client!.setVmProfiles({ meetings }), profiles.reload()))}
                    />
                    <T v="sub">
                      A running machine keeps its size until it next starts. Bigger sizes use the budget faster, and Azure for Students may refuse sizes above 4 vCPU; meetings then start at the current size.
                    </T>
                  </View>
                )}
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

                  <Card>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <T v="label">Phone notifications (ntfy)</T>
                      <Toggle value={s.ntfy.enabled} onChange={(v) => save({ ntfy: { ...s.ntfy, enabled: v } })} label="ntfy notifications" />
                    </View>
                    <T v="sub">Free, no account. Install the “ntfy” app from the Play Store, then tap Subscribe — alerts for joins, waiting rooms, finished meetings and AI activity arrive instantly.</T>
                    {s.ntfy.topic ? <T v="mono">{s.ntfy.topic}</T> : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Btn
                        style={{ flex: 1 }}
                        small
                        label="Subscribe in ntfy"
                        disabled={!s.ntfy.topic}
                        onPress={() => void Linking.openURL(`ntfy://${new URL(s.ntfy.server).host}/${s.ntfy.topic}`).catch(() => Linking.openURL("https://play.google.com/store/apps/details?id=io.heckel.ntfy"))}
                      />
                      <Btn style={{ flex: 1 }} small kind="secondary" label="Copy topic" disabled={!s.ntfy.topic} onPress={() => void Clipboard.setStringAsync(s.ntfy.topic ?? "")} />
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
                    <Row
                      title="Hide meeting titles in notifications"
                      right={<Toggle value={s.privateNotifications} onChange={(v) => save({ privateNotifications: v })} label="Hide meeting titles in notifications" />}
                    />
                    <T v="sub">Notifications pass through ntfy.sh and Expo. When this is on, they only say what happened, not which meeting or command.</T>
                  </Card>

                  <Card style={{ gap: 0 }}>
                    <T v="label" style={{ marginBottom: 4 }}>
                      Recording
                    </T>
                    <Row
                      first
                      title="Tell participants in the meeting chat"
                      right={<Toggle value={s.announceRecording} onChange={(v) => save({ announceRecording: v })} label="Announce recording in chat" />}
                    />
                    <T v="sub">When recording starts, CloudPilot posts: “{s.recordingNotice}”</T>
                  </Card>

                  <Card>
                    <T v="label">Meeting accounts & camera photo</T>
                    <T v="sub">Sign in to Microsoft Teams (and Zoom/Google) once on the machine so the bot joins as you. Your password goes only to Microsoft — never stored by CloudPilot.</T>
                    <Btn icon="key" label="Meeting accounts (Teams, Zoom, Google)" onPress={() => router.push("/accounts")} />
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
