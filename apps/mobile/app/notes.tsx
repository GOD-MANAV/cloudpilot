import type { Screenshot } from "@cloudpilot/shared";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { FlatList, Image, Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { useAction, usePoll } from "../src/hooks";
import { MaxWidth, useWide } from "../src/layout";
import { useSession } from "../src/session";
import { Btn, Card, Chip, Empty, F, Seg, T, fmtTime } from "../src/ui";

const REASON: Record<Screenshot["reason"], string> = { manual: "You", random: "Random", slide: "New slide", burst: "Burst" };

function Recording({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: 16, backgroundColor: "#000" }} nativeControls />;
}

export default function Notes() {
  const { client, c } = useSession();
  const { width, wide } = useWide();
  const recent = usePoll(() => client!.recentMeetings(), 30_000);
  const meetings = usePoll(() => client!.listMeetings(), 60_000);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Screenshot["reason"]>("all");
  const [shots, setShots] = useState<(Screenshot & { src: string })[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const { busy, run } = useAction();

  const id = sel ?? recent.data?.[0]?.id ?? null;
  const cur = recent.data?.find((r) => r.id === id);
  const title = (mid: string) => meetings.data?.find((m) => m.id === mid)?.title ?? "Meeting";

  useEffect(() => {
    if (!id || !client) return;
    let alive = true;
    void (async () => {
      const list = await client.screenshots(id);
      const withSrc = await Promise.all(list.map(async (s) => ({ ...s, src: await client.agentLink(`/meetings/${id}/files/${encodeURIComponent(s.file)}`) })));
      if (!alive) return;
      setShots(withSrc.reverse());
      setVideo(cur?.recordingBytes ? await client.agentLink(`/meetings/${id}/files/recording.mp4`) : null);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, client, cur?.recordingBytes]);

  if (recent.error) return <View style={{ flex: 1, backgroundColor: c.bg, padding: 20 }}><Empty text="Start the machine to browse recordings and screenshots stored on it. Delivered notes are also in your Drive and inbox." /></View>;

  const cols = wide ? 4 : 2;
  const tile = (Math.min(width, 1100) - 40 - (cols - 1) * 10) / cols;
  const shown = shots.filter((s) => filter === "all" || s.reason === filter);
  const d = cur?.delivery;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        key={cols}
        data={shown}
        numColumns={cols}
        keyExtractor={(s) => s.id}
        columnWrapperStyle={{ gap: 10, paddingHorizontal: 20, alignSelf: "center", maxWidth: 1100, width: "100%" }}
        contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ padding: 20, paddingBottom: 6 }}>
            <MaxWidth>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {(recent.data ?? []).map((r) => (
                  <Btn key={r.id} small kind={r.id === id ? "primary" : "secondary"} label={`${title(r.id)} · ${new Date(r.modifiedAt).toLocaleDateString([], { day: "numeric", month: "short" })}`} onPress={() => setSel(r.id)} />
                ))}
              </ScrollView>
              {!recent.data?.length && <Empty text="No meetings recorded on this machine yet." />}
              {cur && (
                <Card>
                  <T v="h2">{title(cur.id)}</T>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {d?.driveFolderUrl && <Chip tone="ok" label="Saved to Drive" />}
                    {d?.emailed && <Chip tone="ok" label="Email sent" />}
                    {d?.errors.map((e) => <Chip key={e} tone="danger" label={e} />)}
                    {cur.recordingBytes != null && <Chip label={`Recording · ${(cur.recordingBytes / 1e6).toFixed(0)} MB`} />}
                  </View>
                  {video && <Recording uri={video} />}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {d?.driveFolderUrl && <Btn style={{ flex: 1 }} kind="secondary" label="Open in Drive" onPress={() => void Linking.openURL(d.driveFolderUrl!)} />}
                    <Btn style={{ flex: 1 }} kind="secondary" label="Send again" busy={busy} onPress={() => run(async () => (await client!.redeliver(cur.id), recent.reload()))} />
                  </View>
                </Card>
              )}
              {shots.length > 0 && (
                <Seg
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { v: "all", label: `All ${shots.length}` },
                    { v: "slide", label: "Slides" },
                    { v: "manual", label: "Mine" },
                    { v: "random", label: "Random" },
                  ]}
                />
              )}
            </MaxWidth>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setZoom(item.src)} accessibilityRole="imagebutton" accessibilityLabel={`Screenshot at ${fmtTime(item.takenAt)}`} style={{ width: tile, gap: 4 }}>
            <Image source={{ uri: item.src }} style={{ width: tile, height: tile * 0.625, borderRadius: 12, backgroundColor: c.surface2 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T v="sub">{fmtTime(item.takenAt)}</T>
              <T v="sub" color={c.accentText} style={{ fontFamily: F.semi }}>
                {REASON[item.reason]}
              </T>
            </View>
          </Pressable>
        )}
      />
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)} supportedOrientations={["portrait", "landscape"]}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" }} onPress={() => setZoom(null)} accessibilityLabel="Close">
          {zoom && <Image source={{ uri: zoom }} style={{ width: "100%", height: "80%" }} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}
