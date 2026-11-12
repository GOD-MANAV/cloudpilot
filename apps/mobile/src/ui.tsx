import type { BotState, VmPowerState } from "@cloudpilot/shared";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useSession } from "./session";

export const F = {
  display: "SpaceGrotesk_700Bold",
  displaySemi: "SpaceGrotesk_600SemiBold",
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semi: "Inter_600SemiBold",
  mono: "JetBrainsMono_400Regular",
};

/* ------------------------------------------------------------ icons (Lucide-style strokes) */
const ICONS: Record<string, ReactNode> = {
  home: <Path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <Rect x="3" y="4" width="18" height="18" rx="2" />
      <Path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  video: (
    <>
      <Path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11" />
      <Rect x="2" y="6" width="14" height="12" rx="2" />
    </>
  ),
  key: (
    <>
      <Circle cx="7.5" cy="15.5" r="5.5" />
      <Path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
    </>
  ),
  settings: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  power: <Path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0" />,
  camera: (
    <>
      <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <Circle cx="12" cy="13" r="3" />
    </>
  ),
  burst: (
    <>
      <Rect x="7" y="7" width="14" height="14" rx="2" />
      <Path d="M4 16V5a1 1 0 0 1 1-1h11" />
    </>
  ),
  chat: <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />,
  hand: <Path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.2l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" />,
  leave: <Path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6A2 2 0 0 1 22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1L8 9.8M22 2 2 22" />,
  mic: (
    <>
      <Rect x="9" y="2" width="6" height="12" rx="3" />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </>
  ),
  monitor: (
    <>
      <Rect x="2" y="3" width="20" height="14" rx="2" />
      <Path d="M8 21h8M12 17v4" />
    </>
  ),
  terminal: <Path d="m4 17 6-6-6-6M12 19h8" />,
  link: <Path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />,
  image: (
    <>
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Circle cx="9" cy="9" r="2" />
      <Path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  back: <Path d="m15 18-6-6 6-6" />,
  chevron: <Path d="m9 18 6-6-6-6" />,
  copy: (
    <>
      <Rect x="8" y="8" width="14" height="14" rx="2" />
      <Path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  expand: <Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  scan: <Path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />,
};

export function Icon({ name, size = 22, color }: { name: keyof typeof ICONS | string; size?: number; color?: string }) {
  const { c } = useSession();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? c.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </Svg>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  const { c } = useSession();
  return (
    <Svg width={size} height={size} viewBox="0 0 56 56" accessibilityLabel="CloudPilot">
      <Rect width="56" height="56" rx="16" fill={c.accent} />
      <Path d="M16 34a8 8 0 0 1 1.6-15.8A11 11 0 0 1 38.5 21 7 7 0 0 1 38 35H16z" fill="none" stroke="#fff" strokeWidth={3} strokeLinejoin="round" />
      <Circle cx="38" cy="35" r="4" fill="#2DD4BF" />
    </Svg>
  );
}

/* ------------------------------------------------------------ layout */
export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const { c } = useSession();
  const inner = <View style={{ padding: padded ? 20 : 0, gap: 14, paddingBottom: 32 }}>{children}</View>;
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

export function T({ children, style, v = "body", color, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; v?: "h1" | "h2" | "h3" | "body" | "sub" | "label" | "mono" | "big"; color?: string; numberOfLines?: number }) {
  const { c } = useSession();
  const base: Record<string, TextStyle> = {
    h1: { fontFamily: F.display, fontSize: 28, letterSpacing: -0.5, color: c.text },
    h2: { fontFamily: F.displaySemi, fontSize: 20, color: c.text },
    h3: { fontFamily: F.displaySemi, fontSize: 17, color: c.text },
    big: { fontFamily: F.displaySemi, fontSize: 22, color: c.text },
    body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: c.text },
    sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: c.textSubtle },
    label: { fontFamily: F.semi, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: c.textSubtle },
    mono: { fontFamily: F.mono, fontSize: 12, lineHeight: 18, color: c.accentText },
  };
  return (
    <Text style={[base[v], color ? { color } : null, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useSession();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 }, style]}>{children}</View>;
}

export function Btn({
  label,
  onPress,
  kind = "primary",
  icon,
  disabled,
  busy,
  small,
  style,
  a11y,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger" | "dangerSolid";
  icon?: string;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  a11y?: string;
}) {
  const { c } = useSession();
  const bg = { primary: c.accent, secondary: c.surface2, ghost: "transparent", danger: c.dangerBg, dangerSolid: c.dangerSolid }[kind];
  const fg = { primary: c.onAccent, secondary: c.text, ghost: c.accentText, danger: c.dangerText, dangerSolid: "#fff" }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: small ? 40 : 48,
          paddingHorizontal: small ? 12 : 18,
          borderRadius: small ? 12 : 14,
          backgroundColor: bg,
          borderWidth: kind === "secondary" ? 1 : 0,
          borderColor: c.borderStrong,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      {label ? <Text style={{ fontFamily: F.semi, fontSize: small ? 13 : 15, color: fg }}>{label}</Text> : null}
    </Pressable>
  );
}

export function Chip({ label, tone = "neutral", dot = true }: { label: string; tone?: "ok" | "warn" | "danger" | "accent" | "neutral"; dot?: boolean }) {
  const { c } = useSession();
  const map = {
    ok: [c.okBg, c.okText, c.ok],
    warn: [c.warnBg, c.warnText, c.warn],
    danger: [c.dangerBg, c.dangerText, c.danger],
    accent: [c.surface2, c.accentText, c.accent],
    neutral: [c.surface2, c.textMuted, c.off],
  } as const;
  const [bg, fg, d] = map[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: bg, alignSelf: "flex-start" }}>
      {dot && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d }} />}
      <Text style={{ fontFamily: F.semi, fontSize: 12.5, color: fg }}>{label}</Text>
    </View>
  );
}

export function PowerChip({ power }: { power?: VmPowerState }) {
  if (power === "running") return <Chip label="Running" tone="ok" />;
  if (power === "starting") return <Chip label="Starting…" tone="accent" />;
  if (power === "stopping" || power === "deallocating") return <Chip label="Stopping…" tone="warn" />;
  if (!power || power === "unknown") return <Chip label="Checking…" />;
  return <Chip label="Stopped" />;
}

export function BotChip({ bot }: { bot: BotState }) {
  switch (bot.phase) {
    case "in-meeting":
      return <Chip tone="ok" label={bot.participants ? `In meeting · ${bot.participants} people` : "In meeting"} />;
    case "waiting-room":
      return <Chip tone="warn" label="Waiting room" />;
    case "joining":
    case "launching":
      return <Chip tone="accent" label="Joining…" />;
    case "leaving":
      return <Chip tone="warn" label="Leaving…" />;
    case "error":
      return <Chip tone="danger" label="Didn't join" />;
    default:
      return <Chip label={bot.phase === "ended" ? "Ended" : "Idle"} />;
  }
}

export function Seg<T extends string>({ value, options, onChange, disabled }: { value: T; options: { v: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; disabled?: boolean }) {
  const { c } = useSession();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable
            key={o.v}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: disabled || o.disabled }}
            disabled={disabled || o.disabled}
            onPress={() => onChange(o.v)}
            style={{ flex: 1, minHeight: 42, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.accent : "transparent", opacity: o.disabled ? 0.45 : 1 }}
          >
            <Text style={{ fontFamily: F.semi, fontSize: 14, color: on ? c.onAccent : c.textSubtle }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const { c } = useSession();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: value ? c.accent : c.borderStrong, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#fff", marginLeft: value ? 25 : 3 }} />
    </Pressable>
  );
}

export function Row({ title, sub, right, onPress, first }: { title: string; sub?: string; right?: ReactNode; onPress?: () => void; first?: boolean }) {
  const { c } = useSession();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.border }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T>{title}</T>
        {sub ? <T v="sub">{sub}</T> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={18} color={c.textSubtle} /> : null)}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Empty({ text }: { text: string }) {
  const { c } = useSession();
  return (
    <View style={{ padding: 24, borderRadius: 18, borderWidth: 1, borderStyle: "dashed", borderColor: c.borderStrong }}>
      <T v="sub" style={{ textAlign: "center" }}>
        {text}
      </T>
    </View>
  );
}

export function ErrorText({ text }: { text: string | null }) {
  const { c } = useSession();
  if (!text) return null;
  return (
    <View style={{ backgroundColor: c.dangerBg, borderRadius: 12, padding: 12 }}>
      <T color={c.dangerText}>{text}</T>
    </View>
  );
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return "Today";
  if (d.toDateString() === new Date(Date.now() + 86_400_000).toDateString()) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
};
export const fmtDuration = (from: string | null) => {
  if (!from) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
