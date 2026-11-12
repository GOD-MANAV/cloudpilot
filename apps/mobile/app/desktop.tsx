import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSession } from "../src/session";
import { Btn, Empty, T } from "../src/ui";

/**
 * The machine's real desktop (KasmVNC) — exactly what Teams shows, with sound,
 * and you can take control with touch/keyboard. Rotate the phone/tablet for landscape.
 */
export default function Desktop() {
  const { client, c } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    client
      ?.desktopUrl()
      .then(setUrl)
      .catch((e: Error) => setError(e.message));
  }, [client, key]);

  if (error)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 20, gap: 12 }}>
        <Empty text={`Can't open the desktop: ${error}`} />
        <Btn label="Try again" onPress={() => (setError(null), setKey((k) => k + 1))} />
      </View>
    );
  if (!url)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 10 }}>
        <ActivityIndicator color={c.accentText} />
        <T v="sub">Connecting to the desktop…</T>
      </View>
    );
  return (
    <WebView
      key={key}
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
  );
}
