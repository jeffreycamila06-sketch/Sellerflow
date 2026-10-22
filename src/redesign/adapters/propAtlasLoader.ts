// Loaders of the font-C atlases (proportional DejaVu Sans Bold + Noto Sans CJK TC Bold cells)
// — DYNAMIC imports, so vite code-splits them out of the main chunk like glyphAtlas.cjk.ts
// (prop ≈ 0.5 MB, CJK bold 24 ≈ 2.9 MB, 32 ≈ 4.9 MB). They are only ever requested by the
// generic-printer / Niimbot image paths for the compact sizes; the D520BT stream never
// touches them. Same contract as cjkAtlasLoader: one in-flight promise, a failed load clears
// the slot so the next print retries, and the print falls back to the fixed-cell layout.
import type { PropAtlas, GlyphAtlas } from "./stickerRaster";

let prop: PropAtlas | null = null;
let propInflight: Promise<PropAtlas> | null = null;
export function loadPropAtlas(): Promise<PropAtlas> {
  if (prop) return Promise.resolve(prop);
  if (!propInflight) {
    propInflight = import("./glyphAtlas.prop").then(
      (m) => { prop = m.PROP_ATLAS; return prop; },
      (err) => { propInflight = null; throw err; },
    );
  }
  return propInflight;
}

const cjkBold: Partial<Record<24 | 32, GlyphAtlas>> = {};
const cjkBoldInflight: Partial<Record<24 | 32, Promise<GlyphAtlas>>> = {};
export function loadCjkBoldAtlas(size: 24 | 32): Promise<GlyphAtlas> {
  const have = cjkBold[size];
  if (have) return Promise.resolve(have);
  let p = cjkBoldInflight[size];
  if (!p) {
    p = (size === 24 ? import("./glyphAtlas.cjkBold24") : import("./glyphAtlas.cjkBold32")).then(
      (m) => { cjkBold[size] = m.CJK_BOLD_ATLAS; return m.CJK_BOLD_ATLAS; },
      (err) => { cjkBoldInflight[size] = undefined; throw err; },
    );
    cjkBoldInflight[size] = p;
  }
  return p;
}
