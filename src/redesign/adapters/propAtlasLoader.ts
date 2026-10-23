// Loaders of the font-C atlases (proportional DejaVu Sans Bold + Noto Sans CJK TC Bold cells)
// — DYNAMIC imports, so vite code-splits them out of the main chunk like glyphAtlas.cjk.ts
// (prop ≈ 0.65 MB; CJK bold 18 ≈ 2.2 MB, 20 ≈ 2.4 MB, 24 ≈ 2.9 MB, 32 ≈ 5.1 MB). They are
// only ever requested by the generic-printer / Niimbot image paths for the compact sizes —
// and only the CJK sizes a label will actually paint with (propPlanCjkSizes); the D520BT
// stream never touches them. Same contract as cjkAtlasLoader: one in-flight promise per
// atlas, a failed load clears the slot so the next print retries, and the print falls back
// to the fixed-cell layout.
import type { PropAtlas, GlyphAtlas, CjkBoldSize } from "./stickerRaster";

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

const cjkBold: Partial<Record<CjkBoldSize, GlyphAtlas>> = {};
const cjkBoldInflight: Partial<Record<CjkBoldSize, Promise<GlyphAtlas>>> = {};
function importCjkBold(size: CjkBoldSize): Promise<{ CJK_BOLD_ATLAS: GlyphAtlas }> {
  switch (size) {
    case 18: return import("./glyphAtlas.cjkBold18");
    case 20: return import("./glyphAtlas.cjkBold20");
    case 24: return import("./glyphAtlas.cjkBold24");
    default: return import("./glyphAtlas.cjkBold32");
  }
}
export function loadCjkBoldAtlas(size: CjkBoldSize): Promise<GlyphAtlas> {
  const have = cjkBold[size];
  if (have) return Promise.resolve(have);
  let p = cjkBoldInflight[size];
  if (!p) {
    p = importCjkBold(size).then(
      (m) => { cjkBold[size] = m.CJK_BOLD_ATLAS; return m.CJK_BOLD_ATLAS; },
      (err) => { cjkBoldInflight[size] = undefined; throw err; },
    );
    cjkBoldInflight[size] = p;
  }
  return p;
}
