// Seller Website v4 ("catalogue and slip") — the seller's settings → the new look. Pure, unit-tested.
// The design is fixed; the seller's settings only fill it in:
//   top colour 1   the SIGN: a flat bar with the logo, the shop name, the search and the announcement
//   top colour 2   a thin stripe under the sign (the same colour twice = no stripe to see). Never a blend.
//   button colour  the main button of each page, the active tab, the chat button
//   sale colour    the sale price and the sale tag
//   light / dark   the page ("paper") and the text ("ink"); both are fixed neutrals
//   font           Modern = Archivo · Friendly = Bricolage Grotesque + Figtree · Classic = Newsreader + Archivo
//   corners        sharp = square, round = 12 px photos / 8 px buttons and fields
//   photo shape    tall (4:5) or square, the same frame for every product photo of the shop
// The saved settings, their checks and the colour guard's rules (v3/look.ts) are not changed.
import type { ShopDesign } from "../shopApi";
import { contrast, mixHex, textOn, type LookFont, type LookShape, type ShopLook } from "../v3/look";
import { themeOf, type ThemeKey } from "../v2/theme";

/** What a website started under the new look begins with: a neutral sign and button, so the seller's logo and
 *  photos lead until they pick a colour. (Websites that already exist keep the colours they have.) */
export const NEUTRAL_LOOK: ShopLook = { layout: "brand", top1: "#151515", top2: "#151515", btn: "#151515", sale: "#c2261c", dark: false, font: "modern", corners: "sharp" };

// A shop that never set a look (themes Pop / Boutique / Bold + the shop colour): the same mapping the editor has
// shown for it since v3 (redesign/adapters/websiteLook.ts LEGACY_LOOK — a test keeps the two equal).
const LEGACY: Record<ThemeKey, ShopLook> = {
  pop: { layout: "market", top1: "#ff7a45", top2: "#c81e4a", btn: "#ee4d2d", sale: "#dc2626", dark: false, font: "friendly", corners: "round" },
  boutique: { layout: "market", top1: "#d9c7ae", top2: "#a98567", btn: "#2f4a3a", sale: "#dc2626", dark: false, font: "classic", corners: "sharp" },
  bold: { layout: "market", top1: "#22252e", top2: "#6b2a5a", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "modern", corners: "sharp" },
};
const HEX = /^#[0-9a-fA-F]{6}$/;
/** The settings the new look draws a shop with: its own look, else the mapping of its older theme. */
export function lookFor(d: ShopDesign): ShopLook {
  if (d.look) return d.look;
  const base = LEGACY[themeOf(d)];
  const c = String(d.color || "");
  return HEX.test(c) ? { ...base, btn: c.toLowerCase() } : { ...base };
}
export const shapeOf = (l: Pick<ShopLook, "shape">): LookShape => (l.shape === "square" ? "square" : "tall");

export interface FontSet { head: string; body: string; /** width of the shop name / of prices (Archivo only) */ sign: string; price: string; headWeight: number; priceWeight: number; url: string }
const CJK = '"PingFang TC","Noto Sans TC","Microsoft JhengHei"';
export const FONTS4: Record<LookFont, FontSet> = {
  modern: { head: `Archivo,system-ui,-apple-system,${CJK},sans-serif`, body: `Archivo,system-ui,-apple-system,${CJK},sans-serif`, sign: "112%", price: "80%", headWeight: 680, priceWeight: 700,
    url: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" },
  friendly: { head: `"Bricolage Grotesque",Figtree,system-ui,${CJK},sans-serif`, body: `Figtree,system-ui,-apple-system,${CJK},sans-serif`, sign: "100%", price: "100%", headWeight: 700, priceWeight: 700,
    url: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Figtree:wght@400..700&display=swap" },
  classic: { head: `Newsreader,Georgia,"Songti TC",serif`, body: `Archivo,system-ui,-apple-system,${CJK},sans-serif`, sign: "100%", price: "100%", headWeight: 560, priceWeight: 600,
    url: "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400..700&family=Archivo:wdth,wght@62..125,400..800&display=swap" },
};

export const PAPER = { light: "#fdfdfc", dark: "#111112" } as const;
export const INK = { light: "#151515", dark: "#f1f0ed" } as const;
const READ_TEXT = 4.5;
/** A colour used as TEXT on the page: stepped towards the ink until it reads (4.5 : 1). */
export function readable(c: string, paper: string, ink: string): string {
  let o = c;
  for (let k = 1; contrast(o, paper) < READ_TEXT && k <= 10; k++) o = mixHex(c, ink, k / 10);
  return o;
}
export interface Look4 { className: string; vars: Record<string, string>; font: FontSet; shape: LookShape }
/** The shop root's class + CSS variables in the new look. Pure. */
export function look4Style(look: ShopLook): Look4 {
  const d = look.dark;
  const paper = d ? PAPER.dark : PAPER.light, ink = d ? INK.dark : INK.light;
  const f = FONTS4[look.font];
  // a button colour that can't be told from the page → the ink (the rule the guard has always had)
  const btn = contrast(look.btn, paper) < 1.6 ? ink : look.btn;
  const round = look.corners === "round";
  const shape = shapeOf(look);
  return {
    className: `l-${look.layout} k4${d ? " k4-dark" : ""}${round ? " k4-round" : ""}`,
    font: f, shape,
    vars: {
      "--s-bg": paper, "--s-fg": ink, "--s-card": paper, "--s-mut": d ? "#aaa9a4" : "#5b5b58", "--s-line": d ? "rgba(241,240,237,.17)" : "rgba(21,21,21,.14)",
      "--k-ink3": d ? "#7f7e7a" : "#8d8d89", "--k-back": d ? "#1c1c1d" : "#f0efec", "--k-field": d ? "#17171a" : "#ffffff", "--k-err": d ? "#f87171" : "#c81e1e",
      "--s-acc": btn, "--s-on": textOn(btn), "--s-acct": readable(btn, paper, ink), "--s-acc2": d ? "#1c1c1d" : "#f0efec", "--sc": btn,
      "--s-ok": d ? "#5fd08f" : "#17794a", "--s-okt": d ? "#5fd08f" : "#17794a",
      "--s-sale": look.sale, "--k-onsale": textOn(look.sale), "--k-salet": readable(look.sale, paper, ink),
      "--top1": look.top1, "--top2": look.top2, "--on-top1": textOn(look.top1), "--on-top": textOn(look.top1), "--top-ink": look.top1, "--s-hero": look.top1,
      "--s-head": f.head, "--s-font": f.body, "--k-sst": f.sign, "--k-pst": f.price, "--k-hw": String(f.headWeight), "--k-pw": String(f.priceWeight),
      "--s-r": round ? "12px" : "0px", "--k-rs": round ? "8px" : "0px", "--k-ar": shape === "square" ? "1 / 1" : "4 / 5",
    },
  };
}
/** Load the look's own font files (one choice, not all three). */
export function ensureFonts4(font: LookFont): void {
  try {
    if (document.querySelector(`link[data-sfl-k4-fonts="${font}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = FONTS4[font].url; l.setAttribute("data-sfl-k4-fonts", font);
    document.head.appendChild(l);
  } catch { /* no document */ }
}
