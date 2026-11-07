// ONE STICKER — text: what prints, how a line is measured, wrapped and painted (pure).
//
//   printableText()  NFC; "fancy" letters (𝐀𝐦𝐲 𝓐𝓶𝔂 Ⓐ 🄰 🅰) → normal "Amy"; emoji removed; every
//                    other printable character KEPT (kana, 、。「」, full-width １２３Ｍ, half-width
//                    ｶﾅ, Hangul, Thai, Arabic, Cyrillic, Vietnamese …). Full-width is NOT folded.
//   pieces           each character's glyph source: sans (outline) · cjkx (kana / full-width
//                    outline) · cjk (ideograph atlas) · fb (fallback drawer, whole runs so the
//                    device shapes Thai marks and joins Arabic letters; right-to-left phrases are
//                    kept as one run).
//   wrapText()       word wrap (Intl.Segmenter when present: Thai word breaks, one break per CJK
//                    character), a word longer than the line is split by graphemes, the last kept
//                    line ends with "…" when the text does not fit.
import { cjkCellFor, cjkGlyph, dilateBits, fallbackRun, outlineGlyph, EMPTY_GLYPH, type CjkCell, type GlyphBits, type SansFace, type SansWeight } from "./oneStickerFonts";
import type { GlyphAtlas } from "./stickerRaster";

// ── What prints ───────────────────────────────────────────────────────────────────────────────
const isEmojiCp = (cp: number): boolean =>
  (cp >= 0x1f000 && cp <= 0x1faff && !(cp >= 0x1f130 && cp <= 0x1f189)) || // pictographs, flags (squared letters handled below)
  (cp >= 0x1fb00 && cp <= 0x1fbff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) ||
  (cp >= 0x1f1e6 && cp <= 0x1f1ff) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || cp === 0x20e3 ||
  (cp >= 0xe0020 && cp <= 0xe007f) || (cp >= 0x2300 && cp <= 0x23ff && cp !== 0x2318) || cp === 0x3030 || cp === 0x303d || cp === 0x3297 || cp === 0x3299;
// Enclosed / styled letters that NFKC does not fold (negative squared/circled forms).
function enclosedLetter(cp: number): string | null {
  if (cp >= 0x1f130 && cp <= 0x1f149) return String.fromCharCode(65 + cp - 0x1f130); // 🄰 squared A–Z
  if (cp >= 0x1f150 && cp <= 0x1f169) return String.fromCharCode(65 + cp - 0x1f150); // 🅐 negative circled
  if (cp >= 0x1f170 && cp <= 0x1f189) return String.fromCharCode(65 + cp - 0x1f170); // 🅰 negative squared
  if (cp >= 0x24b6 && cp <= 0x24cf) return String.fromCharCode(65 + cp - 0x24b6);   // Ⓐ circled A–Z
  if (cp >= 0x24d0 && cp <= 0x24e9) return String.fromCharCode(97 + cp - 0x24d0);   // ⓐ circled a–z
  return null;
}
// "Fancy" letters → plain: Mathematical Alphanumeric Symbols, letterlike styled letters, circled
// numbers, modifier/small letters. NFKC per character ONLY in these blocks (never on full-width
// forms, kana or CJK, which must print as they are).
const isFancyBlock = (cp: number): boolean =>
  (cp >= 0x1d400 && cp <= 0x1d7ff) || (cp >= 0x2100 && cp <= 0x214f && cp !== 0x2116 && cp !== 0x2103) ||
  (cp >= 0x2460 && cp <= 0x24ff) || (cp >= 0x1d00 && cp <= 0x1dbf) || (cp >= 0x2070 && cp <= 0x209f) || (cp >= 0x2c7c && cp <= 0x2c7d) || (cp >= 0xa7f8 && cp <= 0xa7f9);
export function printableText(s: string | null | undefined): string {
  if (!s) return "";
  let out = "";
  for (const ch of String(s).normalize("NFC")) {
    const cp = ch.codePointAt(0) ?? 0;
    const enc = enclosedLetter(cp);
    if (enc) { out += enc; continue; }
    if (isEmojiCp(cp)) continue;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) { out += cp === 0x0a || cp === 0x09 ? " " : ""; continue; }
    if (cp === 0x200b || cp === 0x2060 || cp === 0xfeff || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) continue; // invisible / bidi controls
    if (isFancyBlock(cp)) { out += ch.normalize("NFKC"); continue; }
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

// ── Glyph sources ─────────────────────────────────────────────────────────────────────────────
export type Source = "sans" | "cjkx" | "cjk" | "fb";
export const isIdeograph = (cp: number): boolean => (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x3134f);
const isRtl = (cp: number): boolean => (cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
const isCombining = (cp: number): boolean => (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x20d0 && cp <= 0x20ff);
/** One character per break opportunity (CJK and kana break between any two characters). */
const isCjkLike = (cp: number): boolean => isIdeograph(cp) || (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff00 && cp <= 0xffef);

export interface Fonts {
  sans: Partial<Record<SansWeight, SansFace>>;
  cjkx?: SansFace | null;
  cjk?: Partial<Record<CjkCell, GlyphAtlas>>; // painting only; layout never needs it
}
function sansFace(f: Fonts, w: SansWeight): SansFace | null { return f.sans[w] ?? f.sans[700] ?? f.sans[400] ?? f.sans[900] ?? null; }
export function sourceOf(cp: number, f: Fonts): Source {
  const any = sansFace(f, 400);
  if (any?.g[cp] != null) return "sans";
  if (f.cjkx?.g[cp] != null) return "cjkx";
  if (isIdeograph(cp)) return "cjk";
  return "fb";
}

// CJK / kana thickness for Bold and Extra (the ideograph atlases are Regular).
export function cjkInk(px: number, w: SansWeight): { dx: number; dy: number } {
  if (w === 400) return { dx: 0, dy: 0 };
  if (w === 700) return { dx: Math.max(1, Math.round(px / 26)), dy: 0 };
  return { dx: Math.max(2, Math.round(px / 15)), dy: Math.max(1, Math.round(px / 34)) };
}

// A measured piece of one line.
export interface Piece { src: Source; text: string; cp: number; adv: number; rtl?: boolean }
export interface LineRun { pieces: Piece[]; width: number; text: string }

function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) { const out: string[] = []; for (const g of new Seg(undefined, { granularity: "grapheme" }).segment(s)) out.push(g.segment); return out; }
  return Array.from(s);
}
/** Measure `text` at px/weight → pieces (one per glyph, one per fallback run). */
export function measure(text: string, px: number, weight: SansWeight, f: Fonts): LineRun {
  const pieces: Piece[] = [];
  let width = 0;
  const face = sansFace(f, weight);
  const ink = cjkInk(px, weight);
  let fb = "", fbRtl = false;
  const flushFb = () => {
    if (!fb) return;
    const g = fallbackRun(fb, px, weight, fbRtl);
    const adv = g ? Math.round(g.adv) : 0;
    pieces.push({ src: "fb", text: fb, cp: 0, adv, rtl: fbRtl });
    width += adv; fb = ""; fbRtl = false;
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    let src = sourceOf(cp, f);
    if (src === "sans" && fb && (isCombining(cp) || (cp === 0x20 && fbRtl))) src = "fb"; // a mark / space inside a fallback run stays with it
    if (src === "fb") { if (isRtl(cp)) fbRtl = true; fb += ch; continue; }
    flushFb();
    let adv = 0;
    if (src === "sans" && face) adv = outlineGlyph(face, `s${weight}`, cp, px)?.adv ?? 0;
    else if (src === "cjkx" && f.cjkx) adv = (outlineGlyph(f.cjkx, "x", cp, px)?.adv ?? px) + ink.dx;
    else if (src === "cjk") { const c = cjkCellFor(px); adv = c.cell * c.mag + Math.max(1, ink.dx) + Math.max(1, Math.round(px / 24)); }
    pieces.push({ src, text: ch, cp, adv });
    width += adv;
  }
  flushFb();
  return { pieces, width: Math.round(width), text };
}

// ── Wrapping ──────────────────────────────────────────────────────────────────────────────────
interface Token { s: string; space: boolean }
function tokens(text: string): Token[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const raw: string[] = [];
  if (Seg) for (const g of new Seg("th", { granularity: "word" }).segment(text)) raw.push(g.segment);
  else raw.push(...text.split(/(\s+)/).filter(Boolean));
  const out: Token[] = [];
  for (const t of raw) {
    if (/^\s+$/.test(t)) { out.push({ s: " ", space: true }); continue; }
    // CJK / kana / full-width: a break opportunity between every character
    let buf = "";
    for (const g of graphemes(t)) {
      const cp = g.codePointAt(0) ?? 0;
      if (isCjkLike(cp)) { if (buf) { out.push({ s: buf, space: false }); buf = ""; } out.push({ s: g, space: false }); }
      else buf += g;
    }
    if (buf) out.push({ s: buf, space: false });
  }
  // keep a right-to-left phrase (words + the spaces between them) together → the device draws it
  // in the right order with joined letters
  const merged: Token[] = [];
  const rtlTok = (t: Token) => !t.space && Array.from(t.s).some((c) => isRtl(c.codePointAt(0) ?? 0));
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    const prev = merged[merged.length - 1];
    if (prev && rtlTok(prev) && (rtlTok(t) || (t.space && out[i + 1] && rtlTok(out[i + 1])))) { prev.s += t.s; continue; }
    merged.push({ ...t });
  }
  return merged;
}

export interface WrapResult { lines: LineRun[]; cut: boolean }
const ELLIPSIS = "…";
/** Fit `text` on one line ≤ maxW, cutting the end with "…" when needed. */
export function fitOneLine(text: string, px: number, weight: SansWeight, maxW: number, f: Fonts): { line: LineRun; cut: boolean } {
  const full = measure(text, px, weight, f);
  if (full.width <= maxW) return { line: full, cut: false };
  const gs = graphemes(text);
  let lo = 0, hi = gs.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; const t = gs.slice(0, mid).join("").trimEnd() + ELLIPSIS; if (measure(t, px, weight, f).width <= maxW) lo = mid; else hi = mid - 1; }
  const t = gs.slice(0, lo).join("").trimEnd() + ELLIPSIS;
  return { line: measure(lo > 0 ? t : ELLIPSIS, px, weight, f), cut: true };
}
/** Word-wrap into at most maxLines lines; widthOf(i) = the room on line i. */
export function wrapText(text: string, px: number, weight: SansWeight, widthOf: (i: number) => number, maxLines: number, f: Fonts): WrapResult {
  const toks = tokens(text);
  const lines: string[] = [];
  let cur = "";
  let i = 0;
  let cut = false;
  const fits = (s: string, li: number) => measure(s, px, weight, f).width <= widthOf(li);
  while (i < toks.length) {
    const t = toks[i];
    if (t.space) { if (cur) cur += " "; i++; continue; }
    const li = lines.length;
    if (li >= maxLines) { cut = true; break; }
    const cand = cur + t.s;
    if (fits(cand.trimEnd(), li)) { cur = cand; i++; continue; }
    if (cur.trim()) { lines.push(cur.trimEnd()); cur = ""; continue; }
    // a right-to-left phrase wider than the line → break it between its words (first words first)
    if (t.s.includes(" ")) {
      const ws = t.s.split(" ");
      let k = 0;
      while (k < ws.length && fits(ws.slice(0, k + 1).join(" "), li)) k++;
      if (k > 0) { lines.push(ws.slice(0, k).join(" ")); toks[i] = { s: ws.slice(k).join(" "), space: false }; continue; }
    }
    // the token alone is wider than the line → split it by graphemes
    const gs = graphemes(t.s);
    let n = 0;
    while (n < gs.length && fits(gs.slice(0, n + 1).join(""), li)) n++;
    if (n === 0) n = 1;
    lines.push(gs.slice(0, n).join(""));
    toks[i] = { s: gs.slice(n).join(""), space: false };
    if (!toks[i].s) i++;
  }
  if (cur.trim()) { if (lines.length < maxLines) lines.push(cur.trimEnd()); else cut = true; }
  if (!cut && i < toks.length && toks.slice(i).some((t) => !t.space)) cut = true;
  const out = lines.map((s) => measure(s, px, weight, f));
  if (cut && out.length) {
    const last = out.length - 1;
    out[last] = fitOneLine(lines[last] + " " + ELLIPSIS.repeat(3), px, weight, widthOf(last), f).line;
    // fitOneLine cuts our padding and appends "…"
  }
  return { lines: out, cut };
}

// ── Painting ──────────────────────────────────────────────────────────────────────────────────
export interface Ink { w: number; h: number; rowBytes: number; buf: Uint8Array }
export function newInk(w: number, h: number): Ink { const rowBytes = (w + 7) >> 3; return { w, h, rowBytes, buf: new Uint8Array(rowBytes * h) }; }
export function blitBits(dst: Ink, g: GlyphBits, x: number, y: number, clipRight = dst.w): void {
  for (let gy = 0; gy < g.h; gy++) {
    const Y = y + gy; if (Y < 0 || Y >= dst.h) continue;
    for (let gx = 0; gx < g.w; gx++) {
      if (!(g.buf[gy * g.rowBytes + (gx >> 3)] & (0x80 >> (gx & 7)))) continue;
      const X = x + gx; if (X < 0 || X >= clipRight) continue;
      dst.buf[Y * dst.rowBytes + (X >> 3)] |= 0x80 >> (X & 7);
    }
  }
}
/** The ink box of a measured line relative to its baseline: [top (negative), bottom]. */
export function lineExtent(run: LineRun, px: number, weight: SansWeight, f: Fonts): { asc: number; desc: number } {
  let asc = 0, desc = 0;
  for (const g of glyphsOf(run, px, weight, f)) { if (!g.bits || g.bits.w === 0) continue; asc = Math.max(asc, -g.bits.y0); desc = Math.max(desc, g.bits.y0 + g.bits.h); }
  return { asc, desc };
}
interface Placed { x: number; bits: GlyphBits | null }
function glyphsOf(run: LineRun, px: number, weight: SansWeight, f: Fonts): Placed[] {
  const out: Placed[] = [];
  const face = sansFace(f, weight);
  const ink = cjkInk(px, weight);
  const { cell, mag } = cjkCellFor(px);
  let pen = 0;
  for (const p of run.pieces) {
    let bits: GlyphBits | null = null;
    if (p.src === "sans" && face) bits = outlineGlyph(face, `s${weight}`, p.cp, px);
    else if (p.src === "cjkx" && f.cjkx) { const g = outlineGlyph(f.cjkx, "x", p.cp, px); bits = g ? dilateBits(g, ink.dx, ink.dy) : null; }
    else if (p.src === "cjk") {
      const g = cjkGlyph(f.cjk?.[cell], cell, mag, p.cp, px);
      bits = g ? dilateBits(g, ink.dx, ink.dy) : fallbackRun(p.text, px, weight, false); // an ideograph the atlas lacks → device font
      if (bits && !g) bits = { ...bits, x0: bits.x0 + Math.round((p.adv - bits.adv) / 2) };
    } else if (p.src === "fb") bits = fallbackRun(p.text, px, weight, !!p.rtl);
    out.push({ x: Math.round(pen), bits: bits ?? EMPTY_GLYPH(p.adv) });
    pen += p.adv;
  }
  return out;
}
/** Paint a measured line with its pen at (x, baseline); ink at/after clipRight is not drawn. */
export function paintLine(dst: Ink, run: LineRun, px: number, weight: SansWeight, f: Fonts, x: number, baseline: number, clipRight = dst.w): void {
  for (const g of glyphsOf(run, px, weight, f)) if (g.bits && g.bits.w) blitBits(dst, g.bits, x + g.x + g.bits.x0, baseline + g.bits.y0, clipRight);
}
/** Which CJK atlas cells the given line sizes need (to load them before painting). */
export function cjkCellsFor(sizes: number[]): CjkCell[] { return [...new Set(sizes.map((s) => cjkCellFor(s).cell))]; }
export const hasIdeograph = (s: string): boolean => { for (const ch of s) if (isIdeograph(ch.codePointAt(0) ?? 0)) return true; return false; };
export const needsCjkx = (s: string, f: Fonts): boolean => { for (const ch of s) if (sourceOf(ch.codePointAt(0) ?? 0, f) === "cjkx") return true; return false; };
