// WAYBILL USERNAME — the waybill PDF (TikTok Shop → Shipping labels): read each page, then write
// "@username" on the pages that have a buyer. Everything happens in the browser; the file is never
// uploaded, saved or logged. This module (and pdf-lib) is loaded ONLY by the Waybill username
// screen (dynamic import), so the app's main bundle does not grow.
//
// Output rule: only a NEW drawing is added on top of a page. Same page count, same page size, same
// order; every original drawing command stays byte for byte (pdf-lib keeps the original content
// streams and wraps them in q … Q so nothing they leave behind can move the stamp).
import {
  PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber, PDFRef, PDFRawStream,
  decodePDFRawStream, StandardFonts, StandardFontEmbedder, rgb, type PDFObject, type PDFContext, type PDFPage,
} from "pdf-lib";
import {
  readPage, findSlot, fitStamp, stampable, parseCMap, splitCodes, textLines, pageIds,
  IDENTITY, type Box, type FontInfo, type M, type Resources, type XObj, type SlotResult, type StampPlace, type PageRead,
} from "./waybillPdfRead";

export interface PageInfo {
  index: number;
  box: Box;
  orderId: string | null;   // after "TT Order ID"
  words: string[];          // every word of 8+ letters/digits (tracking numbers for the fallback)
  slot: SlotResult | { ok: false; reason: "rotated" | "unreadable" };
}
export type ScanResult = { ok: true; pages: PageInfo[] } | { ok: false; error: "not_pdf" | "locked" | "no_pages" };

// ── pdf-lib helpers ─────────────────────────────────────────────────────────────────────────────
const N = (s: string) => PDFName.of(s);
const look = (ctx: PDFContext, o: PDFObject | undefined): PDFObject | undefined => (o instanceof PDFRef ? ctx.lookup(o) : o);
const nameOf = (o: PDFObject | undefined): string => (o instanceof PDFName ? o.decodeText() : "");
const numOf = (o: PDFObject | undefined, d = 0): number => (o instanceof PDFNumber ? o.asNumber() : d);
function arrOf(ctx: PDFContext, o: PDFObject | undefined): PDFObject[] {
  const a = look(ctx, o);
  if (!(a instanceof PDFArray)) return [];
  const out: PDFObject[] = [];
  for (let i = 0; i < a.size(); i++) out.push(look(ctx, a.get(i)) as PDFObject);
  return out;
}
const dictOf = (ctx: PDFContext, o: PDFObject | undefined): PDFDict | undefined => { const d = look(ctx, o); return d instanceof PDFDict ? d : undefined; };
function streamBytes(ctx: PDFContext, o: PDFObject | undefined): Uint8Array | null {
  const s = look(ctx, o);
  if (s instanceof PDFRawStream) {
    try { return decodePDFRawStream(s).decode(); } catch { return null; }
  }
  const g = s as unknown as { getUnencodedContents?: () => Uint8Array };
  return typeof g?.getUnencodedContents === "function" ? g.getUnencodedContents() : null;
}
const streamDict = (ctx: PDFContext, o: PDFObject | undefined): PDFDict | undefined => {
  const s = look(ctx, o) as unknown as { dict?: PDFDict };
  return s && s.dict instanceof PDFDict ? s.dict : undefined;
};
const latin1 = (b: Uint8Array): string => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };

// ── fonts ───────────────────────────────────────────────────────────────────────────────────────
type FontName = Parameters<typeof StandardFontEmbedder.for>[0];
const embedder = (f: StandardFonts) => StandardFontEmbedder.for(f as unknown as FontName);
// WinAnsi tables from pdf-lib's own standard-font data: code → glyph name, glyph name → unicode.
let winCache: { codeName: Map<number, string>; nameUni: Map<string, string> } | null = null;
function winAnsi() {
  if (winCache) return winCache;
  const enc = embedder(StandardFonts.Helvetica).encoding as unknown as { unicodeMappings: Record<string, [number, string]> };
  const codeName = new Map<number, string>();
  const nameUni = new Map<string, string>();
  for (const [uni, [code, name]] of Object.entries(enc.unicodeMappings)) {
    codeName.set(code, name);
    nameUni.set(name, String.fromCodePoint(Number(uni)));
  }
  winCache = { codeName, nameUni };
  return winCache;
}
function uniOfGlyphName(name: string): string {
  const w = winAnsi().nameUni.get(name);
  if (w) return w;
  const m = /^uni([0-9A-Fa-f]{4,})$/.exec(name) || /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) { try { return String.fromCodePoint(parseInt(m[1].slice(0, 6), 16)); } catch { return ""; } }
  return "";
}
const STD: Record<string, StandardFonts> = {
  helvetica: StandardFonts.Helvetica, "helvetica-bold": StandardFonts.HelveticaBold, arial: StandardFonts.Helvetica, arialmt: StandardFonts.Helvetica,
  "arial-bold": StandardFonts.HelveticaBold, "arial-boldmt": StandardFonts.HelveticaBold, "arial,bold": StandardFonts.HelveticaBold,
  "times-roman": StandardFonts.TimesRoman, "times-bold": StandardFonts.TimesRomanBold, timesnewroman: StandardFonts.TimesRoman, timesnewromanpsmt: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier, "courier-bold": StandardFonts.CourierBold, couriernew: StandardFonts.Courier,
};
function standardWidths(baseFont: string): ((glyph: string) => number) | null {
  const key = baseFont.replace(/^[A-Z]{6}\+/, "").toLowerCase();
  const std = STD[key] ?? (key.startsWith("helvetica") || key.startsWith("arial") ? (key.includes("bold") ? StandardFonts.HelveticaBold : StandardFonts.Helvetica) : undefined);
  if (!std) return null;
  const f = embedder(std).font as unknown as { getWidthOfGlyph: (g: string) => number | undefined };
  return (g) => (f.getWidthOfGlyph(g) ?? 556) / 1000;
}

function makeFont(ctx: PDFContext, dict: PDFDict): FontInfo {
  const subtype = nameOf(look(ctx, dict.get(N("Subtype"))));
  const toUni = streamBytes(ctx, dict.get(N("ToUnicode")));
  const tu = toUni ? parseCMap(latin1(toUni)) : null;
  const descOf = (fd: PDFDict | undefined, fallbackAsc = 0.8, fallbackDesc = -0.2) => ({
    asc: fd ? numOf(look(ctx, fd.get(N("Ascent"))), fallbackAsc * 1000) / 1000 : fallbackAsc,
    desc: fd ? numOf(look(ctx, fd.get(N("Descent"))), fallbackDesc * 1000) / 1000 : fallbackDesc,
  });

  if (subtype === "Type0") {
    const encObj = look(ctx, dict.get(N("Encoding")));
    const encRanges = encObj instanceof PDFName ? [] : (() => { const b = streamBytes(ctx, encObj); return b ? parseCMap(latin1(b)).ranges : []; })();
    const identity = encObj instanceof PDFName && /^Identity-/.test(encObj.decodeText());
    const ranges = encRanges.length ? encRanges : identity ? [] : tu?.ranges ?? [];
    const desc = dictOf(ctx, arrOf(ctx, dict.get(N("DescendantFonts")))[0]);
    const dw = desc ? numOf(look(ctx, desc.get(N("DW"))), 1000) : 1000;
    const widths = new Map<number, number>();
    if (desc) {
      const w = arrOf(ctx, desc.get(N("W")));
      for (let i = 0; i < w.length;) {
        const first = numOf(w[i]);
        const next = w[i + 1];
        if (next instanceof PDFArray) {
          const list = arrOf(ctx, next);
          list.forEach((v, k) => widths.set(first + k, numOf(v)));
          i += 2;
        } else {
          const last = numOf(next), v = numOf(w[i + 2]);
          for (let c = first; c <= last && c - first < 0x10000; c++) widths.set(c, v);
          i += 3;
        }
      }
    }
    const { asc, desc: d } = descOf(desc ? dictOf(ctx, desc.get(N("FontDescriptor"))) : undefined);
    return {
      codes: (b) => splitCodes(b, ranges, 2),
      width: (c) => (widths.get(c) ?? dw) / 1000,
      uni: (c) => tu?.map.get(c) ?? "",
      asc, desc: d, oneByte: false,
    };
  }

  // simple fonts: Type1, TrueType, MMType1, Type3
  const first = numOf(look(ctx, dict.get(N("FirstChar"))), 0);
  const widthsArr = arrOf(ctx, dict.get(N("Widths"))).map((o) => numOf(o, NaN));
  const fd = dictOf(ctx, dict.get(N("FontDescriptor")));
  const missing = fd ? numOf(look(ctx, fd.get(N("MissingWidth"))), 0) : 0;
  const baseFont = nameOf(look(ctx, dict.get(N("BaseFont"))));
  const encObj = look(ctx, dict.get(N("Encoding")));
  const diff = new Map<number, string>();
  if (encObj instanceof PDFDict) {
    let code = 0;
    for (const o of arrOf(ctx, encObj.get(N("Differences")))) {
      if (o instanceof PDFNumber) code = o.asNumber();
      else if (o instanceof PDFName) diff.set(code++, o.decodeText());
    }
  }
  const glyphOf = (c: number): string => diff.get(c) ?? winAnsi().codeName.get(c) ?? "";
  const std = widthsArr.length ? null : standardWidths(baseFont);
  let scale = 1 / 1000;
  let asc = 0.8, d = -0.2;
  if (subtype === "Type3") {
    const fm = arrOf(ctx, dict.get(N("FontMatrix"))).map((o) => numOf(o));
    scale = fm.length === 6 ? fm[0] : 0.001;
    const bb = arrOf(ctx, dict.get(N("FontBBox"))).map((o) => numOf(o));
    const vs = fm.length === 6 ? fm[3] : 0.001;
    if (bb.length === 4) { asc = bb[3] * vs; d = bb[1] * vs; }
  } else ({ asc, desc: d } = descOf(fd));
  return {
    codes: (b) => Array.from(b),
    width: (c) => {
      const w = widthsArr[c - first];
      if (Number.isFinite(w)) return w * scale;
      if (std) { const g = glyphOf(c); if (g) return std(g); }
      return (missing || 500) * scale;
    },
    uni: (c) => {
      const t = tu?.map.get(c);
      if (t !== undefined) return t;
      const g = diff.get(c);
      if (g) return uniOfGlyphName(g);
      const w = winAnsi().codeName.get(c);
      return w ? uniOfGlyphName(w) : c >= 32 && c < 127 ? String.fromCharCode(c) : "";
    },
    asc, desc: d, oneByte: true,
  };
}

function makeResources(ctx: PDFContext, res: PDFDict | undefined, fonts: Map<PDFObject, FontInfo>): Resources {
  const fontDict = res ? dictOf(ctx, res.get(N("Font"))) : undefined;
  const xoDict = res ? dictOf(ctx, res.get(N("XObject"))) : undefined;
  return {
    font(name) {
      const raw = fontDict?.get(N(name));
      const d = dictOf(ctx, raw);
      if (!d) return null;
      const key = raw ?? d;
      let f = fonts.get(key);
      if (!f) { try { f = makeFont(ctx, d); } catch { return null; } fonts.set(key, f); }
      return f;
    },
    xobject(name): XObj | null {
      const raw = xoDict?.get(N(name));
      const sd = streamDict(ctx, raw);
      if (!sd) return null;
      const st = nameOf(look(ctx, sd.get(N("Subtype"))));
      if (st === "Image") return { kind: "image" };
      if (st !== "Form") return null;
      const bytes = streamBytes(ctx, raw);
      if (!bytes) return { kind: "image" }; // can't read it → treat its whole box as taken
      const mm = arrOf(ctx, sd.get(N("Matrix"))).map((o) => numOf(o));
      const matrix: M = mm.length === 6 ? (mm as M) : IDENTITY;
      const own = dictOf(ctx, sd.get(N("Resources")));
      return { kind: "form", bytes, matrix, res: own ? makeResources(ctx, own, fonts) : makeResources(ctx, res, fonts) };
    },
  };
}

function pageContent(ctx: PDFContext, page: PDFPage): Uint8Array | null {
  const c = page.node.get(N("Contents"));
  const list = look(ctx, c) instanceof PDFArray ? arrOf(ctx, c) : [look(ctx, c)];
  const parts: Uint8Array[] = [];
  for (const s of list) {
    if (!s) continue;
    const b = streamBytes(ctx, s);
    if (!b) return null;
    parts.push(b, Uint8Array.of(0x0a));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function boxOfPage(page: PDFPage): Box {
  const b = page.getCropBox();
  return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
}

async function loadDoc(bytes: Uint8Array): Promise<PDFDocument | "not_pdf" | "locked"> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return /encrypt/i.test(e instanceof Error ? e.message : String(e)) ? "locked" : "not_pdf";
  }
}

// ── 1. read every page ──────────────────────────────────────────────────────────────────────────
export async function scanWaybills(bytes: Uint8Array): Promise<ScanResult> {
  const doc = await loadDoc(bytes);
  if (doc === "not_pdf" || doc === "locked") return { ok: false, error: doc };
  const pages = doc.getPages();
  if (!pages.length) return { ok: false, error: "no_pages" };
  const ctx = doc.context;
  const fonts = new Map<PDFObject, FontInfo>();
  const out: PageInfo[] = pages.map((page, index) => {
    const box = boxOfPage(page);
    try {
      const content = pageContent(ctx, page);
      if (!content) return { index, box, orderId: null, words: [], slot: { ok: false, reason: "unreadable" } };
      const res = makeResources(ctx, dictOf(ctx, page.node.Resources()), fonts);
      const read = readPage(content, res);
      if (read.tooBig) return { index, box, orderId: null, words: [], slot: { ok: false, reason: "unreadable" } };
      const { orderId, words } = pageIds(textLines(read.texts));
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      const slot: PageInfo["slot"] = rot !== 0 ? { ok: false, reason: "rotated" } : findSlot(read, box);
      return { index, box, orderId, words: Array.from(words), slot };
    } catch {
      return { index, box, orderId: null, words: [], slot: { ok: false, reason: "unreadable" } };
    }
  });
  return { ok: true, pages: out };
}

// Every page as the reader sees it (texts, lines, pictures) — the checks read a stamped file back with it.
export async function readWaybillPages(bytes: Uint8Array): Promise<{ read: PageRead; box: Box }[] | null> {
  const doc = await loadDoc(bytes);
  if (doc === "not_pdf" || doc === "locked") return null;
  const ctx = doc.context;
  const fonts = new Map<PDFObject, FontInfo>();
  return doc.getPages().map((page) => {
    const content = pageContent(ctx, page);
    const res = makeResources(ctx, dictOf(ctx, page.node.Resources()), fonts);
    return { read: content ? readPage(content, res) : { texts: [], marks: [] }, box: boxOfPage(page) };
  });
}

// The place of "@handle" on a page (null = it does not fit / no space / not a TikTok username).
let widthFont: ReturnType<typeof StandardFontEmbedder.for> | null = null;
export function stampText(handle: string): string { return `@${handle}`; }
// The printed width at size 1: the sum of the letters' widths. NOT pdf-lib's widthOfTextAtSize — that one
// takes kerning off, but a PDF text command prints without kerning, so it would be too short.
export function stampWidthAt1(text: string): number {
  widthFont ??= embedder(StandardFonts.HelveticaBold);
  const f = widthFont.font as unknown as { getWidthOfGlyph: (g: string) => number | undefined };
  const enc = widthFont.encoding as unknown as { encodeUnicodeCodePoint: (cp: number) => { name: string } };
  let w = 0;
  for (const ch of text) w += (f.getWidthOfGlyph(enc.encodeUnicodeCodePoint(ch.codePointAt(0)!).name) ?? 1000) / 1000;
  return w;
}
export function placeOn(info: PageInfo, handle: string): StampPlace | null {
  if (!info.slot.ok || !stampable(handle)) return null;
  return fitStamp(info.slot.slot, stampWidthAt1(stampText(handle)));
}

// ── 2. write the usernames ──────────────────────────────────────────────────────────────────────
// stamps: page index → username (without "@"). Pages not in the map, or where the username can't be
// placed, are left exactly as they were.
export async function stampWaybills(bytes: Uint8Array, pages: PageInfo[], stamps: Map<number, string>): Promise<{ bytes: Uint8Array; placed: number[] }> {
  const doc = await loadDoc(bytes);
  if (doc === "not_pdf" || doc === "locked") throw new Error("pdf");
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const list = doc.getPages();
  const placed: number[] = [];
  for (const [index, handle] of stamps) {
    const info = pages[index];
    const page = list[index];
    if (!info || !page) continue;
    const at = placeOn(info, handle);
    if (!at) continue;
    page.drawText(stampText(handle), { x: at.x, y: at.y, size: at.size, font, color: rgb(0, 0, 0) });
    placed.push(index);
  }
  const out = await doc.save();
  return { bytes: out, placed: placed.sort((a, b) => a - b) };
}
