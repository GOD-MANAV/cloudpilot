import { PLATFORM_COLOR, PLATFORM_LABEL, type Meeting } from "@cloudpilot/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAction, usePoll } from "../../src/hooks";
import { Cols, MaxWidth } from "../../src/layout";
import { useSession } from "../../src/session";
import { Btn, Card, Chip, Empty, ErrorText, F, Icon, Seg, T, Toggle, fmtDay, fmtTime } from "../../src/ui";

function MeetingCard({ m, onToggle, onJoin, onDelete, busy }: { m: Meeting; onToggle: () => void; onJoin: () => void; onDelete: () => void; busy: boolean }) {
  const { c } = useSession();
  const mins = Math.round((Date.parse(m.endAt) - Date.parse(m.startAt)) / 60_000);
  return (
    <Pressable
      onLongPress={onDelete}
      accessibilityHint="Long-press to delete"
      style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 20, padding: 14, flexDirection: "row", gap: 12, alignItems: "center" }}
    >
      <View style={{ width: 56, alignItems: "center" }}>
        <T style={{ fontFamily: F.displaySemi, fontSize: 17 }}>{fmtTime(m.startAt)}</T>
        <T v="sub" style={{ fontSize: 11 }}>
          {mins >= 60 ? `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60}` : ""}` : `${mins} min`}
        </T>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <T style={{ fontFamily: F.semi }} numberOfLines={1}>
          {m.title}
        </T>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <View style={{ backgroundColor: c.surface2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <T style={{ fontFamily: F.semi, fontSize: 12, color: PLATFORM_COLOR[m.platform] }}>{PLATFORM_LABEL[m.platform]}</T>
          </View>
          {m.status === "live" && <Chip tone="ok" label="Live" />}
          {m.status === "failed" && <Chip tone="danger" label="Didn't join" />}
          {m.status === "done" && <Chip label="Done" />}
          <T v="sub" style={{ fontSize: 12 }}>
            {m.presence === "static-image" ? "photo" : "camera off"}
            {m.source === "ics" ? " · calendar" : ""}
          </T>
        </View>
        {m.note ? (
          <T v="sub" numberOfLines={2} style={{ fontSize: 12 }}>
            {m.note}
          </T>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Toggle value={m.autoJoin} onChange={onToggle} label={`Auto-join ${m.title}`} disabled={busy} />
        <Pressable onPress={onJoin} accessibilityRole="button" accessibilityLabel={`Join ${m.title} now`} hitSlop={8}>
          <T v="sub" color={c.accentText} style={{ fontFamily: F.semi }}>
            Join now
          </T>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function Meetings() {
  const { client, c } = useSession();
  const list = usePoll(() => client!.listMeetings(), 30_000);
  const { busy, run } = useAction();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [ics, setIcs] = useState("");

  const now = Date.now();
  const items = (list.data ?? []).filter((m) => (tab === "upcoming" ? Date.parse(m.endAt) > now : Date.parse(m.endAt) <= now));
  if (tab === "past") items.reverse();
  const groups = new Map<string, Meeting[]>();
  for (const m of items) groups.set(fmtDay(m.startAt), [...(groups.get(fmtDay(m.startAt)) ?? []), m]);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} tintColor={c.accentText} />}>
        <MaxWidth>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <T v="h1">Meetings</T>
            <Btn small kind="secondary" icon="plus" label="Add" onPress={() => router.push("/meeting-new")} />
          </View>
          <Seg
            value={tab}
            onChange={setTab}
            options={[
              { v: "upcoming", label: "Upcoming" },
              { v: "past", label: "Past" },
            ]}
          />
          <ErrorText text={list.error} />
          {items.length === 0 && <Empty text={tab === "upcoming" ? "Nothing scheduled. Tap Add, or import your Teams/Outlook calendar below." : "No past meetings yet."} />}
          {[...groups.entries()].map(([day, ms]) => (
            <View key={day} style={{ gap: 10 }}>
              <T v="label">{day}</T>
              <Cols>
                {ms.map((m) => (
                  <MeetingCard
                    key={m.id}
                    m={m}
                    busy={busy}
                    onToggle={() => run(async () => (await client!.updateMeeting(m.id, { autoJoin: !m.autoJoin }), list.reload()))}
                    onJoin={() => run(async () => (await client!.joinNow(m.id), router.push("/live")))}
                    onDelete={() =>
                      Alert.alert("Delete meeting?", m.title, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => run(async () => (await client!.deleteMeeting(m.id), list.reload())) },
                      ])
                    }
                  />
                ))}
              </Cols>
            </View>
          ))}

          <Card>
            <T v="h3">Import your calendar</T>
            <T v="sub">
              In Outlook: Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link. CloudPilot checks it every hour; imported meetings start with
              auto-join off.
            </T>
            <TextInput
              value={ics}
              onChangeText={setIcs}
              placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics"
              placeholderTextColor={c.textSubtle}
              autoCapitalize="none"
              keyboardType="url"
              style={{ height: 48, borderRadius: 14, borderWidth: 1, borderColor: c.borderStrong, color: c.text, paddingHorizontal: 12, fontFamily: F.body }}
            />
            <Btn kind="secondary" label="Import" busy={busy} disabled={!ics.startsWith("https://")} onPress={() => run(async () => (await client!.importIcs(ics.trim()), setIcs(""), list.reload()))} />
          </Card>
        </MaxWidth>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add meeting"
        onPress={() => router.push("/meeting-new")}
        style={{ position: "absolute", right: 20, bottom: 20, width: 60, height: 60, borderRadius: 20, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", elevation: 6 }}
      >
        <Icon name="plus" color="#fff" size={26} />
      </Pressable>
    </SafeAreaView>
  );
}
