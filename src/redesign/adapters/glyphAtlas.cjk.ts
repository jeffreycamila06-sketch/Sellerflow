// PLACEHOLDER — the real file is AUTO-GENERATED on a machine with Noto Sans CJK TC:
//   node scripts/gen-glyph-atlas.mjs cjk /path/to/NotoSansCJKtc-Regular.otf
// (this container has no CJK font, so Phase 1 ships the pipeline with an empty CJK
// atlas; Latin stickers render fully. A CJK buyer name renders BLANK in bitmap mode
// until this file is generated — run the generator before the CJK dev-verify step.)
// Owner decision 2026-09-06: FULL Big5/ideograph coverage (no reduced set, no
// fallback logic) — the generator emits every ideograph the font carries across
// U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF plus halfwidth ASCII for mixed fields.
import type { GlyphAtlas } from "./stickerRaster";
export const CJK_ATLAS: GlyphAtlas = {};
