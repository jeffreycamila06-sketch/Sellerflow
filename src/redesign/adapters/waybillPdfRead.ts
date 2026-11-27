// WAYBILL USERNAME — read where things are on a waybill page (text, box lines, barcodes, pictures).
// PURE: works on already-decoded page drawing commands; the pdf-lib side (fonts, streams) is in
// waybillPdf.ts. Everything stays in the browser.
//
// The reader follows the PDF drawing commands the way a printer would: the current position
// matrix (cm, q/Q), text state (BT/ET, Tf, Tm, Td, TD, T*, Tc, Tw, Tz, TL, Ts, Tr), text (Tj, TJ, ', "),
// colours (g/rg/k/sc/scn — only to tell light from dark), paths (m l c v y h re + the paint
// operators) and pictures (Do, inline BI…ID…EI). For each text piece it keeps the unicode text and
// its box; for each painted path / picture its box. That is all the stamp needs to never cover
// anything.

export type M = [number, number, number, number, number, number];
export const IDENTITY: M = [1, 0, 0, 1, 0, 0];
export const mul = (m1: M, m2: M): M => [
  m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
export const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface TextRun extends Box {
  str: string;        // unicode text of this piece
  h: number;          // font height in page units (the size as it prints)
  bx: number; by: number; // where the baseline starts (page units)
  horizontal: boolean;
  light: boolean;     // light grey / white fill (a watermark can be light)
  hidden: boolean;    // text render mode 3 (does not print)
}
export interface Mark extends Box { kind: "path" | "image"; light: boolean }
export interface PageRead { texts: TextRun[]; marks: Mark[]; tooBig?: boolean }

// One font as the reader needs it.
export interface FontInfo {
  codes(bytes: Uint8Array): number[];   // the character codes in a shown string
  width(code: number): number;          // advance, as a fraction of the font size
  uni(code: number): string;            // unicode text of the code ("" = unknown)
  asc: number; desc: number;            // ascent / descent as a fraction of the font size (desc ≤ 0)
  oneByte: boolean;                     // word spacing (Tw) applies to code 32 of a one-byte font only
}
export type XObj =
  | { kind: "image" }
  | { kind: "form"; bytes: Uint8Array; matrix: M; res: Resources };
export interface Resources {
  font(name: string): FontInfo | null;
  xobject(name: string): XObj | null;
}

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────
type Tok =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "str"; v: Uint8Array }
  | { t: "arr"; v: Tok[] }
  | { t: "dict" }
  | { t: "op"; v: string };

const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
const hexVal = (c: number) => (c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1);

export class Lexer {
  i = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  private skipWs() {
    const b = this.b;
    for (;;) {
      while (this.i < b.length && isWs(b[this.i])) this.i++;
      if (this.i < b.length && b[this.i] === 0x25) { // % comment
        while (this.i < b.length && b[this.i] !== 0x0a && b[this.i] !== 0x0d) this.i++;
        continue;
      }
      return;
    }
  }
  next(): Tok | null {
    this.skipWs();
    const b = this.b;
    if (this.i >= b.length) return null;
    const c = b[this.i];
    if (c === 0x28) return { t: "str", v: this.literal() };
    if (c === 0x3c) {
      if (b[this.i + 1] === 0x3c) { this.i += 2; this.skipDict(); return { t: "dict" }; }
      return { t: "str", v: this.hex() };
    }
    if (c === 0x5b) {
      this.i++;
      const items: Tok[] = [];
      for (;;) {
        this.skipWs();
        if (this.i >= b.length) break;
        if (b[this.i] === 0x5d) { this.i++; break; }
        const t = this.next();
        if (!t) break;
        items.push(t);
      }
      return { t: "arr", v: items };
    }
    if (c === 0x5d || c === 0x29 || c === 0x3e || c === 0x7b || c === 0x7d) { this.i++; return this.next(); }
    if (c === 0x2f) {
      this.i++;
      const s = this.i;
      while (this.i < b.length && !isWs(b[this.i]) && !isDelim(b[this.i])) this.i++;
      return { t: "name", v: decodeName(b.subarray(s, this.i)) };
    }
    const s = this.i;
    while (this.i < b.length && !isWs(b[this.i]) && !isDelim(b[this.i])) this.i++;
    if (this.i === s) { this.i++; return this.next(); }
    const word = String.fromCharCode(...b.subarray(s, this.i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: Number(word) };
    return { t: "op", v: word };
  }
  // "<< … >>" (inline image dicts, marked-content properties) — skipped, nested.
  private skipDict() {
    const b = this.b;
    let depth = 1;
    while (this.i < b.length && depth > 0) {
      const c = b[this.i];
      if (c === 0x28) { this.literal(); continue; }
      if (c === 0x3c && b[this.i + 1] === 0x3c) { depth++; this.i += 2; continue; }
      if (c === 0x3e && b[this.i + 1] === 0x3e) { depth--; this.i += 2; continue; }
      this.i++;
    }
  }
  private literal(): Uint8Array {
    const b = this.b;
    const out: number[] = [];
    this.i++; // (
    let depth = 1;
    while (this.i < b.length) {
      const c = b[this.i++];
      if (c === 0x5c) {
        const n = b[this.i++];
        if (n === undefined) break;
        if (n === 0x6e) out.push(0x0a); else if (n === 0x72) out.push(0x0d); else if (n === 0x74) out.push(0x09);
        else if (n === 0x62) out.push(0x08); else if (n === 0x66) out.push(0x0c);
        else if (n === 0x0d) { if (b[this.i] === 0x0a) this.i++; }
        else if (n === 0x0a) { /* line continuation */ }
        else if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30;
          for (let k = 0; k < 2 && b[this.i] >= 0x30 && b[this.i] <= 0x37; k++) v = v * 8 + (b[this.i++] - 0x30);
          out.push(v & 0xff);
        } else out.push(n);
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29) { depth--; if (depth === 0) break; }
      out.push(c);
    }
    return Uint8Array.from(out);
  }
  private hex(): Uint8Array {
    const b = this.b;
    this.i++; // <
    const out: number[] = [];
    let hi = -1;
    while (this.i < b.length && b[this.i] !== 0x3e) {
      const v = hexVal(b[this.i++]);
      if (v < 0) continue;
      if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    this.i++; // >
    return Uint8Array.from(out);
  }
  // After the "ID" keyword of an inline image: skip the data up to "EI" (between white space).
  skipInlineImage() {
    const b = this.b;
    this.i++; // the one white-space byte after ID
    for (; this.i < b.length - 1; this.i++) {
      if (b[this.i] === 0x45 && b[this.i + 1] === 0x49 && (this.i === 0 || isWs(b[this.i - 1])) && (this.i + 2 >= b.length || isWs(b[this.i + 2]) || isDelim(b[this.i + 2]))) {
        this.i += 2;
        return;
      }
    }
    this.i = b.length;
  }
}

function decodeName(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x23 && i + 2 < bytes.length && hexVal(bytes[i + 1]) >= 0 && hexVal(bytes[i + 2]) >= 0) {
      s += String.fromCharCode(hexVal(bytes[i + 1]) * 16 + hexVal(bytes[i + 2]));
      i += 2;
    } else s += String.fromCharCode(bytes[i]);
  }
  return s;
}

// ── the interpreter ──────────────────────────────────────────────────────────────────────────────
interface Gs {
  ctm: M;
  fillLum: number; strokeLum: number; fillComps: number; strokeComps: number;
  lw: number;
  font: FontInfo | null; size: number;
  tc: number; tw: number; th: number; tl: number; ts: number; tr: number;
}
const LIGHT = 0.7;
const MAX_OPS = 400_000;
const MAX_DEPTH = 8;

const lumOf = (nums: number[]): number => {
  if (nums.length === 1) return clamp01(nums[0]);
  if (nums.length === 3) return clamp01(0.299 * nums[0] + 0.587 * nums[1] + 0.114 * nums[2]);
  if (nums.length === 4) { const [c, m, y, k] = nums.map(clamp01); return clamp01((1 - k) * (1 - (0.3 * c + 0.59 * m + 0.11 * y))); }
  return 0;
};
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function boxOf(m: M, pts: [number, number][]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    const [u, v] = apply(m, x, y);
    if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
  }
  return { x0, y0, x1, y1 };
}

function ptsBox(pts: [number, number][], pad: number): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export function readPage(bytes: Uint8Array, res: Resources, baseCtm: M = IDENTITY): PageRead {
  const out: PageRead = { texts: [], marks: [] };
  const ops = { n: 0 };
  run(bytes, res, {
    ctm: baseCtm, fillLum: 0, strokeLum: 0, fillComps: 1, strokeComps: 1, lw: 1,
    font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, ts: 0, tr: 0,
  }, out, ops, 0);
  return out;
}

function run(bytes: Uint8Array, res: Resources, start: Gs, out: PageRead, ops: { n: number }, depth: number) {
  const lex = new Lexer(bytes);
  const stack: Gs[] = [];
  let gs: Gs = { ...start };
  let tm: M = IDENTITY, tlm: M = IDENTITY;
  let args: Tok[] = [];
  // the path being built (page units): sub-paths of points; "closed" adds the closing edge
  let subs: { pts: [number, number][]; closed: boolean }[] = [];
  const startSub = (p: [number, number]) => { subs.push({ pts: [p], closed: false }); };
  const addPt = (p: [number, number]) => { if (!subs.length) startSub(p); else subs[subs.length - 1].pts.push(p); };
  const num = (k: number): number => { const t = args[args.length - 1 - k]; return t && t.t === "num" ? t.v : 0; };
  const nums = (): number[] => args.filter((a): a is { t: "num"; v: number } => a.t === "num").map((a) => a.v);
  const ptUser = (x: number, y: number): [number, number] => apply(gs.ctm, x, y);

  const show = (b: Uint8Array) => {
    const f = gs.font;
    if (!f) return;
    const codes = f.codes(b);
    let str = "";
    let adv = 0;
    for (const code of codes) {
      str += f.uni(code);
      const w0 = f.width(code);
      adv += (w0 * gs.size + gs.tc + (f.oneByte && code === 32 ? gs.tw : 0)) * gs.th;
    }
    emitText(str, adv);
  };
  const emitText = (str: string, adv: number) => {
    const f = gs.font;
    if (!f) return;
    const m = mul(tm, gs.ctm);
    // the letters as they print: a font's own ascent / descent is made for line spacing and is often
    // taller than the ink — kept within 0.9 / -0.25 of the size so a neighbour line never looks closer
    const asc = Math.min(0.9, Math.max(0.6, f.asc || 0.8)), desc = Math.max(-0.25, Math.min(0, f.desc || -0.2));
    const lo = gs.ts + desc * gs.size, hi = gs.ts + asc * gs.size;
    const box = boxOf(m, [[0, lo], [adv, lo], [0, hi], [adv, hi]]);
    const [bx, by] = apply(m, 0, gs.ts);
    const [ex, ey] = apply(m, 1, gs.ts);
    const [ux, uy] = apply(m, 0, gs.ts + 1);
    const dx = ex - bx, dy = ey - by;
    const vscale = Math.hypot(ux - bx, uy - by);
    if (str.length || adv) {
      out.texts.push({
        ...box, str, h: gs.size * vscale, bx, by,
        horizontal: dx > 0 && Math.abs(dy) <= Math.abs(dx) * 0.1,
        light: (gs.tr === 1 || gs.tr === 5) ? gs.strokeLum >= LIGHT : gs.fillLum >= LIGHT,
        hidden: gs.tr === 3 || gs.tr === 7,
      });
    }
    tm = mul([1, 0, 0, 1, adv, 0], tm);
  };
  // Fill → one box per sub-path (a filled bar, a filled box). Stroke → one thin box per EDGE, so
  // an outlined box never blocks the empty space inside it.
  const paint = (fill: boolean, stroke: boolean, close = false) => {
    const half = Math.max(0.25, (gs.lw * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2]))) / 2);
    for (const sp of subs) {
      if (fill && sp.pts.length) {
        out.marks.push({ ...ptsBox(sp.pts, 0), kind: "path", light: gs.fillLum >= LIGHT });
      }
      if (stroke) {
        const pts = sp.pts;
        const edges: [[number, number], [number, number]][] = [];
        for (let k = 1; k < pts.length; k++) edges.push([pts[k - 1], pts[k]]);
        if ((sp.closed || close) && pts.length > 2) edges.push([pts[pts.length - 1], pts[0]]);
        if (pts.length === 1) edges.push([pts[0], pts[0]]);
        for (const e of edges) out.marks.push({ ...ptsBox(e, half), kind: "path", light: gs.strokeLum >= LIGHT });
      }
    }
    subs = [];
  };

  for (;;) {
    const tok = lex.next();
    if (!tok) break;
    if (tok.t !== "op") { args.push(tok); continue; }
    if (++ops.n > MAX_OPS) { out.tooBig = true; return; }
    const op = tok.v;
    switch (op) {
      case "q": stack.push({ ...gs }); break;
      case "Q": if (stack.length) gs = stack.pop()!; break;
      case "cm": gs.ctm = mul([num(5), num(4), num(3), num(2), num(1), num(0)], gs.ctm); break;
      case "w": gs.lw = num(0); break;
      // colours: only light vs dark matters
      case "g": gs.fillLum = lumOf([num(0)]); gs.fillComps = 1; break;
      case "G": gs.strokeLum = lumOf([num(0)]); gs.strokeComps = 1; break;
      case "rg": gs.fillLum = lumOf([num(2), num(1), num(0)]); gs.fillComps = 3; break;
      case "RG": gs.strokeLum = lumOf([num(2), num(1), num(0)]); gs.strokeComps = 3; break;
      case "k": gs.fillLum = lumOf([num(3), num(2), num(1), num(0)]); gs.fillComps = 4; break;
      case "K": gs.strokeLum = lumOf([num(3), num(2), num(1), num(0)]); gs.strokeComps = 4; break;
      case "cs": gs.fillLum = 0; break;
      case "CS": gs.strokeLum = 0; break;
      case "sc": case "scn": { const n = nums(); gs.fillLum = args.some((a) => a.t === "name") ? 0 : lumOf(n); break; }
      case "SC": case "SCN": { const n = nums(); gs.strokeLum = args.some((a) => a.t === "name") ? 0 : lumOf(n); break; }
      // paths
      case "m": startSub(ptUser(num(1), num(0))); break;
      case "l": addPt(ptUser(num(1), num(0))); break;
      case "c": addPt(ptUser(num(5), num(4))); addPt(ptUser(num(3), num(2))); addPt(ptUser(num(1), num(0))); break;
      case "v": case "y": addPt(ptUser(num(3), num(2))); addPt(ptUser(num(1), num(0))); break;
      case "h": if (subs.length) subs[subs.length - 1].closed = true; break;
      case "re": {
        const x = num(3), y = num(2), w = num(1), h = num(0);
        subs.push({ pts: [ptUser(x, y), ptUser(x + w, y), ptUser(x + w, y + h), ptUser(x, y + h)], closed: true });
        break;
      }
      case "S": paint(false, true); break;
      case "s": paint(false, true, true); break;
      case "f": case "F": case "f*": paint(true, false); break;
      case "B": case "B*": paint(true, true); break;
      case "b": case "b*": paint(true, true, true); break;
      case "n": subs = []; break;
      case "W": case "W*": break;
      // text
      case "BT": tm = IDENTITY; tlm = IDENTITY; break;
      case "ET": break;
      case "Tf": {
        const name = args.find((a) => a.t === "name");
        gs.font = name && name.t === "name" ? res.font(name.v) : null;
        gs.size = num(0);
        break;
      }
      case "Tc": gs.tc = num(0); break;
      case "Tw": gs.tw = num(0); break;
      case "Tz": gs.th = num(0) / 100; break;
      case "TL": gs.tl = num(0); break;
      case "Ts": gs.ts = num(0); break;
      case "Tr": gs.tr = num(0); break;
      case "Td": tlm = mul([1, 0, 0, 1, num(1), num(0)], tlm); tm = tlm; break;
      case "TD": gs.tl = -num(0); tlm = mul([1, 0, 0, 1, num(1), num(0)], tlm); tm = tlm; break;
      case "Tm": tlm = [num(5), num(4), num(3), num(2), num(1), num(0)]; tm = tlm; break;
      case "T*": tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
      case "Tj": { const s = args[args.length - 1]; if (s && s.t === "str") show(s.v); break; }
      case "'": { tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; const s = args[args.length - 1]; if (s && s.t === "str") show(s.v); break; }
      case "\"": {
        gs.tw = num(2); gs.tc = num(1);
        tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm;
        const s = args[args.length - 1]; if (s && s.t === "str") show(s.v);
        break;
      }
      case "TJ": {
        const arr = args[args.length - 1];
        if (arr && arr.t === "arr") {
          for (const it of arr.v) {
            if (it.t === "str") show(it.v);
            else if (it.t === "num") tm = mul([1, 0, 0, 1, -(it.v / 1000) * gs.size * gs.th, 0], tm);
          }
        }
        break;
      }
      // pictures and forms
      case "Do": {
        const name = args.find((a) => a.t === "name");
        const xo = name && name.t === "name" ? res.xobject(name.v) : null;
        if (xo?.kind === "image") out.marks.push({ ...boxOf(gs.ctm, [[0, 0], [1, 0], [0, 1], [1, 1]]), kind: "image", light: false });
        else if (xo?.kind === "form" && depth < MAX_DEPTH) {
          run(xo.bytes, xo.res, { ...gs, ctm: mul(xo.matrix, gs.ctm) }, out, ops, depth + 1);
          if (out.tooBig) return;
        }
        break;
      }
      case "BI": {
        // the inline image dictionary runs up to "ID" — read and drop its tokens
        for (;;) { const t = lex.next(); if (!t || (t.t === "op" && t.v === "ID")) break; }
        lex.skipInlineImage();
        out.marks.push({ ...boxOf(gs.ctm, [[0, 0], [1, 0], [0, 1], [1, 1]]), kind: "image", light: false });
        break;
      }
      default: break; // d0 d1 sh gs ri i j J M d BMC BDC EMC MP DP BX EX … — nothing to place
    }
    args = [];
  }
}

// ── lines of text ────────────────────────────────────────────────────────────────────────────────
export interface Line { items: TextRun[]; text: string; at: number[] } // at[k] = index in items of text[k]

// Horizontal pieces grouped by baseline, left to right. A gap wider than a quarter of the font
// height becomes one space.
export function textLines(texts: TextRun[]): Line[] {
  const hs = texts.filter((t) => t.horizontal && !t.hidden && t.str.trim() !== "").slice().sort((a, b) => b.by - a.by || a.bx - b.bx);
  const groups: TextRun[][] = [];
  for (const t of hs) {
    const g = groups.find((gr) => Math.abs(gr[0].by - t.by) <= 0.35 * Math.min(gr[0].h, t.h));
    if (g) g.push(t); else groups.push([t]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x0 - b.x0);
    let text = "";
    const at: number[] = [];
    g.forEach((it, k) => {
      if (k > 0 && it.x0 - g[k - 1].x1 > 0.25 * Math.min(it.h, g[k - 1].h)) { text += " "; at.push(k); }
      for (const ch of it.str) { text += ch; at.push(k); }
    });
    return { items: g, text, at };
  }).sort((a, b) => b.items[0].by - a.items[0].by);
}

// The order id after "TT Order ID", and every word on the page (a tracking number fallback).
export function pageIds(lines: Line[]): { orderId: string | null; words: Set<string> } {
  let orderId: string | null = null;
  const words = new Set<string>();
  for (const l of lines) {
    for (const w of l.text.toUpperCase().split(/[^A-Z0-9-]+/)) if (w.length >= 8) words.add(w);
    if (!orderId) {
      const m = /order\s*id\s*[:：]?\s*([0-9][0-9 ]{9,30}[0-9])/i.exec(l.text);
      if (m) orderId = m[1].replace(/\s+/g, "");
    }
  }
  return { orderId, words };
}

// ── the free space for "@username" ───────────────────────────────────────────────────────────────
export interface Slot extends Box { labelH: number }
export type SlotResult = { ok: true; slot: Slot } | { ok: false; reason: "no_labels" | "no_space" };

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// The label piece and the value right after it on the same line ("Weight:  0.500 KG").
function labelRun(lines: Line[], re: RegExp): { line: Line; run: TextRun[] } | null {
  for (const line of lines) {
    const m = re.exec(line.text);
    if (!m) continue;
    const first = line.at[m.index];
    const run: TextRun[] = [line.items[first]];
    for (let k = first + 1; k < line.items.length; k++) {
      const prev = run[run.length - 1], it = line.items[k];
      if (it.x0 - prev.x1 > 3 * Math.max(prev.h, it.h)) break; // a far piece is not this value
      run.push(it);
    }
    // the label must start the line's left part: a "weight" in the middle of other words is not it
    return { line, run };
  }
  return null;
}

// What may sit under the stamp: a big light text (the grey "COD" watermark), any light
// paint (white / light grey backgrounds), text that does not print.
// Real TikTok / J&T waybills (checked on a real label, Nov 27 2026): the grey "COD" is drawn as three
// separate huge letters whose colour the reader sees as dark, and the whole label frame + logos is ONE
// picture under everything. So: text ≥ 4× the label height is a watermark, and a picture covering most
// of the page is the label's own background (never an obstacle — the text and barcodes on top of it are).
export const WATERMARK_TEXT_FACTOR = 4;
export const BACKGROUND_IMAGE_SHARE = 0.8;
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
export function isIgnorable(o: TextRun | Mark, labelH: number, page?: Box): boolean {
  if ("str" in o) {
    if (o.hidden) return true;
    if (o.h >= WATERMARK_TEXT_FACTOR * labelH) return true;
    const big = o.h >= 2 * labelH;
    return big && (o.light || /^\s*cod\s*$/i.test(o.str));
  }
  if (o.kind === "image" && page && area(page) > 0 && area(o) >= BACKGROUND_IMAGE_SHARE * area(page)) return true;
  return o.light;
}

export const RIGHT_GAP_MIN = 9;
export function findSlot(read: PageRead, page: Box): SlotResult {
  const lines = textLines(read.texts);
  const w = labelRun(lines, /\bweight\b/i);
  const p = labelRun(lines, /\bpayment\b/i);
  if (!w || !p) return { ok: false, reason: "no_labels" };
  const labelH = Math.min(w.run[0].h, p.run[0].h);
  // Payment is the line under Weight (the waybill's bottom block)
  const dy = w.run[0].by - p.run[0].by;
  if (dy <= 0 || dy > 3 * labelH) return { ok: false, reason: "no_labels" };
  const runs = [...w.run, ...p.run];
  // the two lines as they print: from the Weight line's cap height down to the Payment line's descent
  const top = w.run[0].by + 0.8 * w.run[0].h;
  const bottom = p.run[0].by - 0.25 * p.run[0].h;
  const valueEnd = Math.max(...runs.map((r) => r.x1));
  const left = valueEnd + Math.max(0.6 * labelH, 3);
  const band: Box = { x0: left, y0: bottom, x1: page.x1, y1: top };
  const obstacles: Box[] = [
    ...read.texts.filter((t) => !isIgnorable(t, labelH, page) && t.str.trim() !== "" && !runs.includes(t)),
    ...read.marks.filter((m) => !isIgnorable(m, labelH, page)),
  ];
  // the right edge: the nearest thing to the right on these two lines (the barcode column's line)
  let right = page.x1 - 6;
  for (const o of obstacles) {
    if (o.y0 < band.y1 && o.y1 > band.y0 && o.x0 >= left - 0.01 && o.x0 < right) right = o.x0;
  }
  // keep well clear of the barcode column: on a real label its frame line is inside the background
  // picture, a few points left of the bars, so it is not seen as an obstacle
  const slot: Slot = { x0: left, y0: bottom, x1: right - Math.max(0.75 * labelH, RIGHT_GAP_MIN), y1: top, labelH };
  if (slot.x1 - slot.x0 <= 0) return { ok: false, reason: "no_space" };
  // nothing may cross the space (a box line going through it, a piece starting left of it …)
  if (obstacles.some((o) => overlaps(o, slot))) return { ok: false, reason: "no_space" };
  if (slot.x0 < page.x0 || slot.x1 > page.x1 || slot.y0 < page.y0 || slot.y1 > page.y1) return { ok: false, reason: "no_space" };
  return { ok: true, slot };
}

// ── the stamp's size and place ───────────────────────────────────────────────────────────────────
export const STAMP_MIN_SIZE = 6;     // smaller than this is hard to read on a thermal printer → not stamped
export const STAMP_MAX_SIZE = 14;
// The stamp's height above / below its baseline, as a share of the size. 0.8 = what the reader uses for a
// standard font, so a stamp read back is measured exactly like it was placed (room for "@", "g", "_").
export const STAMP_ASC = 0.8;
export const STAMP_DESC = 0.22;
export interface StampPlace { x: number; y: number; size: number; box: Box }

// widthAt1 = the text width at font size 1 (pdf-lib's widthOfTextAtSize(text, 1)).
export function fitStamp(slot: Slot, widthAt1: number): StampPlace | null {
  const bandH = slot.y1 - slot.y0;
  const byHeight = bandH / (STAMP_ASC + STAMP_DESC);
  const byWidth = widthAt1 > 0 ? (slot.x1 - slot.x0) / widthAt1 : 0;
  const size = Math.min(STAMP_MAX_SIZE, 2 * slot.labelH, byHeight, byWidth);
  if (!(size >= STAMP_MIN_SIZE)) return null;
  const w = widthAt1 * size;
  const x = slot.x1 - w; // right side of the space, like the approved picture
  const boxH = (STAMP_ASC + STAMP_DESC) * size;
  const y = slot.y0 + (bandH - boxH) / 2 + STAMP_DESC * size;
  return { x, y, size, box: { x0: x, y0: y - STAMP_DESC * size, x1: x + w, y1: y + STAMP_ASC * size } };
}

// Only letters, digits, "." and "_" (TikTok usernames) — the stamp font is a plain Latin font.
export const stampable = (handle: string): boolean => /^[A-Za-z0-9._-]{1,40}$/.test(handle);

// ── CMaps (ToUnicode, and the code lengths of a composite font) ──────────────────────────────────
export interface CMapData { ranges: { len: number; lo: number; hi: number }[]; map: Map<number, string> }

const utf16 = (hex: string): number[] => {
  const h = hex.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i + 3 < h.length; i += 4) out.push(parseInt(h.slice(i, i + 4), 16));
  if (h.length % 4 === 2) out.push(parseInt(h.slice(-2), 16));
  return out;
};

export function parseCMap(text: string): CMapData {
  const ranges: CMapData["ranges"] = [];
  const map = new Map<number, string>();
  const re = /<([0-9A-Fa-f\s]*)>|\[|\]|\b(begincodespacerange|endcodespacerange|beginbfchar|endbfchar|beginbfrange|endbfrange)\b/g;
  let mode = "";
  let buf: (string | string[])[] = [];
  let arr: string[] | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[2]) { mode = m[2].startsWith("begin") ? m[2].slice(5) : ""; buf = []; arr = null; continue; }
    if (m[0] === "[") { arr = []; continue; }
    if (m[0] === "]") { if (arr) buf.push(arr); arr = null; }
    else if (m[1] !== undefined) { if (arr) { arr.push(m[1]); continue; } buf.push(m[1]); }
    if (mode === "codespacerange" && buf.length === 2) {
      const [a, b] = buf as string[];
      const len = Math.max(1, Math.ceil(a.replace(/\s+/g, "").length / 2));
      ranges.push({ len, lo: parseInt(a.replace(/\s+/g, "") || "0", 16), hi: parseInt(b.replace(/\s+/g, "") || "0", 16) });
      buf = [];
    } else if (mode === "bfchar" && buf.length === 2) {
      const [a, b] = buf as string[];
      map.set(parseInt(a.replace(/\s+/g, "") || "0", 16), String.fromCharCode(...utf16(b)));
      buf = [];
    } else if (mode === "bfrange" && buf.length === 3) {
      const lo = parseInt(String(buf[0]).replace(/\s+/g, "") || "0", 16);
      const hi = parseInt(String(buf[1]).replace(/\s+/g, "") || "0", 16);
      const dst = buf[2];
      if (hi >= lo && hi - lo <= 0xffff) {
        for (let c = lo; c <= hi; c++) {
          if (Array.isArray(dst)) { const d = dst[c - lo]; if (d !== undefined) map.set(c, String.fromCharCode(...utf16(d))); }
          else { const u = utf16(dst); if (u.length) { u[u.length - 1] += c - lo; map.set(c, String.fromCharCode(...u)); } }
        }
      }
      buf = [];
    }
  }
  return { ranges, map };
}

// Split a shown string into codes with the code lengths of the CMap (default: n bytes each).
export function splitCodes(bytes: Uint8Array, ranges: CMapData["ranges"], dflt: number): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    let len = 0;
    for (let n = 1; n <= 4 && i + n <= bytes.length && !len; n++) {
      let v = 0;
      for (let k = 0; k < n; k++) v = v * 256 + bytes[i + k];
      if (ranges.some((r) => r.len === n && v >= r.lo && v <= r.hi)) len = n;
    }
    if (!len) len = Math.min(dflt, bytes.length - i);
    let v = 0;
    for (let k = 0; k < len; k++) v = v * 256 + bytes[i + k];
    out.push(v);
    i += len;
  }
  return out;
}
