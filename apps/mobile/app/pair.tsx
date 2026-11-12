import { CloudPilotClient, parsePairingUri } from "@cloudpilot/shared";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaxWidth } from "../src/layout";
import { useSession } from "../src/session";
import { Btn, Card, ErrorText, F, Logo, T } from "../src/ui";

export default function Pair() {
  const { c, signIn } = useSession();
  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [controlUrl, setControlUrl] = useState("");
  const [ownerKey, setOwnerKey] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = {
    style: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.bg, color: c.text, paddingHorizontal: 14, fontFamily: F.medium, fontSize: 15 },
    placeholderTextColor: c.textSubtle,
  };

  const onScan = (data: string) => {
    const p = parsePairingUri(data);
    if (!p) return;
    setScanning(false);
    setControlUrl(p.controlUrl);
    setOwnerKey(p.ownerToken);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = controlUrl.trim().replace(/\/$/, "");
      const r = await CloudPilotClient.login({
        controlUrl: url,
        ownerToken: ownerKey.trim(),
        code,
        deviceName: Device.modelName ?? "Android phone",
        kind: "phone",
      });
      await signIn({ controlUrl: url, token: r.token, expiresAt: r.info.expiresAt });
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const paired = !!controlUrl && !!ownerKey;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <MaxWidth max={480}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Logo size={52} />
              <View>
                <T v="h1">CloudPilot</T>
                <T v="sub">Your cloud computer, on when you need it.</T>
              </View>
            </View>

            <Card>
              <T v="label">Step 1 · Pair this phone</T>
              {scanning ? (
                <View style={{ height: 300, borderRadius: 16, overflow: "hidden" }}>
                  <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => onScan(data)} />
                </View>
              ) : paired ? (
                <T v="sub">Paired with {new URL(controlUrl).host}</T>
              ) : (
                <T v="sub">Scan the pairing QR code printed at the end of the Azure setup script.</T>
              )}
              <Btn
                kind={paired ? "secondary" : "primary"}
                icon="scan"
                label={scanning ? "Cancel" : paired ? "Scan again" : "Scan pairing QR"}
                onPress={async () => {
                  if (scanning) return setScanning(false);
                  if (!perm?.granted && !(await requestPerm()).granted) return setError("Camera permission is needed to scan.");
                  setScanning(true);
                }}
              />
              {!paired && (
                <>
                  <T v="sub">…or enter them by hand:</T>
                  <TextInput {...input} placeholder="Control URL (https://…/api)" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={controlUrl} onChangeText={setControlUrl} />
                  <TextInput {...input} placeholder="Owner key" autoCapitalize="none" autoCorrect={false} secureTextEntry value={ownerKey} onChangeText={setOwnerKey} />
                </>
              )}
            </Card>

            <Card>
              <T v="label">Step 2 · Prove it's you</T>
              <T v="sub">Enter the 6-digit code from your authenticator app (Google Authenticator, Aegis…).</T>
              <TextInput
                {...input}
                style={[input.style, { fontFamily: F.mono, fontSize: 24, letterSpacing: 8, textAlign: "center", height: 60 }]}
                placeholder="123456"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
              />
              <ErrorText text={error} />
              <Btn label="Sign in" icon="key" busy={busy} disabled={!paired || code.length !== 6} onPress={() => void submit()} />
              <T v="sub">This phone gets a 30-day session you can revoke any time. The app also locks with your fingerprint.</T>
            </Card>
          </MaxWidth>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
