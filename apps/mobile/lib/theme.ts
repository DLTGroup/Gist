import { useColorScheme } from "react-native";

// Forest + Amber: forest green for brand and links, amber only on primary buttons.
const light = { bg: "#f6f8f5", surface: "#fcfdfc", surface2: "#ecf0eb", border: "#dbe3da", text: "#102016", muted: "#55625a", accent: "#166534", accentInk: "#ffffff", accentSoft: "#e2ede4", cta: "#b45309", ctaInk: "#ffffff", save: "#166534", saveSoft: "#e2ede4", danger: "#b91c1c" };
const dark = { bg: "#09110c", surface: "#111a14", surface2: "#18231b", border: "#26332a", text: "#e6efe8", muted: "#9aaa9f", accent: "#5fd38a", accentInk: "#052e14", accentSoft: "#12301d", cta: "#f59e0b", ctaInk: "#1c1000", save: "#5fd38a", saveSoft: "#12301d", danger: "#f87171" };
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);
