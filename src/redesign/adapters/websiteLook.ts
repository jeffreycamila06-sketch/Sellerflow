// Seller Website v3 — the editor's side of a shop's look (item 6). Pure, unit-tested.
// The editor always shows a full look; the shop keeps none until the seller changes a look setting
// (then the whole look is saved and the shop switches to it).
import type { ShopDesign } from "../../website/shopApi";
import { NEW_SHOP_LOOK, LOOK_PRESETS, type ShopLook } from "../../website/v3/look";

/** The look the editor shows for this draft. */
export function editorLook(draft: ShopDesign): ShopLook {
  return draft.look ?? NEW_SHOP_LOOK;
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
