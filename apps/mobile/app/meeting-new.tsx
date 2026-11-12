import { PLATFORM_LABEL, detectPlatform, extractMeetingUrl } from "@cloudpilot/shared";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, ScrollView, TextInput, View } from "react-native";
import { useAction } from "../src/hooks";
import { Cols, MaxWidth } from "../src/layout";
import { useSession } from "../src/session";
import { Btn, Card, F, Seg, T, Toggle } from "../src/ui";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

export default function NewMeeting() {
  const { client, c } = useSession();
  const { busy, run } = useAction();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [day, setDay] = useState(0);
  const [time, setTime] = useState(() => {
    const d = new Date(Math.ceil(Date.now() / 900_000) * 900_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [minutes, setMinutes] = useState("60");
  const [presence, setPresence] = useState<"camera-off" | "static-image">("camera-off");
  const [joinAs, setJoinAs] = useState<"profile" | "guest">("profile");
  const [guestName, setGuestName] = useState("");
  const [autoJoin, setAutoJoin] = useState(true);
  const [record, setRecord] = useState(true);
  const [drive, setDrive] = useState(true);
  const [email, setEmail] = useState(true);
  const [shotMin, setShotMin] = useState("3");
  const [shotMax, setShotMax] = useState("8");
  const [slides, setSlides] = useState(true);

  // Paste a Teams invite from the clipboard in one tap.
  useEffect(() => {
    void Clipboard.getStringAsync().then((t) => {
      const found = t ? extractMeetingUrl(t) : null;
      if (found && !url) setUrl(found);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const input = { style: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.bg, color: c.text, paddingHorizontal: 14, fontFamily: F.medium, fontSize: 15 }, placeholderTextColor: c.textSubtle };
  const platform = url ? detectPlatform(url) : null;
  const validTime = /^([01]?\d|2[0-3]):[0-5]\d$/.test(time);

  const save = () =>
    run(async () => {
      const [h, m] = time.split(":").map(Number);
      const start = new Date();
      start.setDate(start.getDate() + day);
      start.setHours(h!, m!, 0, 0);
      await client!.createMeeting({
        title: title.trim(),
        url: url.trim(),
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + Number(minutes) * 60_000).toISOString(),
        autoJoin,
        presence,
        joinAs,
        guestName: joinAs === "guest" ? guestName || undefined : undefined,
        record,
        screenshots: {
          enabled: true,
          randomMinMinutes: Number(shotMin) || 3,
          randomMaxMinutes: Number(shotMax) || 8,
          onSlideChange: slides,
          slideSensitivity: 10,
        },
        delivery: { drive, email, keepOnVm: true, includeRecording: true },
      });
      router.back();
    });

  const dayLabel = (d: number) => (d === 0 ? "Today" : d === 1 ? "Tomorrow" : new Date(Date.now() + d * 86_400_000).toLocaleDateString([], { weekday: "short" }));

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <MaxWidth max={900}>
          <Cols>
            <Card>
              <T v="label">Meeting</T>
              <TextInput {...input} placeholder="Title (e.g. Operations Management)" value={title} onChangeText={setTitle} />
              <TextInput {...input} placeholder="Teams / Zoom / Meet link" autoCapitalize="none" keyboardType="url" value={url} onChangeText={setUrl} />
              {platform && <T v="sub">{platform === "other" ? "Unrecognised link — Teams, Zoom and Meet are supported." : `${PLATFORM_LABEL[platform]} link detected`}</T>}
              <T v="label">Day</T>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {DAYS.map((d) => (
                  <Btn key={d} small kind={d === day ? "primary" : "secondary"} label={dayLabel(d)} onPress={() => setDay(d)} />
                ))}
              </ScrollView>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <T v="sub">Starts (24 h)</T>
                  <TextInput {...input} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" placeholder="10:00" />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <T v="sub">Length (min)</T>
                  <TextInput {...input} value={minutes} onChangeText={(t) => setMinutes(t.replace(/\D/g, ""))} keyboardType="number-pad" />
                </View>
              </View>
            </Card>

            <Card>
              <T v="label">How the bot appears</T>
              <Seg
                value={presence}
                onChange={setPresence}
                options={[
                  { v: "camera-off", label: "Camera off" },
                  { v: "static-image", label: "My photo" },
                ]}
              />
              <Seg
                value={joinAs}
                onChange={setJoinAs}
                options={[
                  { v: "profile", label: "As my account" },
                  { v: "guest", label: "As a guest" },
                ]}
              />
              {joinAs === "guest" && <TextInput {...input} placeholder="Guest name" value={guestName} onChangeText={setGuestName} />}
              <Row label="Auto-join on time" value={autoJoin} onChange={setAutoJoin} />
              <Row label="Record the meeting" value={record} onChange={setRecord} />
              <Row label="Screenshot on slide change" value={slides} onChange={setSlides} />
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <T v="sub" style={{ flex: 1 }}>
                  Random screenshot every
                </T>
                <TextInput {...input} style={[input.style, { width: 56, textAlign: "center" }]} value={shotMin} onChangeText={setShotMin} keyboardType="number-pad" />
                <T v="sub">–</T>
                <TextInput {...input} style={[input.style, { width: 56, textAlign: "center" }]} value={shotMax} onChangeText={setShotMax} keyboardType="number-pad" />
                <T v="sub">min</T>
              </View>
              <Row label="Save to Google Drive" value={drive} onChange={setDrive} />
              <Row label="Email me the notes" value={email} onChange={setEmail} />
            </Card>
          </Cols>
          <Btn label="Add meeting" icon="plus" busy={busy} disabled={!title.trim() || !url.startsWith("https://") || !validTime || !Number(minutes)} onPress={() => void save()} />
        </MaxWidth>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      <T>{label}</T>
      <Toggle value={value} onChange={onChange} label={label} />
    </View>
  );
}
