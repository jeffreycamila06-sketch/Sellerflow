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
// kana / CJK punctuation / full-width sit in one Chinese-size cell like the ideographs next to them;
// every other script (Hangul, Thai, Arabic …) is drawn a word at a time and keeps its real width.
const isOneCell = (cp: number) => (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff00 && cp <= 0xffef);

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

// One synthetic glyph group: a single kana / full-width character in one cell (`one`), or a run (a
// word, or several words with their spaces) cut into pieces BETWEEN letters, each piece as wide as
// its letters. cuts = each piece's [x0, x1) in the run drawn at SYNTH_CELL24_EM, left → right.
interface Cellish { text: string; rtl: boolean; one: boolean; pua: number[]; cuts: [number, number][] }
export interface AllScriptsPrep {
  payload: RasterPayload;
  synth: Set<number>;
  adv: Map<number, number>; // piece advance in em (stickerRaster.withSyntheticCjk) — runs only
  joined: Set<number>; // pieces followed by the rest of the same word (no gap, no line break between)
  cells: Cellish[];
  extraCyrillic: boolean; // the D520BT payload has Cyrillic → give it the Cyrillic atlas
}
export const SYNTH_CELL24_EM = 17; // the 24-cell CJK atlas = Noto Sans CJK at em ≈ 16.6 (asc − desc fit)
const PIECE_MAX = 24;                // a piece never wider than one cell of that atlas
function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) { const out: string[] = []; for (const g of new Seg(undefined, { granularity: "grapheme" }).segment(s)) out.push(g.segment); return out; }
  return Array.from(s);
}
function drawRun(text: string, px: number, rtl: boolean, cjkx: SansFace | null): GlyphBits | null {
  const cps = Array.from(text);
  if (cps.length === 1 && cjkx) {
    const cp = cps[0].codePointAt(0) ?? 0;
    if (cjkx.g[cp] != null) return outlineGlyph(cjkx, "x", cp, px);
  }
  return fallbackRun(text, px, 400, rtl);
}
/** Cut a run between letters into pieces ≤ one cell wide (visual left → right). */
function pieceCuts(text: string, rtl: boolean): [number, number][] {
  const gs = graphemes(text);
  const W = drawRun(text, SYNTH_CELL24_EM, rtl, null)?.adv ?? gs.length * SYNTH_CELL24_EM;
  const pre: number[] = [0];
  for (let i = 1; i <= gs.length; i++) pre.push(i === gs.length ? W : (drawRun(gs.slice(0, i).join(""), SYNTH_CELL24_EM, rtl, null)?.adv ?? 0));
  const spans: [number, number][] = [];
  let a = 0;
  while (a < gs.length) {
    let b = a + 1;
    while (b < gs.length && pre[b + 1] - pre[a] <= PIECE_MAX) b++;
    spans.push([pre[a], pre[b]]);
    a = b;
  }
  const cuts = spans.map(([l0, l1]) => (rtl ? [W - l1, W - l0] : [l0, l1]) as [number, number]);
  return rtl ? cuts.reverse() : cuts;
}

/**
 * The payload with unsupported characters mapped to synthetic codepoints, or null when there is
 * nothing to change (switch off, or only ASCII / Latin / Chinese / emoji) → render exactly as today.
 * `extraAtlas` = this path already has the Cyrillic atlas (generic / Niimbot).
 */
export function prepareAllScripts(payload: RasterPayload, extraAtlas: boolean, on: boolean = allScriptsOn): AllScriptsPrep | null {
  if (!on) return null;
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
  const adv = new Map<number, number>();
  const joined = new Set<number>();
  const cellFor = (text: string, rtl: boolean, one: boolean): Cellish => {
    const key = `${rtl ? 1 : 0}|${one ? 1 : 0}|${text}`;
    const hit = byText.get(key);
    if (hit) return hit;
    const cuts: [number, number][] = one ? [[0, PIECE_MAX]] : pieceCuts(text, rtl);
    const pua: number[] = [];
    cuts.forEach(([x0, x1], i) => { pua.push(next); synth.add(next); if (!one) { adv.set(next, Math.max(1, x1 - x0) / SYNTH_CELL24_EM); if (i < cuts.length - 1) joined.add(next); } next++; });
    const c = { text, rtl, one, pua, cuts };
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
      if (g === " " && run && runRtl) { // right-to-left only: keep a phrase together with its real spaces (its words in order)
        const nextCp = gs[i + 1]?.codePointAt(0) ?? 0;
        if (nextCp && !covered(nextCp) && isRtl(nextCp)) { run += g; continue; }
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
  return { payload: mapped, synth, adv, joined, cells, extraCyrillic: hasCyr && !extraAtlas };
}

// Draw each synthetic glyph for one cell family: the 24-cell CJK atlas (em 17, baseline 19 —
// gen-glyph-atlas "cjk") or an em-cell size s (em s, baseline 0.88·s — "cjkreg"). A one-cell character
// is centred in its cell; a run is drawn once (shaping) and each piece is cut out, left-aligned.
// Runs (Thai, Arabic, Hangul …) reach above and below a Chinese character, so in every cell they are
// drawn at the 24-cell proportions (em 17/24 of the cell, baseline 19/24) — the marks and tails fit
// inside the cell; their advance uses the same em (stickerRaster runEm). One-cell characters (kana,
// CJK punctuation, full-width) keep the cell's own em like the ideographs.
export const runEmFor = (cell: number): number => Math.round((cell * SYNTH_CELL24_EM) / 24);
const runBaseFor = (cell: number): number => Math.round((cell * 19) / 24);
function cellsGlyphs(prep: AllScriptsPrep, cell: number, oneEm: number, oneBase: number): Record<number, string> {
  const cjkx = getSansFace("cjkx");
  const out: Record<number, string> = {};
  const rb = (cell + 7) >> 3;
  for (const c of prep.cells) {
    const em = c.one ? oneEm : runEmFor(cell), base = c.one ? oneBase : runBaseFor(cell);
    const sc = em / SYNTH_CELL24_EM;
    const g = drawRun(c.text, em, c.rtl, cjkx);
    c.cuts.forEach(([m0, m1], i) => {
      const cellBuf = new Uint8Array(rb * cell);
      if (g && g.w) {
        const x0 = c.one ? 0 : Math.round(m0 * sc), x1 = c.one ? Infinity : Math.round(m1 * sc);
        const shift = c.one ? Math.floor((cell - Math.round(g.adv)) / 2) : -x0; // pen x → cell x
        for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
          if (!(g.buf[y * g.rowBytes + (x >> 3)] & (0x80 >> (x & 7)))) continue;
          const pen = x + g.x0;
          if (!c.one && (pen < x0 || pen >= x1)) continue;
          const X = pen + shift, Y = base + g.y0 + y;
          if (X < 0 || Y < 0 || X >= cell || Y >= cell) continue;
          cellBuf[Y * rb + (X >> 3)] |= 0x80 >> (X & 7);
        }
      }
      out[c.pua[i]] = bytesToBase64(cellBuf);
    });
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
