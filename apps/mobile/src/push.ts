import type { CloudPilotClient } from "@cloudpilot/shared";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Ask for notification permission and register this phone with the machine.
 * Needs the machine to be running (the token is stored on its disk).
 */
export async function registerPush(client: CloudPilotClient): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("meetings", {
      name: "Meetings and machine",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#6553F5",
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return null; // set after `eas init`
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await client.registerPush(data);
  return data;
}
