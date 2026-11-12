import type { BotCommand } from "@cloudpilot/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAction, usePoll } from "../../src/hooks";
import { MaxWidth, useWide } from "../../src/layout";
import { startLive, type LiveSession } from "../../src/live";
import { useSession } from "../../src/session";
import { BotChip, Btn, Card, Chip, Empty, F, Icon, Seg, T } from "../../src/ui";

function Control({ icon, label, onPress, tone = "neutral", disabled }: { icon: string; label: string; onPress: () => void; tone?: "neutral" | "accent" | "danger"; disabled?: boolean }) {
  const { c } = useSession();
  const bg = tone === "accent" ? c.accent : tone === "danger" ? c.dangerSolid : c.surface2;
  const fg = tone === "neutral" ? c.text : "#fff";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: 62, borderRadius: 18, backgroundColor: bg, alignItems: "center", justifyContent: "center", gap: 3, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 })}
    >
      <Icon name={icon} size={20} color={fg} />
      <T style={{ fontFamily: F.semi, fontSize: 11, color: fg }}>{label}</T>
    </Pressable>
  );
}

export default function Live() {
  const { client, c } = useSession();
  const { wide } = useWide();
  const vm = usePoll(() => client!.vmStatus(), 15_000);
  const running = vm.data?.power === "running" && vm.data.agentHealthy;
  const bot = usePoll(running ? () => client!.botState() : null, 2500, [running]);
  const [frame, setFrame] = useState<string | null>(null);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [chat, setChat] = useState("");
  const { busy, run } = useAction();
  const s = bot.data;
  const inMeeting = s?.phase === "in-meeting";
  const active = !!s && s.phase !== "idle" && s.phase !== "ended";

  // The preview is a real capture of the Teams/Zoom/Meet window on the machine:
  // whatever it shows (people grid, shared screen, chat) you see here.
  useFocusEffect(
    useCallback(() => {
      if (!running || !active) {
        setFrame(null);
        return;
      }
      let alive = true;
      const tick = async () => {
        try {
          const u = await client!.agentLink("/bot/preview.jpg");
          if (alive) setFrame(`${u}&t=${Date.now()}`);
        } catch {
          /* not ready */
        }
      };
      void tick();
      const t = setInterval(tick, 2000);
      return () => {
        alive = false;
        clearInterval(t);
      };
    }, [running, active, client]),
  );

  useEffect(() => () => live?.stop(), [live]);

  const cmd = (b: BotCommand) => run(async () => (await client!.botCommand(b), bot.reload()));

  if (!running)
    return (
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg, padding: 20, gap: 14 }}>
        <T v="h1">Live meeting</T>
        <Empty text="The machine is stopped. Start it from Home, or tap “Join now” on a meeting." />
      </SafeAreaView>
    );

  const preview = (
    <Pressable onPress={() => router.push("/desktop")} accessibilityLabel="Open full screen with sound" style={{ aspectRatio: 16 / 10, borderRadius: 18, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: c.border }}>
      {frame ? (
        <Image source={{ uri: frame }} style={{ flex: 1 }} resizeMode="contain" fadeDuration={0} accessibilityLabel="What the meeting shows right now" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <T v="sub">{active ? "Loading view…" : "No meeting open"}</T>
        </View>
      )}
      <View style={{ position: "absolute", right: 10, top: 10, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10, padding: 6 }}>
        <Icon name="expand" size={16} color="#fff" />
      </View>
      {live && (
        <View style={{ position: "absolute", right: 10, bottom: 10, width: 96, height: 64, borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: c.ok }}>
          <RTCView streamURL={live.stream.toURL()} style={{ flex: 1 }} objectFit="cover" mirror />
        </View>
      )}
    </Pressable>
  );

  const controls = (
    <View style={{ gap: 12 }}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T v="label">Your camera</T>
          <Btn
            small
            kind={s?.mic === "live" ? "primary" : "secondary"}
            icon="mic"
            label={s?.mic === "live" ? "Mic live" : "Muted"}
            disabled={!live || !inMeeting}
            onPress={() => cmd({ type: "mic", mode: s?.mic === "live" ? "muted" : "live" })}
          />
        </View>
        <Seg
          value={(s?.camera ?? "off") as "off" | "static-image" | "live"}
          disabled={!inMeeting || busy}
          onChange={(m) => cmd({ type: "camera", mode: m })}
          options={[
            { v: "off", label: "Off" },
            { v: "static-image", label: "Photo" },
            { v: "live", label: "Live", disabled: !live },
          ]}
        />
        {live ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn style={{ flex: 1 }} kind="secondary" label="Flip camera" onPress={() => live.switchCamera()} />
            <Btn
              style={{ flex: 1 }}
              kind="danger"
              label="Stop live"
              onPress={() => {
                live.stop();
                setLive(null);
                setTimeout(bot.reload, 800);
              }}
            />
          </View>
        ) : (
          <Btn
            icon="video"
            label="Go live from this phone"
            disabled={!inMeeting}
            busy={busy}
            onPress={() => run(async () => setLive(await startLive(await client!.agentLink("/live", true))))}
          />
        )}
        <T v="sub">
          {live
            ? "Your phone's camera is in the meeting. Your mic stays muted until you unmute."
            : s?.camera === "static-image"
              ? "The others see your photo. Recording and screenshots keep running."
              : "The others see your name with the camera off. Recording and screenshots keep running."}
        </T>
      </Card>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Control icon="camera" label={`${s?.screenshots ?? 0} shots`} tone="accent" disabled={!active} onPress={() => cmd({ type: "screenshot" })} />
        <Control icon="burst" label="Burst" disabled={!inMeeting} onPress={() => cmd({ type: "burst", count: 5 })} />
        <Control icon="hand" label="Hand" disabled={!inMeeting} onPress={() => cmd({ type: "raise-hand" })} />
        <Control
          icon="leave"
          label="Leave"
          tone="danger"
          disabled={!active}
          onPress={() =>
            Alert.alert("Leave the meeting?", "Recording stops and notes are sent.", [
              { text: "Stay", style: "cancel" },
              { text: "Leave", style: "destructive", onPress: () => void cmd({ type: "leave" }) },
            ])
          }
        />
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={chat}
          onChangeText={setChat}
          placeholder="Message everyone in the chat"
          placeholderTextColor={c.textSubtle}
          editable={inMeeting}
          style={{ flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: c.borderStrong, color: c.text, paddingHorizontal: 12, fontFamily: F.body }}
        />
        <Btn label="Send" kind="secondary" disabled={!inMeeting || !chat.trim()} onPress={() => run(async () => (await client!.botCommand({ type: "chat", text: chat.trim() }), setChat("")))} />
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <MaxWidth max={1400}>
          <View style={{ gap: 8 }}>
            <T v="h1">Live meeting</T>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {s && <BotChip bot={s} />}
              {s?.recording && <Chip tone="danger" label="REC" />}
              {s?.message ? <T v="sub">{s.message}</T> : null}
            </View>
          </View>
          {wide ? (
            <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
              <View style={{ flex: 3, gap: 10 }}>
                {preview}
                <Btn kind="ghost" icon="expand" label="Full screen with sound" onPress={() => router.push("/desktop")} />
              </View>
              <View style={{ flex: 2 }}>{controls}</View>
            </View>
          ) : (
            <>
              {preview}
              <Btn kind="ghost" small icon="expand" label="Full screen with sound" onPress={() => router.push("/desktop")} />
              {controls}
            </>
          )}
          <Btn kind="secondary" icon="image" label="Screenshots and recordings" onPress={() => router.push("/notes")} />
        </MaxWidth>
      </ScrollView>
    </SafeAreaView>
  );
}
