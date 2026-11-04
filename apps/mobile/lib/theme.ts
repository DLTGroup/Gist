import { useColorScheme } from "react-native";

const light = { bg: "#f7f7f5", surface: "#ffffff", surface2: "#f0f0ec", border: "#e3e3dd", text: "#1c1c1a", muted: "#66665f", accent: "#0f766e", accentInk: "#ffffff", accentSoft: "#e0f2ef", save: "#b45309", saveSoft: "#fef3c7", danger: "#b91c1c" };
const dark = { bg: "#121412", surface: "#1a1d1b", surface2: "#222624", border: "#2e3330", text: "#ecede9", muted: "#9a9e98", accent: "#2dd4bf", accentInk: "#062b27", accentSoft: "#123a35", save: "#fbbf24", saveSoft: "#3a2e0f", danger: "#f87171" };
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);
