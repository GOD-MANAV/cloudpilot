import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, TextInput, View } from "react-native";
import { WebView } from "react-native-webview";
import { useAction } from "../src/hooks";
import { useSession } from "../src/session";
import { Btn, Empty, F, T } from "../src/ui";

type Key = Parameters<NonNullable<ReturnType<typeof useSession>["client"]>["desktopKey"]>[0];

/**
 * The machine's real desktop (KasmVNC) — exactly what Teams shows, with sound — and
 * you can take control with touch. The keyboard bar types into whatever field is
 * focused on the machine (handy for sign-in pages); nothing typed there is stored.
 */
export default function Desktop() {
  const { client, c } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const [text, setText] = useState("");
  const [hide, setHide] = useState(false);
  const [kb, setKb] = useState(true);
  const { busy, run } = useAction();

  useEffect(() => {
    client
      ?.desktopUrl()
      .then(setUrl)
      .catch((e: Error) => setError(e.message));
  }, [client, gen]);

  if (error)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 20, gap: 12 }}>
        <Empty text={`Can't open the desktop: ${error}`} />
        <Btn label="Try again" onPress={() => (setError(null), setGen((g) => g + 1))} />
      </View>
    );
  if (!url)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 10 }}>
        <ActivityIndicator color={c.accentText} />
        <T v="sub">Connecting to the desktop…</T>
      </View>
    );

  const key = (k: Key) => run(() => client!.desktopKey(k));

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1, backgroundColor: "#000" }}>
      <View key={gen} style={{ flex: 1 }}>
        <WebView
          source={{ uri: url }}
          style={{ flex: 1, backgroundColor: "#000" }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          onError={(e) => setError(e.nativeEvent.description)}
        />
      </View>
      <View style={{ backgroundColor: c.surface, padding: 8, gap: 8, borderTopWidth: 1, borderTopColor: c.border }}>
        {kb && (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type here, then Send (goes to the focused field)"
              placeholderTextColor={c.textSubtle}
              secureTextEntry={hide}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderStrong, color: c.text, paddingHorizontal: 12, fontFamily: F.medium }}
            />
            <Btn small label="Send" busy={busy} disabled={!text} onPress={() => run(async () => (await client!.desktopType(text), setText("")))} />
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="always">
          <Btn small kind={kb ? "primary" : "secondary"} label="Keyboard" onPress={() => setKb(!kb)} />
          <Btn small kind="secondary" label={hide ? "Show text" : "Hide text"} onPress={() => setHide(!hide)} />
          <Btn small kind="secondary" label="Enter" onPress={() => key("Return")} />
          <Btn small kind="secondary" label="Tab" onPress={() => key("Tab")} />
          <Btn small kind="secondary" label="⌫" a11y="Backspace" onPress={() => key("BackSpace")} />
          <Btn small kind="secondary" label="Esc" onPress={() => key("Escape")} />
          <Btn small kind="secondary" label="Reload page" onPress={() => key("F5")} />
          <Btn small kind="ghost" label="Reconnect" onPress={() => setGen((g) => g + 1)} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
