// DEV/BUILD-TIME ONLY — generates a deterministic 1-bit bitmap glyph atlas for
// the bitmap sticker path (src/redesign/adapters/stickerRaster.ts). NOT shipped
// in the app bundle; only its OUTPUT (a committed .ts atlas) is. Run once per
// font source; the committed atlas is then frozen and drives byte-exact goldens.
//
//   Latin (this container):  node scripts/gen-glyph-atlas.mjs latin
//   CJK  (Mac/CI w/ Noto):   node scripts/gen-glyph-atlas.mjs cjk /path/to/NotoSansCJKtc-Regular.otf
//
// Rasterizer: opentype.js path → flatten beziers → even-odd scanline fill at
// pixel centres (holes in a/e/o handled). Cells match the printer's built-in
// font boxes so the raster reproduces the TEXT layout:
//   font "2" 12x20 · font "3" 16x24 · font "4" 24x32 · CJK "TSS24" 24x24.
import opentype from "opentype.js";
import fs from "node:fs";

const MODE = process.argv[2];
const FONT_ARG = process.argv[3];

// Cell geometry per printer font key (width x height in dots at 1x).
const LATIN_CELLS = { "2": { w: 12, h: 20 }, "3": { w: 16, h: 24 }, "4": { w: 24, h: 32 } };
const CJK_CELL = { w: 24, h: 24 };

const DEJAVU_MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf";

function flatten(cmds) {
  // → array of contours; each contour = array of {x,y} polyline points.
  const contours = [];
  let cur = null, sx = 0, sy = 0, cx = 0, cy = 0;
  const STEPS = 10;
  const lineTo = (x, y) => { cur.push({ x, y }); cx = x; cy = y; };
  for (const c of cmds) {
    if (c.type === "M") { cur = [{ x: c.x, y: c.y }]; contours.push(cur); sx = cx = c.x; sy = cy = c.y; }
    else if (c.type === "L") lineTo(c.x, c.y);
    else if (c.type === "Q") {
      for (let i = 1; i <= STEPS; i++) { const t = i / STEPS, u = 1 - t;
        lineTo(u*u*cx + 2*u*t*c.x1 + t*t*c.x, u*u*cy + 2*u*t*c.y1 + t*t*c.y); }
    } else if (c.type === "C") {
      const x0 = cx, y0 = cy;
      for (let i = 1; i <= STEPS; i++) { const t = i / STEPS, u = 1 - t;
        lineTo(u*u*u*x0 + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x,
               u*u*u*y0 + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y); }
    } else if (c.type === "Z") { if (cur) cur.push({ x: sx, y: sy }); }
  }
  return contours;
}

// Even-odd scanline fill → packed 1-bit rows (MSB-first, ceil(w/8) bytes/row).
// COMPOSITION FALLBACK (Vietnamese): DejaVu Mono Bold lacks ~24 precomposed
// hook-above/stacked glyphs (ả ằ ễ …) but HAS every base letter and combining
// mark, each on the full mono advance (mark outlines centred in the cell). A
// missing precomposed char is therefore drawn as its NFD sequence at ONE pen
// origin — base + mark(s) stack in place; a second mark (ằ = a+breve+grave)
// is raised slightly so it sits above the first instead of on top of it.
function composedCommands(font, ch, fontSize) {
  const direct = font.charToGlyph(ch);
  if (direct && direct.index !== 0) return { cmds: direct.getPath(0, 0, fontSize).commands, glyph: direct };
  const parts = Array.from(ch.normalize("NFD"));
  if (parts.length < 2) return null;
  const glyphs = parts.map((p) => font.charToGlyph(p));
  if (glyphs.some((g) => !g || g.index === 0)) return null;
  const cmds = [];
  let markIdx = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const isMark = i > 0; // NFD: base first, marks after
    const raise = isMark && markIdx > 0 ? -0.17 * fontSize * markIdx : 0; // negative y = up
    if (isMark) markIdx++;
    cmds.push(...glyphs[i].getPath(0, raise, fontSize).commands);
  }
  return { cmds, glyph: glyphs[0] };
}

function rasterCell(font, ch, cellW, cellH) {
  const upm = font.unitsPerEm;
  const asc = font.ascender, desc = font.descender; // desc < 0
  const scale = cellH / (asc - desc);
  const fontSize = upm * scale;
  const composed = composedCommands(font, ch, fontSize);
  if (!composed) return null;
  const contours = flatten(composed.cmds);
  const advance = (composed.glyph.advanceWidth || upm) * scale;
  const xOff = Math.round((cellW - advance) / 2);
  const yBase = Math.round(asc * scale); // baseline row inside the cell
  const rowBytes = Math.ceil(cellW / 8);
  const bytes = new Uint8Array(rowBytes * cellH);
  let any = false;
  for (let py = 0; py < cellH; py++) {
    const y = py - yBase + 0.5; // glyph-space y at pixel centre
    const xs = [];
    for (const contour of contours) {
      for (let i = 0; i + 1 < contour.length; i++) {
        const a = contour[i], b = contour[i + 1];
        const ay = a.y, by = b.y;
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const t = (y - ay) / (by - ay);
          xs.push(a.x + t * (b.x - a.x) + xOff);
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.round(xs[k]), x1 = Math.round(xs[k + 1]);
      for (let px = Math.max(0, x0); px < Math.min(cellW, x1); px++) {
        bytes[py * rowBytes + (px >> 3)] |= (0x80 >> (px & 7)); any = true;
      }
    }
  }
  return any ? bytes : null; // null = blank glyph (e.g. space)
}

function b64(bytes) { return Buffer.from(bytes).toString("base64"); }

// Full Latin coverage for the owner's markets (Vietnamese incl. every tone-mark
// combination, Indonesian/Filipino/European names): ASCII + Latin-1 letters +
// Latin Extended-A/B + Latin Extended Additional (Vietnamese lives in 1E00-1EFF).
// Chars the font can't render even by NFD composition are skipped (the runtime
// per-char transliteration fallback covers those — never tofu).
const LATIN_RANGES = [[0x20, 0x7e], [0xa1, 0xff], [0x100, 0x17f], [0x180, 0x24f], [0x1e00, 0x1eff]];

function genLatin() {
  const font = opentype.loadSync(FONT_ARG || DEJAVU_MONO_BOLD);
  const fonts = {};
  let n = 0;
  for (const [key, cell] of Object.entries(LATIN_CELLS)) {
    const glyphs = {};
    for (const [lo, hi] of LATIN_RANGES) {
      for (let cp = lo; cp <= hi; cp++) {
        const bytes = rasterCell(font, String.fromCodePoint(cp), cell.w, cell.h);
        if (bytes) { glyphs[cp] = b64(bytes); n++; }
      }
    }
    fonts[key] = { w: cell.w, h: cell.h, glyphs };
  }
  const out = `// AUTO-GENERATED by scripts/gen-glyph-atlas.mjs — DO NOT EDIT BY HAND.
// 1-bit bitmap Latin font (ASCII + Latin-1 + Latin Ext-A/B + Ext Additional —
// full Vietnamese incl. composed tone marks) for the bitmap sticker path.
// Cells: font "2" 12x20, "3" 16x24, "4" 24x32. Bit 1 = ink. Base64 rows,
// MSB-first, ceil(w/8) bytes/row x h rows. Source: DejaVu Sans Mono Bold
// (missing precomposed glyphs composed from NFD base + combining marks).
import type { GlyphAtlas } from "./stickerRaster";
export const LATIN_ATLAS: GlyphAtlas = ${JSON.stringify(fonts)};
`;
  fs.writeFileSync("src/redesign/adapters/glyphAtlas.latin.ts", out);
  console.log("wrote src/redesign/adapters/glyphAtlas.latin.ts", n, "glyphs", (out.length / 1024).toFixed(1), "KB");
}

function genCjk() {
  if (!FONT_ARG) { console.error("CJK mode needs a font path (Noto Sans CJK TC)."); process.exit(1); }
  const font = opentype.loadSync(FONT_ARG);
  const glyphs = {};
  let n = 0;
  // Full Big5 / common-CJK coverage: every codepoint in the ideograph ranges the
  // TEXT path renders (classifyScript: U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF) that
  // this font actually has a glyph for. Also halfwidth ASCII so mixed CJK fields
  // (store names) render fully inside the 24-wide CJK cell.
  const ranges = [[0x20, 0x7e], [0x4e00, 0x9fff], [0x3400, 0x4dbf], [0xf900, 0xfaff]];
  for (const [lo, hi] of ranges) {
    for (let cp = lo; cp <= hi; cp++) {
      const g = font.charToGlyph(String.fromCodePoint(cp));
      if (!g || g.index === 0) continue; // no glyph in this font → skip
      const bytes = rasterCell(font, String.fromCodePoint(cp), CJK_CELL.w, CJK_CELL.h);
      if (bytes) { glyphs[cp] = b64(bytes); n++; }
    }
  }
  const fonts = { cjk: { w: CJK_CELL.w, h: CJK_CELL.h, glyphs } };
  const out = `// AUTO-GENERATED by scripts/gen-glyph-atlas.mjs cjk — DO NOT EDIT BY HAND.
// 1-bit bitmap CJK font (24x24, full ideograph coverage) for the bitmap sticker
// path. Bit 1 = ink. Base64 rows, MSB-first, 3 bytes/row x 24. Source: Noto Sans CJK TC.
import type { GlyphAtlas } from "./stickerRaster";
export const CJK_ATLAS: GlyphAtlas = ${JSON.stringify(fonts)};
`;
  fs.writeFileSync("src/redesign/adapters/glyphAtlas.cjk.ts", out);
  console.log("wrote src/redesign/adapters/glyphAtlas.cjk.ts", n, "glyphs", (out.length / 1024 / 1024).toFixed(2), "MB");
}

if (MODE === "latin") genLatin();
else if (MODE === "cjk") genCjk();
else { console.error("usage: gen-glyph-atlas.mjs latin | cjk <fontPath>"); process.exit(1); }
