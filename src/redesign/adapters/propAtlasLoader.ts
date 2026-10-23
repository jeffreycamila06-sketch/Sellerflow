// Loaders of the font-C atlases (proportional DejaVu Sans Regular text + Bold buyer number, and
// Noto Sans CJK TC Regular cells) — DYNAMIC imports, so vite code-splits them out of the main
// chunk like glyphAtlas.cjk.ts (prop ≈ 0.6 MB; CJK regular 18/20/24/32 ≈ 2–5 MB each). They are
// only ever requested by the generic-printer / Niimbot image paths for the compact sizes —
// and only the CJK sizes a label will actually paint with (propPlanCjkSizes); the D520BT
// stream never touches them. Same contract as cjkAtlasLoader: one in-flight promise per
// atlas, a failed load clears the slot so the next print retries, and the print falls back
// to the fixed-cell layout.
import type { PropAtlas, GlyphAtlas, CjkRegSize } from "./stickerRaster";

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

const cjkReg: Partial<Record<CjkRegSize, GlyphAtlas>> = {};
const cjkRegInflight: Partial<Record<CjkRegSize, Promise<GlyphAtlas>>> = {};
function importCjkReg(size: CjkRegSize): Promise<{ CJK_REG_ATLAS: GlyphAtlas }> {
  switch (size) {
    case 18: return import("./glyphAtlas.cjkReg18");
    case 20: return import("./glyphAtlas.cjkReg20");
    case 24: return import("./glyphAtlas.cjkReg24");
    default: return import("./glyphAtlas.cjkReg32");
  }
}
export function loadCjkRegAtlas(size: CjkRegSize): Promise<GlyphAtlas> {
  const have = cjkReg[size];
  if (have) return Promise.resolve(have);
  let p = cjkRegInflight[size];
  if (!p) {
    p = importCjkReg(size).then(
      (m) => { cjkReg[size] = m.CJK_REG_ATLAS; return m.CJK_REG_ATLAS; },
      (err) => { cjkRegInflight[size] = undefined; throw err; },
    );
    cjkRegInflight[size] = p;
  }
  return p;
}
