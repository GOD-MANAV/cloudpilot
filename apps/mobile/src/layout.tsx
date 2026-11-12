import { Children, type ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";

/** Tablet (Tab S7: ~800dp wide) or a phone in landscape → wide layouts. */
export function useWide() {
  const { width, height } = useWindowDimensions();
  return { wide: width >= 720, width, height, landscape: width > height };
}

/** One column on phones; N equal columns on wide screens. */
export function Cols({ children, n = 2, gap = 14 }: { children: ReactNode; n?: number; gap?: number }) {
  const { wide } = useWide();
  const items = Children.toArray(children).filter(Boolean);
  if (!wide) return <View style={{ gap }}>{items}</View>;
  const rows: ReactNode[][] = [];
  items.forEach((c, i) => (i % n === 0 ? rows.push([c]) : rows[rows.length - 1]!.push(c)));
  return (
    <View style={{ gap }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", gap, alignItems: "stretch" }}>
          {r.map((c, j) => (
            <View key={j} style={{ flex: 1, minWidth: 0 }}>
              {c}
            </View>
          ))}
          {Array.from({ length: n - r.length }, (_, k) => (
            <View key={`pad${k}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Centres content and caps its width on big screens so lines stay readable. */
export function MaxWidth({ children, max = 1100 }: { children: ReactNode; max?: number }) {
  return <View style={{ width: "100%", maxWidth: max, alignSelf: "center", gap: 14 }}>{children}</View>;
}
