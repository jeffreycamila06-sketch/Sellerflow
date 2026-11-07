// ALL SCRIPTS on TODAY's sticker (switch sticker_all_scripts_enabled — goes to everyone at once).
//
// Today's image layouts (stickerRaster: fixed cells, 50×30, font C) only draw ASCII, Latin with
// accents, Chinese ideographs (+ Cyrillic on generic / Niimbot). Every other character was silently
// removed (田中さん → 田中). With the switch ON, before the (unchanged) layout runs:
//   • "fancy" letters (𝐀𝐦𝐲 𝓐𝓶𝔂 Ⓐ 🄰 🅰) become normal letters;
//   • every other printable character the atlases lack — kana, 、。「」, full-width ！１２３Ｍ, half-width
//     ｶﾅ, Hangul, Thai (marks right), Arabic (joined, right-to-left), Hebrew, Devanagari … — is drawn
//     into CJK-sized cells (kana / full-width from the bundled Sans outlines, the rest with the
//     device font, a whole word at a time so the shaping is right) and replaced by private-use
//     codepoints that the layout treats as Chinese characters (stickerRaster.withSyntheticCjk);
//   • on the AIMO D520BT a payload with Cyrillic also gets the Cyrillic atlas (the generic and
//     Niimbot paths always had it).
// A payload that is ASCII / Latin / Chinese only gets NO change at all (prepareAllScripts → null),
// so English and Chinese stickers are byte-identical ON vs OFF (tested).
import type { GlyphAtlas, GlyphFont, RasterAtlases, RasterPayload, CjkRegSize } from "./stickerRaster";
import { bytesToBase64 } from "./stickerRaster";
import { fallbackRun, outlineGlyph, getSansFace, loadSansFace, type GlyphBits, type SansFace } from "./oneStickerFonts";

let allScriptsOn = false;
export function setStickerAllScripts(on: boolean): void { allScriptsOn = on === true; }
export function stickerAllScriptsOn(): boolean { return allScriptsOn; }

const isIdeo = (cp: number) => (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff);
const isLatinAtlas = (cp: number) => (cp >= 0xa1 && cp <= 0xff) || (cp >= 0x100 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff);
const isCyr = (cp: number) => cp >= 0x400 && cp <= 0x4ff;
// what stickerRaster strips itself (emoji) or that is not a character at all
const isEmojiOrControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp >= 0x1f000 && !(cp >= 0x1f130 && cp <= 0x1f189) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || cp === 0x20e3 || (cp >= 0xe0000 && cp <= 0xe007f);
const isRtl = (cp: number) => (cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
const isOneCell = (cp: number) => (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f);

// Typographic punctuation the Latin atlas lacks → its plain form, so "O’Brien", "Ana–Maria",
// "Joy…" stay in the normal (Latin) layout instead of switching the line to Chinese-size cells.
const PUNCT_FOLD: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'", "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2033": '"',
  "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-", "\u2026": "...", "\u2022": "\u00b7",
  "\u20ac": "EUR", "\u20b1": "P", "\u20ab": "d", "\u0e3f": "THB",
};
function foldFancy(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  const p = PUNCT_FOLD[ch];
  if (p != null) return p;
  if (cp >= 0x1f130 && cp <= 0x1f149) return String.fromCharCode(65 + cp - 0x1f130);
  if (cp >= 0x1f150 && cp <= 0x1f169) return String.fromCharCode(65 + cp - 0x1f150);
  if (cp >= 0x1f170 && cp <= 0x1f189) return String.fromCharCode(65 + cp - 0x1f170);
  if (cp >= 0x24b6 && cp <= 0x24cf) return String.fromCharCode(65 + cp - 0x24b6);
  if (cp >= 0x24d0 && cp <= 0x24e9) return String.fromCharCode(97 + cp - 0x24d0);
  if ((cp >= 0x1d400 && cp <= 0x1d7ff) || (cp >= 0x2460 && cp <= 0x2473) || (cp >= 0x2100 && cp <= 0x214f && cp !== 0x2116 && cp !== 0x2103)) return ch.normalize("NFKC");
  return ch;
}
const PUA0 = 0xe000; // BMP private use (the legacy emoji strip removes everything ≥ U+1F000)

interface Cellish { text: string; rtl: boolean; slices: number; pua: number[] }
export interface AllScriptsPrep {
  payload: RasterPayload;
  synth: Set<number>;
  cells: Cellish[];
  extraCyrillic: boolean; // the D520BT payload has Cyrillic → give it the Cyrillic atlas
}
function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) { const out: string[] = []; for (const g of new Seg(undefined, { granularity: "grapheme" }).segment(s)) out.push(g.segment); return out; }
  return Array.from(s);
}
/** Measure how many 24-wide cells a run needs (Regular, 24 px em). */
function slicesFor(text: string, rtl: boolean, cjkx: SansFace | null): number {
  const g = drawRun(text, 24, rtl, cjkx);
  return Math.max(1, Math.ceil((g?.adv ?? 24) / 24));
}
function drawRun(text: string, px: number, rtl: boolean, cjkx: SansFace | null): GlyphBits | null {
  const cps = Array.from(text);
  if (cps.length === 1 && cjkx) {
    const cp = cps[0].codePointAt(0) ?? 0;
    if (cjkx.g[cp] != null) return outlineGlyph(cjkx, "x", cp, px);
  }
  return fallbackRun(text, px, 400, rtl);
}

/**
 * The payload with unsupported characters mapped to synthetic codepoints, or null when there is
 * nothing to change (switch off, or only ASCII / Latin / Chinese / emoji) → render exactly as today.
 * `extraAtlas` = this path already has the Cyrillic atlas (generic / Niimbot).
 */
export function prepareAllScripts(payload: RasterPayload, extraAtlas: boolean, on: boolean = allScriptsOn): AllScriptsPrep | null {
  if (!on) return null;
  const cjkx = getSansFace("cjkx");
  const b = payload.buyer ?? {};
  const texts = [payload.storeName ?? "", b.name ?? "", b.handle ?? "", ...(b.orders ?? []).map((o) => o.item ?? "")];
  const hasCyr = texts.some((t) => Array.from(t).some((c) => isCyr(c.codePointAt(0) ?? 0)));
  const extra = extraAtlas || hasCyr;
  const covered = (cp: number) => cp <= 0x7e || isLatinAtlas(cp) || isIdeo(cp) || (extra && (isCyr(cp) || cp === 0x2026)) || isEmojiOrControl(cp) || /\s/.test(String.fromCodePoint(cp));
  let changed = false;
  const cells: Cellish[] = [];
  const byText = new Map<string, Cellish>();
  let next = PUA0;
  const synth = new Set<number>();
  const cellFor = (text: string, rtl: boolean, one: boolean): Cellish => {
    const key = `${rtl ? 1 : 0}|${text}`;
    const hit = byText.get(key);
    if (hit) return hit;
    const slices = one ? 1 : slicesFor(text, rtl, cjkx);
    const pua: number[] = [];
    for (let i = 0; i < slices; i++) { pua.push(next); synth.add(next); next++; }
    const c = { text, rtl, slices, pua };
    byText.set(key, c); cells.push(c);
    return c;
  };
  const map = (s: string): string => {
    if (!s) return s;
    let out = "";
    let run = "", runRtl = false;
    const flush = () => { if (run) { out += String.fromCodePoint(...cellFor(run, runRtl, false).pua); run = ""; runRtl = false; } };
    const gs = graphemes(s);
    for (let i = 0; i < gs.length; i++) {
      let g = gs[i];
      const folded = g === "\u2026" && extra ? g : foldFancy(g); // "…" is in the Cyrillic atlas (generic / Niimbot)
      if (folded !== g) { changed = true; g = folded; }
      const cp = g.codePointAt(0) ?? 0;
      if (g === " " && run && runRtl) { // keep a right-to-left phrase together (its words in order)
        const nextCp = gs[i + 1]?.codePointAt(0) ?? 0;
        if (isRtl(nextCp)) { run += g; continue; }
      }
      if (covered(cp)) { flush(); out += g; continue; }
      changed = true;
      if (isOneCell(cp)) { flush(); out += String.fromCodePoint(...cellFor(g, false, true).pua); continue; }
      if (isRtl(cp)) runRtl = true;
      run += g;
    }
    flush();
    return out;
  };
  const mapped: RasterPayload = {
    ...payload,
    storeName: map(payload.storeName ?? "") || payload.storeName,
    buyer: { ...b, name: b.name != null ? map(b.name) : b.name, handle: b.handle != null ? map(b.handle) : b.handle, orders: b.orders?.map((o) => ({ ...o, item: o.item != null ? map(o.item) : o.item })) },
  };
  if (!changed && !(hasCyr && !extraAtlas)) return null;
  return { payload: mapped, synth, cells, extraCyrillic: hasCyr && !extraAtlas };
}

// Draw each synthetic cell for one cell family: the 24-cell CJK atlas (em ≈ 16.6, baseline 19 —
// gen-glyph-atlas "cjk") or an em-cell size s (baseline 0.88·s — "cjkreg").
function cellsGlyphs(prep: AllScriptsPrep, cell: number, em: number, base: number): Record<number, string> {
  const cjkx = getSansFace("cjkx");
  const out: Record<number, string> = {};
  const rb = (cell + 7) >> 3;
  for (const c of prep.cells) {
    const g = drawRun(c.text, em, c.rtl, cjkx);
    const W = c.slices * cell;
    const big = new Uint8Array(((W + 7) >> 3) * cell);
    const brb = (W + 7) >> 3;
    if (g && g.w) {
      const ox = Math.floor((W - Math.round(g.adv)) / 2) + g.x0;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        if (!(g.buf[y * g.rowBytes + (x >> 3)] & (0x80 >> (x & 7)))) continue;
        const X = ox + x, Y = base + g.y0 + y;
        if (X < 0 || Y < 0 || X >= W || Y >= cell) continue;
        big[Y * brb + (X >> 3)] |= 0x80 >> (X & 7);
      }
    }
    for (let i = 0; i < c.slices; i++) {
      const cellBuf = new Uint8Array(rb * cell);
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const X = i * cell + x;
        if (big[y * brb + (X >> 3)] & (0x80 >> (X & 7))) cellBuf[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
      }
      out[c.pua[i]] = bytesToBase64(cellBuf);
    }
  }
  return out;
}
const withGlyphs = (font: GlyphFont, extra: Record<number, string>): GlyphFont => ({ ...font, glyphs: Object.assign(Object.create(font.glyphs) as Record<number, string>, extra) });
/** The atlases with the synthetic cells added (the originals are untouched, lookups chain to them). */
export function augmentAtlases(atlases: RasterAtlases, prep: AllScriptsPrep, cyrillic?: GlyphAtlas): RasterAtlases {
  const base24: GlyphFont = atlases.cjk?.cjk ?? { w: 24, h: 24, glyphs: {} };
  const out: RasterAtlases = { ...atlases, cjk: { ...(atlases.cjk ?? {}), cjk: withGlyphs(base24, cellsGlyphs(prep, 24, 17, 19)) } };
  if (prep.extraCyrillic && cyrillic && !out.cyrillic) out.cyrillic = cyrillic;
  if (atlases.cjkReg) {
    const reg: NonNullable<RasterAtlases["cjkReg"]> = {};
    for (const [k, a] of Object.entries(atlases.cjkReg) as [string, GlyphAtlas | undefined][]) {
      const size = Number(k) as CjkRegSize;
      if (a?.cjk) reg[size] = { ...a, cjk: withGlyphs(a.cjk, cellsGlyphs(prep, size, size, Math.round(0.88 * size))) };
    }
    out.cjkReg = reg;
  }
  return out;
}
/** Kana / full-width outlines are a lazy chunk: load them before a print that has such text. */
export async function ensureAllScriptsFonts(payload: RasterPayload): Promise<void> {
  if (!allScriptsOn) return;
  const b = payload.buyer ?? {};
  const t = [payload.storeName, b.name, b.handle, ...(b.orders ?? []).map((o) => o.item)].join(" ");
  if (/[\u3000-\u30ff\u31f0-\u31ff\uff00-\uffef]/.test(t)) { try { await loadSansFace("cjkx"); } catch { /* the device font draws them */ } }
}
