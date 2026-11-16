// Seller Website v3 — the look the seller sets (docs/design/seller-website-v3/site-v3.html, the preview's
// CFG / PRESETS / FONTS / applyCfg). Pure, unit-tested.
//   layout   brand = Brand store (new) · market = Marketplace (Build 1's layout)
//   top1/2   the top colour band (two different colours = a blend)
//   btn      buttons · sale = the struck-through old price (Brand store only)
//   dark     light or dark page body · font modern / friendly / classic · corners sharp / round
//   tiles    the two big tiles under the band (category names; absent = the first two with pictures)
// A shop whose design has NO `look` renders exactly as Build 1 (its theme + shop colour, v2/theme.ts).
export type LookLayout = "brand" | "market";
export type LookFont = "modern" | "friendly" | "classic";
export type LookCorners = "sharp" | "round";
export interface ShopLook {
  layout: LookLayout; top1: string; top2: string; btn: string; sale: string; dark: boolean; font: LookFont; corners: LookCorners;
  tiles?: string[];
}
export type LookColours = Pick<ShopLook, "top1" | "top2" | "btn" | "sale" | "dark" | "font" | "corners">;

export const LOOK_PRESETS: { key: "ocean" | "midnight" | "blush" | "forest" | "sunset"; name: string; look: LookColours }[] = [
  { key: "ocean", name: "Ocean", look: { top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" } },
  { key: "midnight", name: "Midnight", look: { top1: "#0b0b0f", top2: "#4c1d95", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "modern", corners: "sharp" } },
  { key: "blush", name: "Blush", look: { top1: "#f472b6", top2: "#fb923c", btn: "#be185d", sale: "#e11d48", dark: false, font: "friendly", corners: "round" } },
  { key: "forest", name: "Forest", look: { top1: "#2f4a3a", top2: "#84a98c", btn: "#2f4a3a", sale: "#b45309", dark: false, font: "classic", corners: "sharp" } },
  { key: "sunset", name: "Sunset", look: { top1: "#ff7a45", top2: "#c81e4a", btn: "#ee4d2d", sale: "#ee4d2d", dark: false, font: "friendly", corners: "round" } },
];
/** A shop that starts its website now: Brand store + Ocean. */
export const NEW_SHOP_LOOK: ShopLook = { layout: "brand", ...LOOK_PRESETS[0].look };

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_TILE = 40;
/** The server's whitelist (sql/168 website_public_look), mirrored: anything odd → no look (= Build 1). Pure. */
export function cleanLook(raw: unknown): ShopLook | undefined {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return undefined;
  const hex = (k: string) => (typeof o[k] === "string" && HEX.test(o[k] as string) ? (o[k] as string).toLowerCase() : null);
  const layout = o.layout === "brand" || o.layout === "market" ? o.layout : null;
  const font = o.font === "modern" || o.font === "friendly" || o.font === "classic" ? o.font : null;
  const corners = o.corners === "sharp" || o.corners === "round" ? o.corners : null;
  const top1 = hex("top1"), top2 = hex("top2"), btn = hex("btn"), sale = hex("sale");
  if (!layout || !font || !corners || !top1 || !top2 || !btn || !sale || typeof o.dark !== "boolean") return undefined;
  const tiles = Array.isArray(o.tiles) ? o.tiles.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, MAX_TILE)).filter(Boolean).slice(0, 2) : [];
  return { layout, top1, top2, btn, sale, dark: o.dark, font, corners, ...(tiles.length ? { tiles } : {}) };
}

// ── contrast (WCAG relative luminance), as the preview's lum / ratio / onCol ──
const lum = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** a·(1−t) + b·t, per channel (#rrggbb). */
export const mixHex = (a: string, b: string, t: number) => {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = c(a), y = c(b);
  return `#${x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, "0")).join("")}`;
};
/** White or dark text on a colour, whichever reads better. */
export const textOn = (h: string) => (contrast(h, "#ffffff") >= contrast(h, "#111111") ? "#ffffff" : "#111111");

export const LOOK_FONTS: Record<LookFont, { head: string; body: string; caps: boolean }> = {
  modern: { head: '"Space Grotesk",system-ui,sans-serif', body: "Inter,system-ui,sans-serif", caps: true },
  friendly: { head: '"Plus Jakarta Sans",system-ui,sans-serif', body: '"Plus Jakarta Sans",system-ui,sans-serif', caps: false },
  classic: { head: "Fraunces,Georgia,serif", body: "Inter,system-ui,sans-serif", caps: false },
};

export interface LookStyle { className: string; vars: Record<string, string> }
/** The shop root's class + CSS variables for a look (the preview's applyCfg). Pure. */
export function lookStyle(look: ShopLook): LookStyle {
  const brand = look.layout === "brand", d = look.dark;
  const bg = d ? "#0e0f12" : brand ? "#ffffff" : "#f5f5f7";
  const fg = d ? "#f3f4f6" : "#17181c";
  const btn = look.btn, sale = look.sale;
  // text on the band: white when both top colours carry white, else whichever reads on the first colour
  const onTop = contrast(look.top1, "#ffffff") >= contrast(look.top1, "#111111") && contrast(look.top2, "#ffffff") >= 2.2 ? "#ffffff" : textOn(look.top1);
  const f = LOOK_FONTS[look.font];
  return {
    className: `l-${look.layout}${look.corners === "sharp" ? " v-sharp" : ""}${f.caps ? " v-caps" : ""}`,
    vars: {
      "--s-bg": bg, "--s-fg": fg, "--s-card": d ? "#191b21" : "#ffffff", "--s-mut": d ? "#9a9eaa" : "#6c7080", "--s-line": d ? "#2a2d36" : "#e6e7ec",
      "--s-acc": btn, "--s-on": textOn(btn), "--s-acc2": mixHex(btn, bg, 0.9), "--s-ok": d ? "#5fe08a" : "#16a34a",
      "--s-sale": sale, "--top1": look.top1, "--top2": look.top2, "--on-top": onTop,
      "--s-hero": `linear-gradient(120deg, ${look.top1}, ${look.top2})`,
      "--s-head": f.head, "--s-font": f.body, "--s-r": look.corners === "sharp" ? "0px" : "14px", "--sc": btn,
    },
  };
}
