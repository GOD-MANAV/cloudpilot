/** CloudPilot design tokens — shared by the website and the Android app. */
export type ThemeName = "dark" | "light" | "amoled";

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentText: string; // accent used as text/links (meets 4.5:1)
  onAccent: string;
  ok: string;
  okText: string;
  okBg: string;
  warn: string;
  warnText: string;
  warnBg: string;
  danger: string;
  dangerText: string;
  dangerBg: string;
  dangerSolid: string;
  off: string;
}

const darkBase = {
  text: "#E8EAF4",
  textMuted: "#C3C9DA",
  textSubtle: "#A3ABC4",
  onAccent: "#FFFFFF",
  ok: "#2DD4BF",
  okText: "#5EEAD4",
  okBg: "rgba(45,212,191,0.14)",
  warn: "#F5A524",
  warnText: "#FBC56A",
  warnBg: "rgba(245,165,36,0.15)",
  danger: "#FB6F84",
  dangerText: "#FF9AAA",
  dangerBg: "rgba(251,111,132,0.15)",
  dangerSolid: "#E11D48",
  off: "#5B6478",
};

export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    ...darkBase,
    bg: "#0B1020",
    surface: "#121933",
    surface2: "#1A2240",
    border: "#263055",
    borderStrong: "#344070",
    accent: "#6553F5",
    accentText: "#A99DFF",
  },
  amoled: {
    ...darkBase,
    bg: "#000000",
    surface: "#0A0D18",
    surface2: "#11162A",
    border: "#1A2240",
    borderStrong: "#263055",
    accent: "#6553F5",
    accentText: "#A99DFF",
  },
  light: {
    bg: "#F5F6FB",
    surface: "#FFFFFF",
    surface2: "#EDEFF7",
    border: "#E3E6EF",
    borderStrong: "#C9CEDD",
    text: "#0B1020",
    textMuted: "#2E3650",
    textSubtle: "#4B5470",
    accent: "#5B4BEA",
    accentText: "#4F46E5",
    onAccent: "#FFFFFF",
    ok: "#0F8F7E",
    okText: "#0F766E",
    okBg: "rgba(15,143,126,0.12)",
    warn: "#B45309",
    warnText: "#92400E",
    warnBg: "rgba(245,165,36,0.18)",
    danger: "#E11D48",
    dangerText: "#BE123C",
    dangerBg: "rgba(225,29,72,0.10)",
    dangerSolid: "#E11D48",
    off: "#8C94AD",
  },
};

export const ACCENTS = [
  { name: "Pilot violet", value: "#6553F5" },
  { name: "Ocean", value: "#0E7FD8" },
  { name: "Teal", value: "#0F8F7E" },
  { name: "Ember", value: "#D9480F" },
] as const;

export function palette(theme: ThemeName, accent?: string): Palette {
  const p = PALETTES[theme];
  if (!accent || accent === "#6553F5") return p;
  return { ...p, accent, accentText: theme === "light" ? accent : lighten(accent) };
}

/** Mix toward white for legible accent text on dark grounds. */
function lighten(hex: string, amt = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export const FONTS = {
  display: "Space Grotesk",
  body: "Inter",
  mono: "JetBrains Mono",
} as const;

export const PLATFORM_LABEL = { meet: "Meet", zoom: "Zoom", teams: "Teams", other: "Link" } as const;
export const PLATFORM_COLOR = { meet: "#8BDBFF", zoom: "#93B4FF", teams: "#B4AAFF", other: "#A3ABC4" } as const;
