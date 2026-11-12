import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSession } from "../src/session";
import { Btn, Empty } from "../src/ui";

/** xterm.js inside a WebView, connected to the machine's bash over WebSocket. */
const html = (wsUrl: string) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.min.css" integrity="sha384-eDYu/eBZQNhtqTaA7Wl3XighXKxm/9VYF+Chh3hQS+UUlKQIJ14hK2imKu4n99aR" crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/lib/xterm.min.js" integrity="sha384-pELe6ZHtFxFcuYBq3gMkqvmnNIqUWnAYjBG5gThqQQCjWp8PJ/65MLK4lMIfEK1e" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/lib/addon-fit.min.js" integrity="sha384-UwMkGaBqfOcrTjPjXdAPWrGQkhpxTJ21vKtTwLb6wBpBM8HQXKAiUuwVJfgY0Yw6" crossorigin="anonymous"></script>
<style>html,body{margin:0;height:100%;background:#05070f}#t{height:100%;padding:6px;box-sizing:border-box}</style>
</head><body><div id="t"></div><script>
const term = new Terminal({ fontSize: 13, cursorBlink: true, theme: { background: "#05070f", foreground: "#E8EAF4", cursor: "#A99DFF" } });
const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.getElementById("t")); fit.fit();
const ws = new WebSocket(${JSON.stringify(wsUrl)});
const size = () => ws.readyState === 1 && ws.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
ws.onopen = () => { size(); term.focus(); };
ws.onmessage = (e) => term.write(e.data);
ws.onclose = () => term.write("\\r\\n\\x1b[90m[disconnected]\\x1b[0m\\r\\n");
term.onData((d) => ws.readyState === 1 && ws.send(JSON.stringify({ t: "i", d })));
window.addEventListener("resize", () => { fit.fit(); size(); });
window.sendKeys = (d) => ws.readyState === 1 && ws.send(JSON.stringify({ t: "i", d }));
</script></body></html>`;

const KEYS: [string, string][] = [
  ["Esc", "\x1b"],
  ["Tab", "\t"],
  ["Ctrl-C", "\x03"],
  ["Ctrl-D", "\x04"],
  ["↑", "\x1b[A"],
  ["↓", "\x1b[B"],
  ["←", "\x1b[D"],
  ["→", "\x1b[C"],
  ["|", "|"],
  ["~", "~"],
  ["/", "/"],
];

export default function Terminal() {
  const { client, c } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const web = useRef<{ injectJavaScript(js: string): void } | null>(null);

  useEffect(() => {
    client
      ?.agentLink("/terminal", true)
      .then(setUrl)
      .catch((e: Error) => setError(e.message));
  }, [client, gen]);

  if (error)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 20 }}>
        <Empty text={`Terminal unavailable: ${error}`} />
      </View>
    );
  if (!url)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.accentText} />
      </View>
    );

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1, backgroundColor: "#05070f" }}>
      <View key={gen} style={{ flex: 1 }}>
        <WebView ref={web as never} source={{ html: html(url) }} originWhitelist={["*"]} style={{ flex: 1, backgroundColor: "#05070f" }} keyboardDisplayRequiresUserAction={false} />
      </View>
      <ScrollView horizontal style={{ flexGrow: 0, backgroundColor: c.surface }} contentContainerStyle={{ gap: 6, padding: 8 }} keyboardShouldPersistTaps="always">
        {KEYS.map(([label, seq]) => (
          <Btn key={label} small kind="secondary" label={label} onPress={() => web.current?.injectJavaScript(`window.sendKeys(${JSON.stringify(seq)});true;`)} />
        ))}
        <Btn small kind="ghost" label="Reconnect" onPress={() => setGen((g) => g + 1)} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
