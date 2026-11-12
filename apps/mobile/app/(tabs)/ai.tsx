import type { AccessTokenInfo, ActivityEntry, ActivityEvent, TokenScope } from "@cloudpilot/shared";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Share, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAction, usePoll } from "../../src/hooks";
import { Cols, MaxWidth } from "../../src/layout";
import { useSession } from "../../src/session";
import { Btn, Card, Chip, Empty, F, Icon, Seg, T } from "../../src/ui";

const SCOPES: { id: TokenScope; label: string }[] = [
  { id: "mcp", label: "MCP tools" },
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
  { id: "view", label: "Watch desktop" },
  { id: "machine", label: "Start/stop" },
];

const left = (iso: string) => {
  const h = (Date.parse(iso) - Date.now()) / 3600_000;
  return h >= 48 ? `${Math.round(h / 24)} days left` : h >= 1 ? `${Math.round(h)} h left` : `${Math.max(0, Math.round(h * 60))} min left`;
};

/** Live feed of what AI clients are doing on the machine, with stop / pause controls. */
function ActivityFeed() {
  const { client, c } = useSession();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [paused, setPaused] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const { busy, run } = useAction();

  useFocusEffect(
    useCallback(() => {
      if (!client) return;
      let ws: WebSocket | null = null;
      let alive = true;
      void (async () => {
        try {
          const first = await client.activity();
          if (!alive) return;
          setEntries(first.entries);
          setPaused(first.pausedUntil);
          ws = new WebSocket(await client.agentLink("/activity/stream", true));
          ws.onopen = () => setConnected(true);
          ws.onclose = () => setConnected(false);
          ws.onmessage = (e) => {
            const ev = JSON.parse(String(e.data)) as ActivityEvent;
            setEntries((cur) => {
              if (ev.type === "start") return [ev.entry, ...cur].slice(0, 200);
              if (ev.type === "end") return cur.map((x) => (x.id === ev.entry.id ? ev.entry : x));
              if (ev.type === "output") return cur.map((x) => (x.id === ev.id ? { ...x, output: (x.output + ev.chunk).slice(-8000) } : x));
              return cur;
            });
            if (ev.type === "pause") setPaused(ev.pausedUntil);
          };
        } catch {
          setConnected(false);
        }
      })();
      return () => {
        alive = false;
        ws?.close();
      };
    }, [client]),
  );

  const tone = (s: ActivityEntry["status"]) => (s === "running" ? "accent" : s === "ok" ? "ok" : s === "blocked" || s === "killed" ? "warn" : "danger");

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T v="h3">Live activity</T>
        <Chip tone={connected ? "ok" : "neutral"} label={connected ? "Watching" : "Machine off"} />
      </View>
      <T v="sub">Every command an AI runs here, as it happens. Stop one, pause all AI access, or jump into the terminal or desktop.</T>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {paused ? (
          <Btn small label="Resume AI access" icon="power" busy={busy} onPress={() => run(async () => (await client!.pauseAi(0), setPaused(null)))} />
        ) : (
          <Btn
            small
            kind="danger"
            label="Pause AI access"
            disabled={!connected}
            onPress={() =>
              Alert.alert("Pause AI access?", "Running AI commands are stopped and new ones are refused.", [
                { text: "Cancel", style: "cancel" },
                { text: "30 min", onPress: () => run(() => client!.pauseAi(30)) },
                { text: "Until I resume", style: "destructive", onPress: () => run(() => client!.pauseAi(24 * 60)) },
              ])
            }
          />
        )}
        <Btn small kind="secondary" icon="terminal" label="Terminal" onPress={() => router.push("/terminal")} />
        <Btn small kind="secondary" icon="monitor" label="Desktop" onPress={() => router.push("/desktop")} />
      </View>
      {paused && <Chip tone="warn" label={`AI access paused until ${new Date(paused).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} />}
      {entries.length === 0 && <Empty text={connected ? "Nothing yet. When Claude or another AI uses the machine, it shows up here live." : "Start the machine to watch AI activity."} />}
      {entries.slice(0, 40).map((e) => (
        <Pressable key={e.id} onPress={() => setOpen(open === e.id ? null : e.id)} accessibilityRole="button" style={{ borderTopWidth: 1, borderTopColor: c.surface2, paddingTop: 10, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Chip tone={tone(e.status)} label={e.status === "running" ? "Running" : e.status} />
            <T v="sub" style={{ flex: 1 }} numberOfLines={1}>
              {e.actor} · {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </T>
            {e.status === "running" && <Btn small kind="danger" label="Stop" onPress={() => run(() => client!.killActivity(e.id))} />}
          </View>
          <T v="mono" color={c.text} numberOfLines={open === e.id ? undefined : 2}>
            {e.tool === "run_command" ? `$ ${e.summary}` : `${e.tool}: ${e.summary}`}
          </T>
          {(open === e.id || e.status === "running") && e.output ? (
            <ScrollView style={{ maxHeight: 220, backgroundColor: "#05070f", borderRadius: 12, padding: 10 }} nestedScrollEnabled>
              <T v="mono" color="#C3C9DA" style={{ fontSize: 11 }}>
                {e.output.slice(-3000)}
              </T>
            </ScrollView>
          ) : null}
        </Pressable>
      ))}
    </Card>
  );
}

export default function Ai() {
  const { client, c } = useSession();
  const tokens = usePoll(() => client!.listTokens(), 30_000);
  const vm = usePoll(() => client!.vmStatus(), 60_000);
  const { busy, run } = useAction();
  const [label, setLabel] = useState("Claude Code");
  const [scopes, setScopes] = useState<TokenScope[]>(["mcp"]);
  const [ttl, setTtl] = useState<"1" | "24" | "168">("24");
  const [created, setCreated] = useState<string | null>(null);

  const fqdn = vm.data?.fqdn ?? "<your-machine>.cloudapp.azure.com";
  const cmd = created ? `claude mcp add --transport http cloudpilot https://${fqdn}/mcp --header "Authorization: Bearer ${created}"` : "";
  const active = (tokens.data ?? []).filter((t: AccessTokenInfo) => !t.revoked && Date.parse(t.expiresAt) > Date.now());
  const devices = active.filter((t) => t.id.startsWith("dev_"));
  const links = active.filter((t) => !t.id.startsWith("dev_"));

  const tokenRow = (t: AccessTokenInfo) => (
    <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: c.surface2, paddingTop: 10 }}>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: F.semi }}>{t.label}</T>
        <T v="sub">
          {t.scopes.join(", ")} · {left(t.expiresAt)} · {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleString()}` : "never used"}
        </T>
      </View>
      <Btn small kind="danger" label="Revoke" onPress={() => run(async () => (await client!.revokeToken(t.id), tokens.reload()))} />
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <MaxWidth>
          <T v="h1">AI access</T>
          <Cols>
            <ActivityFeed />
            <View style={{ gap: 14 }}>
              <Card>
                <T v="h3">New access link</T>
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  accessibilityLabel="Name"
                  style={{ height: 48, borderRadius: 14, borderWidth: 1, borderColor: c.borderStrong, color: c.text, paddingHorizontal: 12, fontFamily: F.medium }}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {SCOPES.map((s) => {
                    const on = scopes.includes(s.id);
                    return <Btn key={s.id} small kind={on ? "primary" : "secondary"} label={s.label} onPress={() => setScopes(on ? scopes.filter((x) => x !== s.id) : [...scopes, s.id])} />;
                  })}
                </View>
                <Seg
                  value={ttl}
                  onChange={setTtl}
                  options={[
                    { v: "1", label: "1 hour" },
                    { v: "24", label: "1 day" },
                    { v: "168", label: "7 days" },
                  ]}
                />
                <Btn
                  label="Create link"
                  busy={busy}
                  disabled={!scopes.length || !label.trim()}
                  onPress={() => run(async () => (setCreated((await client!.createToken({ label: label.trim(), scopes, ttlHours: Number(ttl) })).token), tokens.reload()))}
                />
                {created && (
                  <View style={{ gap: 8, backgroundColor: c.bg, borderRadius: 14, padding: 12 }}>
                    <T v="label">Shown once</T>
                    <T v="mono">{cmd}</T>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Btn style={{ flex: 1 }} small kind="secondary" icon="copy" label="Copy command" onPress={() => void Clipboard.setStringAsync(cmd)} />
                      <Btn style={{ flex: 1 }} small kind="secondary" icon="link" label="Share URL" onPress={() => void Share.share({ message: `https://${fqdn}/mcp/${created}` })} />
                    </View>
                  </View>
                )}
              </Card>
              <Card>
                <T v="h3">Access links · {links.length}</T>
                {links.length ? links.map(tokenRow) : <T v="sub">No active links.</T>}
              </Card>
              <Card>
                <T v="h3">Signed-in devices · {devices.length}</T>
                {devices.map(tokenRow)}
              </Card>
            </View>
          </Cols>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="key" size={16} color={c.textSubtle} />
            <T v="sub" style={{ flex: 1 }}>
              Links are signed and expire on their own. Revoking takes effect on the machine within 30 seconds.
            </T>
          </View>
        </MaxWidth>
      </ScrollView>
    </SafeAreaView>
  );
}
