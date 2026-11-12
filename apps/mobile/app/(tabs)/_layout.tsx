import { Tabs } from "expo-router";
import { useWide } from "../../src/layout";
import { useSession } from "../../src/session";
import { F, Icon } from "../../src/ui";

/** Bottom tabs on phones; a side navigation rail on tablets and in landscape. */
export default function TabsLayout() {
  const { c } = useSession();
  const { wide } = useWide();
  const icon = (name: string) => ({ color }: { color: unknown }) => <Icon name={name} color={String(color)} size={22} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? "left" : "bottom",
        tabBarVariant: wide ? "material" : "uikit",
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.textSubtle,
        tabBarLabelStyle: { fontFamily: F.semi, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: c.bg,
          borderTopColor: c.surface2,
          borderRightColor: c.surface2,
          ...(wide ? { width: 96, paddingTop: 24 } : { height: 72, paddingTop: 6 }),
        },
        tabBarActiveBackgroundColor: wide ? c.surface2 : undefined,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home") }} />
      <Tabs.Screen name="meetings" options={{ title: "Meetings", tabBarIcon: icon("calendar") }} />
      <Tabs.Screen name="live" options={{ title: "Live", tabBarIcon: icon("video") }} />
      <Tabs.Screen name="ai" options={{ title: "AI", tabBarIcon: icon("key") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("settings") }} />
    </Tabs>
  );
}
