// Seller Website v3 — the editor's side of a shop's look (item 6). Pure, unit-tested.
// The editor always shows a full look; an existing shop keeps none until the seller changes a look setting
// (then the whole look is saved and the shop switches to it). Text or product edits never add a look.
import type { ShopDesign } from "../../website/shopApi";
import { NEW_SHOP_LOOK, LOOK_PRESETS, type ShopLook } from "../../website/v3/look";
import { themeOf, type ThemeKey } from "../../website/v2/theme";

/** Item 8 (approved mapping): a shop without a look shows in the editor as Marketplace with its Build 1 theme's
 *  values; the shop colour, when picked, is the button colour. The sale colour (shown only in the Brand store) is the
 *  guard's safe red for the body. Nothing is saved until the seller changes a look setting. */
export const LEGACY_LOOK: Record<ThemeKey, ShopLook> = {
  pop: { layout: "market", top1: "#ff7a45", top2: "#c81e4a", btn: "#ee4d2d", sale: "#dc2626", dark: false, font: "friendly", corners: "round" },
  boutique: { layout: "market", top1: "#d9c7ae", top2: "#a98567", btn: "#2f4a3a", sale: "#dc2626", dark: false, font: "classic", corners: "sharp" },
  bold: { layout: "market", top1: "#22252e", top2: "#6b2a5a", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "modern", corners: "sharp" },
};
const HEX = /^#[0-9a-fA-F]{6}$/;
export function legacyLook(draft: ShopDesign): ShopLook {
  const base = LEGACY_LOOK[themeOf(draft)];
  const c = String(draft.color || "");
  return HEX.test(c) ? { ...base, btn: c.toLowerCase() } : { ...base };
}
/** The look the editor shows for this draft: its own, else the approved mapping of its Build 1 theme. */
export function editorLook(draft: ShopDesign): ShopLook {
  return draft.look ?? legacyLook(draft);
}
/** A seller who has no website yet starts on Brand store + Ocean (saved with the first Save). */
export function newWebsiteDraft(): ShopDesign {
  return { look: { ...NEW_SHOP_LOOK } };
}
/** The draft change for one look setting: the whole look is saved (so the shop shows exactly what the editor shows). */
export function lookPatch(draft: ShopDesign, p: Partial<ShopLook>): Partial<ShopDesign> {
  return { look: { ...editorLook(draft), ...p } };
}
/** A ready combination fills in the colours, body, font and corners; the layout and the tile pick stay. */
export function presetPatch(draft: ShopDesign, key: string): Partial<ShopDesign> {
  const pr = LOOK_PRESETS.find((x) => x.key === key);
  return pr ? lookPatch(draft, { ...pr.look }) : {};
}
/** Which ready combination the look is exactly on (none once the seller edits a colour). */
export function presetOf(l: ShopLook): string | null {
  const same = (a: object, b: ShopLook) => Object.entries(a).every(([k, v]) => b[k as keyof ShopLook] === v);
  return LOOK_PRESETS.find((p) => same(p.look, l))?.key ?? null;
}
/** The categories that can be a big tile: the seller's categories that have a picture. */
export function tileChoices(draft: ShopDesign, cats: string[]): string[] {
  return cats.filter((c) => !!draft.catPics?.[c]);
}
/** Tap a category to make it a big tile (or tap again to remove it); at most 2, the newest pick replaces the oldest.
 *  `null` = automatic (the first two categories with pictures). */
export function tileTogglePatch(draft: ShopDesign, cat: string | null): Partial<ShopDesign> {
  const next = { ...editorLook(draft) };
  const cur = next.tiles || [];
  const tiles = cat === null ? [] : cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat].slice(-2);
  if (tiles.length) next.tiles = tiles; else delete next.tiles;
  return { look: next };
}
