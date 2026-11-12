import { VM_SIZES, type VmSize } from "@cloudpilot/shared";
import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAction, usePoll } from "../../src/hooks";
import { Cols, MaxWidth } from "../../src/layout";
import { registerPush } from "../../src/push";
import { useSession } from "../../src/session";
import { BotChip, Btn, Card, Chip, Empty, ErrorText, F, Icon, Logo, PowerChip, T, fmtDay, fmtDuration, fmtTime } from "../../src/ui";

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
      <T v="sub" color={c.text} style={{ fontFamily: F.medium, fontSize: 12 }}>
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

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={vm.loading && !vm.data} onRefresh={() => (vm.reload(), usage.reload(), meetings.reload())} tintColor={c.accentText} />}
      >
        <MaxWidth>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <T v="sub" numberOfLines={1}>
                {vm.data?.fqdn ?? vm.data?.region ?? "Connecting…"}
              </T>
              <T v="h1">Your machine</T>
            </View>
            <Logo />
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
                  <T v="sub">
                    {agent.data?.idle.shutdownInMinutes != null ? `Stops itself in ${agent.data.idle.shutdownInMinutes} min if nothing is happening.` : "Starting services…"}
                  </T>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Btn style={{ flex: 1 }} kind="danger" icon="power" label="Stop" busy={busy} onPress={() => run(async () => (await client!.vmStop(), vm.reload()))} />
                    <Btn style={{ flex: 1 }} kind="secondary" label="Keep on 1 h" disabled={!running || busy} onPress={() => run(() => client!.keepOn(1))} />
                  </View>
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
            <Quick icon="monitor" label="Desktop" onPress={() => router.push("/desktop")} />
            <Quick icon="terminal" label="Terminal" onPress={() => router.push("/terminal")} />
            <Quick icon="link" label="AI access" onPress={() => router.push("/ai")} />
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
