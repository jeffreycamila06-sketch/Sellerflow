// Seller Website v2 — the three themes (Pop / Boutique / Bold) + the shop's accent colour (pure).
// Without a theme the shop is Pop (today's look). The accent: the seller's own colour when picked,
// else the theme's; the text on it is white or near-black, whichever reads better.
import type { ShopDesign } from "../shopApi";

export type ThemeKey = "pop" | "boutique" | "bold";
export const THEMES: ThemeKey[] = ["pop", "boutique", "bold"];
export const themeOf = (d: ShopDesign): ThemeKey => (d.theme === "boutique" || d.theme === "bold" ? d.theme : "pop");
export const themeClass = (k: ThemeKey) => (k === "boutique" ? "t-bou" : k === "bold" ? "t-bold" : "t-pop");
/** Each theme's own page background + accent (the editor's theme cards; the tint for a custom accent). */
export const THEME_LOOK: Record<ThemeKey, { bg: string; acc: string; fg: string; card: string }> = {
  pop: { bg: "#f5f5f7", acc: "#ee4d2d", fg: "#17181c", card: "#ffffff" },
  boutique: { bg: "#faf6f0", acc: "#2f4a3a", fg: "#2a2420", card: "#fffdf9" },
  bold: { bg: "#0e0f12", acc: "#d7ff3e", fg: "#f3f4f6", card: "#191b21" },
};
const HEX = /^#([0-9a-f]{6})$/i;
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16));
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const mix = (a: string, b: string, t: number) => `#${rgb(a).map((v, i) => Math.round(v * (1 - t) + rgb(b)[i] * t).toString(16).padStart(2, "0")).join("")}`;
/** The text colour on an accent: white unless the accent is light. Pure. */
export const onColor = (acc: string) => (HEX.test(acc) && lum(acc) > 0.45 ? "#0e0f12" : "#ffffff");
/** CSS variables for the seller's accent (none when the seller kept the theme's own). Pure. */
export function accentVars(d: ShopDesign, k: ThemeKey): Record<string, string> {
  const c = String(d.color || "");
  if (!HEX.test(c)) return {};
  return { "--s-acc": c, "--s-on": onColor(c), "--s-acc2": mix(c, THEME_LOOK[k].bg, 0.88), "--sc": c };
}
