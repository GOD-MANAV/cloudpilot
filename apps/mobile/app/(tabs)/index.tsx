import { VM_SIZES, type VmSize } from "@cloudpilot/shared";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAction, usePoll } from "../../src/hooks";
import { Cols, MaxWidth } from "../../src/layout";
import { registerPush } from "../../src/push";
import { useSession } from "../../src/session";
import { BotChip, Btn, Card, Chip, Empty, ErrorText, F, Icon, Logo, PowerChip, T, fmtDay, fmtDuration, fmtTime } from "../../src/ui";

/** Friendly names for the regions bootstrap.sh picks from; anything else shows as-is. */
const REGIONS: Record<string, string> = {
  centralindia: "Central India",
  southindia: "South India",
  westindia: "West India",
  eastasia: "East Asia",
  southeastasia: "Southeast Asia",
  uaenorth: "UAE North",
  eastus: "East US",
  eastus2: "East US 2",
  westus2: "West US 2",
  northeurope: "North Europe",
  westeurope: "West Europe",
};
const regionName = (r: string) => REGIONS[r] ?? r;

function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 14, padding: 12, gap: 2 }}>
      <T v="sub">{label}</T>
      <T v="big" style={{ fontSize: 19 }}>
        {value}
      </T>
    </View>
  );
}

function Quick({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { c } = useSession();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: 76, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 6, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon name={icon} color={c.accentText} />
      <T v="sub" color={c.text} numberOfLines={1} style={{ fontFamily: F.medium, fontSize: 12 }}>
        {label}
      </T>
    </Pressable>
  );
}

export default function Home() {
  const { client, c } = useSession();
  const vm = usePoll(() => client!.vmStatus(), 8000);
  const usage = usePoll(() => client!.usage(), 60_000);
  const meetings = usePoll(() => client!.listMeetings(), 60_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const agent = usePoll(running ? () => client!.agentStatus() : null, 8000, [running]);
  const { busy, run } = useAction();

  useEffect(() => {
    if (running && client) void registerPush(client).catch(() => undefined);
  }, [running, client]);

  const next = meetings.data?.find((m) => Date.parse(m.endAt) > Date.now() && m.status !== "cancelled");
  const size = vm.data?.size as VmSize | undefined;
  const u = usage.data;
  const pct = u ? Math.min(100, (u.monthToDateUsd / Math.max(0.01, u.budgetUsd)) * 100) : 0;
  const hoursLeft = u && size && VM_SIZES[size] ? Math.max(0, (u.budgetUsd - u.monthToDateUsd) / VM_SIZES[size].usdPerHour) : null;
  const power = vm.data?.power;
  const on = power === "running";
  // When the machine is on but CloudPilot on it doesn't answer, say so instead of "Starting…" forever.
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (on && !running) setWaitingSince((w) => w ?? Date.now());
    else setWaitingSince(null);
  }, [on, running]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const stuck = waitingSince !== null && Date.now() - waitingSince > 6 * 60_000;
  const [keepOpen, setKeepOpen] = useState(false);
  const [customHours, setCustomHours] = useState("");
  const keep = (h: number | "forever") =>
    run(async () => {
      await client!.keepOn(h);
      setKeepOpen(false);
      setCustomHours("");
      agent.reload();
    });
  const needsAgent = (go: () => void) => () =>
    running
      ? go()
      : Alert.alert(
          on ? "Not ready yet" : "Machine is off",
          on ? "The machine is on, but CloudPilot on it isn't answering yet. Wait a minute and try again." : "Start the machine first (about a minute).",
        );

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={vm.loading && !vm.data} onRefresh={() => (vm.reload(), usage.reload(), meetings.reload())} tintColor={c.accentText} />}
      >
        <MaxWidth>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              {/* Short name + region instead of the long address, which never fit. */}
              <T v="sub" numberOfLines={1}>
                {vm.data ? [vm.data.fqdn?.split(".")[0], regionName(vm.data.region)].filter(Boolean).join(" · ") : "Connecting…"}
              </T>
              <T v="h1">Your machine</T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8} onPress={() => router.push("/settings")}>
              <Logo />
              <View style={{ position: "absolute", right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: c.surface2, borderWidth: 2, borderColor: c.bg, alignItems: "center", justifyContent: "center" }}>
                <Icon name="settings" size={12} color={c.text} />
              </View>
            </Pressable>
          </View>
          <ErrorText text={vm.error} />

          <Cols>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <PowerChip power={power} />
                <T v="sub">{size ? VM_SIZES[size]?.label.split(" (")[0] ?? size : ""}</T>
              </View>
              {on ? (
                <>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Stat label="On for" value={fmtDuration(vm.data?.since ?? null) || "–"} />
                    <Stat label="Disk free" value={agent.data?.diskFreeGb != null ? `${agent.data.diskFreeGb} GB` : "–"} />
                  </View>
                  {stuck ? (
                    <T v="sub" color={c.warnText}>
                      The machine is on, but CloudPilot on it isn't answering. Stop it to save credit, then repair it from Azure Cloud Shell (see "Troubleshooting" in the self-hosting guide).
                    </T>
                  ) : (
                    <T v="sub">
                      {agent.data?.idle.keepOnForever
                        ? "Stays on until you press Stop (the monthly budget limit still applies)."
                        : agent.data?.idle.keepOnUntil
                          ? `Kept on until ${fmtTime(agent.data.idle.keepOnUntil)}, then stops itself when idle.`
                          : agent.data?.idle.shutdownInMinutes != null
                            ? `Stops itself in ${agent.data.idle.shutdownInMinutes} min if nothing is happening.`
                            : "Starting services… (about 1–2 minutes)"}
                    </T>
                  )}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Btn style={{ flex: 1 }} kind="danger" icon="power" label="Stop" busy={busy} onPress={() => run(async () => (await client!.vmStop(), vm.reload()))} />
                    <Btn style={{ flex: 1 }} kind="secondary" label={keepOpen ? "Close" : "Keep on…"} disabled={!running || busy} onPress={() => setKeepOpen(!keepOpen)} />
                  </View>
                  {keepOpen && running && (
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {([1, 2, 3, 6] as const).map((h) => (
                          <Btn key={h} small kind="secondary" label={`${h} h`} onPress={() => keep(h)} />
                        ))}
                        <Btn small kind="secondary" label="Until I stop it" onPress={() => keep("forever")} />
                        {(agent.data?.idle.keepOnUntil || agent.data?.idle.keepOnForever) && <Btn small kind="ghost" label="Cancel keep-on" onPress={() => keep(0)} />}
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <TextInput
                          value={customHours}
                          onChangeText={(t) => setCustomHours(t.replace(/[^0-9]/g, "").slice(0, 2))}
                          keyboardType="number-pad"
                          placeholder="Hours (1–24)"
                          placeholderTextColor={c.textSubtle}
                          style={{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderStrong, color: c.text, paddingHorizontal: 12, fontFamily: F.medium }}
                        />
                        <Btn small label="Keep on" disabled={!(Number(customHours) >= 1 && Number(customHours) <= 24)} onPress={() => keep(Number(customHours))} />
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <T v="h3">{power === "starting" ? "Waking up…" : "Sleeping. Costs nothing right now."}</T>
                  <T v="sub">{next?.autoJoin ? `Wakes by itself 8 min before "${next.title}".` : "Takes about a minute to start."}</T>
                  <Btn icon="power" label="Start machine" busy={busy || power === "starting"} onPress={() => run(async () => (await client!.vmStart(), vm.reload()))} />
                </>
              )}
            </Card>

            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <T v="label">{next ? `Next · ${fmtDay(next.startAt)}` : "Next meeting"}</T>
                {next && <T v="sub" color={next.autoJoin ? c.okText : c.textSubtle}>{next.autoJoin ? "Auto-join on" : "Auto-join off"}</T>}
              </View>
              {next ? (
                <>
                  <T v="h3">{next.title}</T>
                  <T v="sub">
                    {fmtTime(next.startAt)} – {fmtTime(next.endAt)} · {next.platform === "teams" ? "Teams" : next.platform === "zoom" ? "Zoom" : "Meet"}
                  </T>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Btn style={{ flex: 1 }} label="Join now" busy={busy} onPress={() => run(async () => (await client!.joinNow(next.id), router.push("/live")))} />
                    <Btn style={{ flex: 1 }} kind="secondary" label="All meetings" onPress={() => router.push("/meetings")} />
                  </View>
                </>
              ) : (
                <Empty text="Nothing scheduled. Add a meeting or import your calendar." />
              )}
              {agent.data && agent.data.bot.phase !== "idle" && agent.data.bot.phase !== "ended" && (
                <Pressable onPress={() => router.push("/live")} accessibilityRole="button">
                  <BotChip bot={agent.data.bot} />
                </Pressable>
              )}
            </Card>
          </Cols>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Quick icon="monitor" label="Desktop" onPress={needsAgent(() => router.push("/desktop"))} />
            <Quick icon="terminal" label="Terminal" onPress={needsAgent(() => router.push("/terminal"))} />
            <Quick icon="link" label="AI links" onPress={() => router.push("/ai")} />
            <Quick icon="image" label="Notes" onPress={() => router.push("/notes")} />
          </View>

          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T v="sub" color={c.textMuted}>
                {u ? `${new Date().toLocaleString([], { month: "long" })} · $${u.monthToDateUsd.toFixed(2)} of $${u.budgetUsd}` : "Usage…"}
              </T>
              <T style={{ fontFamily: F.semi }}>{hoursLeft != null ? `≈ ${Math.floor(hoursLeft)} h left` : ""}</T>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: c.border, overflow: "hidden" }}>
              <View style={{ width: `${pct}%`, height: 8, backgroundColor: pct > 85 ? c.danger : c.ok }} />
            </View>
            {u && u.projectedUsd > u.budgetUsd && <Chip tone="warn" label={`On track for $${u.projectedUsd.toFixed(2)} this month`} />}
          </Card>
        </MaxWidth>
      </ScrollView>
    </SafeAreaView>
  );
}
