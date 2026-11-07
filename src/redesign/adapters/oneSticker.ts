// ONE STICKER — the single sticker engine (Nov 2026, Branch 1 "one sticker, same everywhere").
//
// ONE function draws the sticker for EVERY image path and the screen: AIMO/Phomemo D520BT (SDK
// image), Flash Y41BT / Xprinter XP-420B (TSPL image), ESC/POS + CPCL generic images, Niimbot
// (vendor SDK image), the laptop/web print (the same picture on a W×H mm page) and the exact
// preview in Live print pattern. Same input → the same bits → preview == print by construction.
// The native TEXT stickers (classic mode, old binaries, iOS WiFi sticker) and the ESC/POS slip
// are NOT drawn here (Branch 2).
//
// Layout (left-aligned, from the top):
//   top-right   date & time (always, small, fixed)        QR under it when ON (TikTok only)
//   top-left    shop name (not on 50×30-class labels; blank = no line, never a brand)
//               "Buyer 12"  (small word + big number on one line)
//               name  (Facebook: up to 2 lines)
//               @username  (TikTok; never on Facebook)
//               comment / price — uses every line left: starts at the seller's size, shrinks step
//               by step down to a readable minimum, then cuts the end with "…" (never grows).
// A line next to the date / QR only uses the width left of them, with a clear gap.
// A part that does not fit → a fit warning (the screen shows it in red); the sticker still prints.
import { qrMatrix } from "../../lib/qr";
import { tiktokProfileUrl } from "../../lib/tiktokHandle";
import { cjkCellsFor, cjkInk, fitOneLine, hasIdeograph, lineExtent, lineIsReadable, measure, newInk, paintLine, printableText, readableStyle, wrapText, type Fonts, type InkStyle, type LineRun } from "./oneStickerText";
import { lighterSteps } from "./oneStickerReadable";
import { CJK_CELLS, cjkCellFor, getSansFace, loadSansFace, type CjkCell, type SansWeight } from "./oneStickerFonts";
import type { FullRaster } from "./stickerRaster";

// ── Settings (per device, saved from Live print pattern) ──────────────────────────────────────
export type Weight = "normal" | "bold" | "extra";
export const WEIGHT_PX: Record<Weight, SansWeight> = { normal: 400, bold: 700, extra: 900 };
export interface PartCfg { on: boolean; weight: Weight; scale: number }
export type PartKey = "shop" | "buyer" | "name" | "user" | "comment";
export const PART_KEYS: PartKey[] = ["shop", "buyer", "name", "user", "comment"];
export interface OneStickerSize { w: number; h: number; custom?: boolean }
export interface OneStickerSettings { v: 1; size: OneStickerSize; parts: Record<PartKey, PartCfg>; qr: boolean }
export const SCALE_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2] as const;
export const STANDARD_SIZES: OneStickerSize[] = [
  { w: 50, h: 30 }, { w: 60, h: 40 }, { w: 70, h: 50 }, { w: 80, h: 50 }, { w: 80, h: 60 }, { w: 100, h: 60 },
];
export const CUSTOM_MIN_MM = 30, CUSTOM_MAX_MM = 110;
export function recommendedSettings(size: OneStickerSize = { w: 100, h: 60 }): OneStickerSettings {
  const p = (): PartCfg => ({ on: true, weight: "bold", scale: 1 });
  return { v: 1, size: { ...size }, parts: { shop: p(), buyer: p(), name: p(), user: p(), comment: p() }, qr: true };
}
export function snapScale(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 1;
  let best: number = SCALE_STEPS[0];
  for (const s of SCALE_STEPS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}
export const validCustomMm = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n >= CUSTOM_MIN_MM && n <= CUSTOM_MAX_MM;
/** Read settings from storage-shaped data; anything wrong becomes the recommended value. */
export function normalizeSettings(raw: unknown): OneStickerSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<OneStickerSettings> & { size?: Partial<OneStickerSize>; parts?: Partial<Record<PartKey, Partial<PartCfg>>> };
  const sz: Partial<OneStickerSize> = r.size ?? {};
  const size: OneStickerSize = validCustomMm(sz.w) && validCustomMm(sz.h) ? { w: sz.w as number, h: sz.h as number, ...(sz.custom ? { custom: true } : {}) } : { w: 100, h: 60 };
  const out = recommendedSettings(size);
  for (const k of PART_KEYS) {
    const p = r.parts?.[k];
    if (!p) continue;
    out.parts[k] = { on: p.on !== false, weight: p.weight === "normal" || p.weight === "extra" ? p.weight : "bold", scale: snapScale(p.scale) };
  }
  out.qr = r.qr !== false;
  return out;
}

// ── Label classes and sizes ───────────────────────────────────────────────────────────────────
export const DOTS_PER_MM = 8;
/** 50×30-class (height < 35 mm or width < 55 mm): no shop name, smaller minimum comment size. */
export const isSmallClass = (wMm: number, hMm: number): boolean => hMm < 35 || wMm < 55; // approved Step 0 preview
interface Base { shop: number; word: number; num: number; name: number; user: number; comment: number; date: number; minComment: number; margin: number }
/** Text sizes (px = dots per em) at 1× for this label. */
export function baseSizes(wMm: number, hMm: number): Base {
  const f = Math.max(0.8, Math.min(2.2, Math.min(hMm / 30, wMm / 50)));
  const small = isSmallClass(wMm, hMm);
  const r = (n: number) => Math.max(10, Math.round(n * f));
  return {
    shop: r(24), word: r(20), num: r(56), name: r(30), user: r(24), comment: r(30),
    date: f < 1.25 ? 17 : 20,
    minComment: small ? 17 : 19, // ≈2.1 mm / ≈2.4 mm
    margin: wMm >= 60 && hMm >= 40 ? 12 : 8,
  };
}

// ── Input (one buyer, one sticker) ────────────────────────────────────────────────────────────
export interface OneStickerInput {
  storeName?: string;
  date: string;          // already Taipei "MM/DD" (approved preview: "11/07 14:05", no year)
  time?: string;         // "HH:MM" Taipei
  buyerNum?: number | string;
  name?: string;
  handle?: string;
  platform?: string;
  items: string[];       // the comment / price of each order (one sticker = one order on Live)
  fbNameOnly?: boolean;  // Facebook buyer (fbName.ts): name only (2 lines), no @username, no QR
}
export interface FitWarning { part: PartKey | "qr"; kind: "width" | "height" }
export interface OneStickerCanvas { w: number; h: number; edgeX?: number; edgeY?: number }
export interface RenderOpts {
  canvas?: OneStickerCanvas; // dots (Niimbot: the SDK frame); default = the label W×H × 8
  inkBold?: boolean;         // 1-dot heavier text (lighter heads: Y41BT, XP-420B); never the QR
  guard?: boolean;           // readability guard (default ON): a line whose letters would close prints lighter
                             // (oneStickerReadable.ts). OFF only for the BEFORE pictures of the proof.
}
export const isFacebookLike = (p?: string) => String(p ?? "").trim().toLowerCase() === "facebook";
export const qrAllowedForPlatform = (p?: string) => !["facebook", "instagram", "shopee"].includes(String(p ?? "").trim().toLowerCase());

// ── Fonts ─────────────────────────────────────────────────────────────────────────────────────
export function weightsFor(s: OneStickerSettings): SansWeight[] {
  const set = new Set<SansWeight>([700]); // date / "Buyer" word
  for (const k of PART_KEYS) if (s.parts[k].on) set.add(WEIGHT_PX[s.parts[k].weight]);
  return [...set];
}
const KANA_FULLWIDTH = /[\u3000-\u30ff\u31f0-\u31ff\uff00-\uffef]/;
const allText = (inp: OneStickerInput) => [inp.storeName ?? "", inp.name ?? "", inp.handle ?? "", ...inp.items].join(" ");
/** Load what this sticker needs (outline weights, kana set, CJK cells). Never throws. */
export async function loadFontsFor(s: OneStickerSettings, inp: OneStickerInput, cjkLoader: (cell: CjkCell) => Promise<import("./stickerRaster").GlyphAtlas>): Promise<Fonts> {
  const fonts: Fonts = { sans: {}, cjkx: null, cjk: {} };
  for (const w of weightsFor(s)) { try { fonts.sans[w] = await loadSansFace(w); } catch { /* another weight stands in */ } }
  try { fonts.sans[400] ??= await loadSansFace(400); } catch { /* ignore */ }
  const text = printableText(allText(inp));
  if (KANA_FULLWIDTH.test(text)) { try { fonts.cjkx = await loadSansFace("cjkx"); } catch { fonts.cjkx = null; } }
  if (hasIdeograph(text)) {
    const plan = layoutSticker(s, inp, fonts); // advances never depend on the CJK atlases
    for (const cell of cjkCellsFor(plan.sizes)) { try { fonts.cjk![cell] = await cjkLoader(cell); } catch { /* that cell paints from the device font */ } }
  }
  return fonts;
}
export function fontsReadySync(): Fonts {
  return { sans: { 400: getSansFace(400) ?? undefined, 700: getSansFace(700) ?? undefined, 900: getSansFace(900) ?? undefined }, cjkx: getSansFace("cjkx"), cjk: {} };
}
export { CJK_CELLS };

// ── Layout ────────────────────────────────────────────────────────────────────────────────────
interface Laid { run: LineRun; px: number; weight: SansWeight; ink: boolean; x: number; baseline: number; clip: number }
interface QrBox { matrix: boolean[][]; x: number; y: number; mod: number }
export interface Layout { w: number; h: number; lines: Laid[]; qr: QrBox | null; warnings: FitWarning[]; sizes: number[]; commentPx: number | null }

export function layoutSticker(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): Layout {
  const wMm = s.size.w, hMm = s.size.h;
  const W = opts.canvas?.w ?? wMm * DOTS_PER_MM, H = opts.canvas?.h ?? hMm * DOTS_PER_MM;
  const B = baseSizes(wMm, hMm);
  const mx = opts.canvas?.edgeX ?? B.margin, my = opts.canvas?.edgeY ?? B.margin;
  const fb = inp.fbNameOnly === true || isFacebookLike(inp.platform);
  const lines: Laid[] = [];
  const warnings: FitWarning[] = [];
  const sizes: number[] = [];
  const add = (l: Laid) => { lines.push(l); sizes.push(l.px); };
  const P = s.parts;
  const px = (k: PartKey, base: number) => Math.max(10, Math.round(base * P[k].scale));
  const wt = (k: PartKey) => WEIGHT_PX[P[k].weight];
  const gapOf = (p: number) => Math.max(3, Math.round(p * 0.14));
  // READABILITY GUARD: the heaviest style ≤ the seller's choice that keeps every letter open (never resized)
  const inkWanted = opts.inkBold === true;
  // The decision is made on the text, then CONFIRMED on the exact lines that print (where a wrap or a
  // "…" puts the letters): a printed line that would still close → one step lighter, laid out again.
  const settle = <T>(text: string, p: number, w: SansWeight, build: (st: InkStyle) => { runs: LineRun[]; out: T }): { st: InkStyle; out: T } => {
    if (opts.guard === false) { const st = { weight: w, ink: inkWanted }; return { st, out: build(st).out }; }
    const first = readableStyle(text, p, w, inkWanted, fonts);
    const list = lighterSteps(w, inkWanted);
    let i = Math.max(0, list.findIndex((x) => x.weight === first.weight && x.ink === first.ink));
    for (; i < list.length - 1; i++) {
      const b = build(list[i]);
      if (b.runs.every((r) => lineIsReadable(r.text, p, list[i], fonts))) return { st: list[i], out: b.out };
    }
    return { st: list[list.length - 1], out: build(list[list.length - 1]).out };
  };
  const one = (text: string, p: number, w: SansWeight) => settle(text, p, w, (st) => { const run = measure(text, p, st.weight, fonts); return { runs: [run], out: run }; });
  const fitted = (text: string, p: number, w: SansWeight, max: number) => settle(text, p, w, (st) => { const r = fitOneLine(text, p, st.weight, max, fonts); return { runs: [r.line], out: r }; });

  // date & time — top right, fixed
  const dateText = printableText([inp.date, inp.time].filter(Boolean).join(" "));
  const { st: dSt, out: dRun } = one(dateText, B.date, 700);
  const dExt = lineExtent(dRun, B.date, dSt.weight, fonts);
  const dTop = my, dBase = my + Math.max(dExt.asc, Math.round(B.date * 0.74));
  const dX = W - mx - dRun.width;
  add({ run: dRun, px: B.date, weight: dSt.weight, ink: dSt.ink, x: dX, baseline: dBase, clip: W });
  const dBottom = dBase + Math.max(dExt.desc, 2);
  const obstacles: { top: number; bottom: number; left: number }[] = [{ top: dTop - 2, bottom: dBottom + 2, left: dX - 14 }];

  // QR — TikTok only, under the date, right side
  let qr: QrBox | null = null;
  const handle = printableText(inp.handle).replace(/^@+/, "");
  if (s.qr && !fb && qrAllowedForPlatform(inp.platform) && handle) {
    const url = tiktokProfileUrl(handle);
    const m = url ? qrMatrix(url, "M") : null;
    if (m) {
      const n = m.length;
      const top = dBottom + 6;
      const room = H - my - top;
      let mod = 0;
      for (const cand of [6, 5, 4]) if (n * cand <= room && n * cand <= W * 0.45) { mod = cand; break; }
      if (mod) {
        const x = W - Math.max(4, mx - 4) - n * mod;
        qr = { matrix: m, x, y: top + Math.max(0, Math.min(mod * 2, room - n * mod)), mod };
        obstacles.push({ top: qr.y - mod * 2, bottom: qr.y + n * mod + mod * 2, left: x - mod * 4 });
      } else warnings.push({ part: "qr", kind: "height" });
    }
  }
  const rightAt = (top: number, bottom: number) => {
    let r = W - mx;
    for (const o of obstacles) if (bottom > o.top && top < o.bottom) r = Math.min(r, o.left);
    return r;
  };

  // the left column, top-down
  let y = my;
  const bottomLimit = H - my;
  const placeLine = (run: LineRun, p: number, st: InkStyle, part: PartKey, extraGap = true): number => {
    const w = st.weight;
    const ext = lineExtent(run, p, w, fonts);
    const asc = Math.max(ext.asc, Math.round(p * 0.72)), desc = Math.max(ext.desc, Math.round(p * 0.08));
    const baseline = y + asc;
    const clip = rightAt(y, baseline + desc);
    if (mx + run.width > clip) warnings.push({ part, kind: "width" });
    if (baseline + desc > bottomLimit) warnings.push({ part, kind: "height" });
    add({ run, px: p, weight: w, ink: st.ink, x: mx, baseline, clip });
    y = baseline + desc + (extraGap ? gapOf(p) : 0);
    return baseline;
  };
  const widthAtY = (p: number) => Math.max(10, rightAt(y, y + Math.round(p * 1.05)) - mx);

  // 1. shop name
  const shop = printableText(inp.storeName);
  if (P.shop.on && shop && !isSmallClass(wMm, hMm)) {
    const p = px("shop", B.shop);
    const { st, out: { line, cut } } = fitted(shop, p, wt("shop"), widthAtY(p));
    if (cut) warnings.push({ part: "shop", kind: "width" });
    placeLine(line, p, st, "shop");
  }
  // 2. "Buyer 12"
  const num = inp.buyerNum != null && String(inp.buyerNum) !== "" ? String(inp.buyerNum) : "";
  if (P.buyer.on && num) {
    const pn = px("buyer", B.num), pw = Math.max(12, Math.round(pn * 0.36));
    const { st: nSt, out: nRun } = one(num, pn, wt("buyer"));
    const { st: wSt, out: wRun } = one("Buyer", pw, 700);
    const ext = lineExtent(nRun, pn, nSt.weight, fonts);
    const asc = Math.max(ext.asc, Math.round(pn * 0.72));
    const baseline = y + asc;
    const clip = rightAt(y, baseline);
    const gap = Math.max(6, Math.round(pn * 0.14));
    if (mx + wRun.width + gap + nRun.width > clip) warnings.push({ part: "buyer", kind: "width" });
    if (baseline > bottomLimit) warnings.push({ part: "buyer", kind: "height" });
    add({ run: wRun, px: pw, weight: wSt.weight, ink: wSt.ink, x: mx, baseline, clip });
    add({ run: nRun, px: pn, weight: nSt.weight, ink: nSt.ink, x: mx + wRun.width + gap, baseline, clip });
    y = baseline + Math.max(ext.desc, 2) + gapOf(pn);
  }
  // 3. name (Facebook: up to 2 lines)
  const name = printableText(inp.name);
  if (P.name.on && name) {
    const p = px("name", B.name);
    if (fb) {
      const startY = y;
      const lineH = Math.round(p * 1.08);
      const { st, out: wr } = settle(name, p, wt("name"), (st) => { const r = wrapText(name, p, st.weight, (i) => Math.max(10, rightAt(startY + i * lineH, startY + (i + 1) * lineH) - mx), 2, fonts); return { runs: r.lines, out: r }; });
      if (wr.cut) warnings.push({ part: "name", kind: "width" });
      wr.lines.forEach((l, i) => placeLine(l, p, st, "name", i === wr.lines.length - 1));
    } else {
      const { st, out: { line, cut } } = fitted(name, p, wt("name"), widthAtY(p));
      if (cut) warnings.push({ part: "name", kind: "width" });
      placeLine(line, p, st, "name");
    }
  }
  // 4. @username (never on Facebook)
  if (P.user.on && handle && !fb) {
    const p = px("user", B.user);
    const { st, out: { line, cut } } = fitted("@" + handle, p, wt("user"), widthAtY(p));
    if (cut) warnings.push({ part: "user", kind: "width" });
    placeLine(line, p, st, "user");
  }
  // 5. comment / price — every line left; shrink to the minimum, then "…"
  let commentPx: number | null = null;
  const comment = printableText(inp.items.filter(Boolean).join(" · "));
  if (P.comment.on && comment) {
    const startY = y;
    const wChosen = wt("comment");
    let p = px("comment", B.comment);
    const minP = Math.min(p, B.minComment);
    const ideo = hasIdeograph(comment);
    for (;;) {
      // Chinese characters fill their whole cell: stacked lines get at least 2 white dots between them
      const lineH = ideo ? Math.max(Math.round(p * 1.12), (() => { const c = cjkCellFor(p); return c.cell * c.mag + cjkInk(p, wChosen).dy + 2; })()) : Math.round(p * 1.12);
      const maxLines = Math.max(0, Math.floor((bottomLimit - startY + Math.round(p * 0.12)) / lineH));
      const widthOf = (i: number) => Math.max(10, rightAt(startY + i * lineH, startY + (i + 1) * lineH) - mx);
      const wrapAt = (weight: SansWeight) => (maxLines > 0 ? wrapText(comment, p, weight, widthOf, maxLines, fonts) : { lines: [] as LineRun[], cut: true });
      // the SIZE is decided with the seller's own weight (the guard never changes it — only lighter) …
      const fit = wrapAt(wChosen);
      if ((!fit.cut && fit.lines.length) || p <= minP) {
        // … then the readability guard picks the weight on the lines that print at that size
        const { st, out: wr } = settle(comment, p, wChosen, (st) => { const r = st.weight === wChosen ? fit : wrapAt(st.weight); return { runs: r.lines, out: r }; });
        const w = st.weight;
        if (wr.cut) warnings.push({ part: "comment", kind: wr.lines.length ? "width" : "height" });
        y = startY;
        wr.lines.forEach((l, i) => {
          const baseline = startY + i * lineH + Math.round(p * 0.88);
          add({ run: l, px: p, weight: w, ink: st.ink, x: mx, baseline, clip: widthOf(i) + mx });
        });
        commentPx = p;
        break;
      }
      p = Math.max(minP, Math.round(p * 0.92) === p ? p - 1 : Math.round(p * 0.92));
    }
  }
  return { w: W, h: H, lines, qr, warnings: dedupWarnings(warnings), sizes, commentPx };
}
function dedupWarnings(ws: FitWarning[]): FitWarning[] {
  const seen = new Set<string>(); const out: FitWarning[] = [];
  for (const w of ws) { const k = `${w.part}|${w.kind}`; if (!seen.has(k)) { seen.add(k); out.push(w); } }
  return out;
}

// ── Render ────────────────────────────────────────────────────────────────────────────────────
export interface OneStickerRender extends FullRaster { warnings: FitWarning[]; layout: Layout }
export function renderOneSticker(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): OneStickerRender {
  const layout = layoutSticker(s, inp, fonts, opts);
  const ink = newInk(layout.w, layout.h);
  // the 1-dot ink is per line (the guard may drop it on one line only); the QR is stamped after → never inked
  for (const l of layout.lines) paintLine(ink, l.run, l.px, l.weight, fonts, l.x, l.baseline, l.clip, l.ink);
  if (layout.qr) {
    const { matrix: m, x, y, mod } = layout.qr;
    const n = m.length;
    for (let yy = y - mod * 2; yy < y + (n + 2) * mod; yy++) for (let xx = x - mod * 4; xx < x + (n + 1) * mod; xx++) {
      if (xx < 0 || yy < 0 || xx >= ink.w || yy >= ink.h) continue;
      ink.buf[yy * ink.rowBytes + (xx >> 3)] &= ~(0x80 >> (xx & 7)); // quiet zone
    }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) for (let j = 0; j < mod; j++) for (let i = 0; i < mod; i++) {
      const X = x + c * mod + i, Y = y + r * mod + j;
      if (X >= 0 && Y >= 0 && X < ink.w && Y < ink.h) ink.buf[Y * ink.rowBytes + (X >> 3)] |= 0x80 >> (X & 7);
    }
  }
  return { buf: ink.buf, w: ink.w, h: ink.h, rowBytes: ink.rowBytes, warnings: layout.warnings, layout };
}

// ── Printer limits (for the "too wide for your printer" warning) ──────────────────────────────
// Widest label each whitelisted model takes (mm). Sources: maker/retail spec sheets (see
// PRINTING_MAP §5). Y41BT: no maker sheet found — treated as a 4-inch head (unverified).
export interface PrinterLimit { model: string; maxLabelMm: number; printMm: number; verified: boolean }
export const PRINTER_LIMITS: PrinterLimit[] = [
  { model: "D520BT", maxLabelMm: 110, printMm: 108, verified: true },
  { model: "Y41BT", maxLabelMm: 110, printMm: 108, verified: false },
  { model: "XP-420B", maxLabelMm: 116, printMm: 108, verified: true },
  { model: "B1", maxLabelMm: 50, printMm: 48, verified: true },
  { model: "B21", maxLabelMm: 50, printMm: 48, verified: true },
  { model: "B203", maxLabelMm: 50, printMm: 48, verified: false },
  { model: "B3S", maxLabelMm: 75, printMm: 72, verified: true },
];
/** The limit row for a saved printer name (scan name, e.g. "B1-H123", "Y41BT-0FC4_LE"), or null. */
export function printerLimitFor(name: string | null | undefined): PrinterLimit | null {
  const n = String(name ?? "").trim().toUpperCase();
  if (!n) return null;
  for (const l of PRINTER_LIMITS) if (n.startsWith(l.model.toUpperCase())) return l;
  if (n.includes("D520")) return PRINTER_LIMITS[0];
  return null;
}
export function tooWideFor(name: string | null | undefined, wMm: number): PrinterLimit | null {
  const l = printerLimitFor(name);
  return l && wMm > l.maxLabelMm ? l : null;
}

// ── Encoders that need no stickerRaster layout ────────────────────────────────────────────────
/** 1-bit BMP data URL of a raster (pure, no canvas) — the laptop print page image. */
export function rasterBmpDataUrl(r: FullRaster, toBase64: (b: Uint8Array) => string): string {
  const stride = ((r.w + 31) >> 5) << 2, pix = stride * r.h, off = 14 + 40 + 8;
  const b = new Uint8Array(off + pix);
  const u32 = (i: number, v: number) => { b[i] = v & 255; b[i + 1] = (v >>> 8) & 255; b[i + 2] = (v >>> 16) & 255; b[i + 3] = (v >>> 24) & 255; };
  b[0] = 0x42; b[1] = 0x4d; u32(2, off + pix); u32(10, off);
  u32(14, 40); u32(18, r.w); u32(22, r.h); b[26] = 1; b[28] = 1; u32(34, pix); u32(38, 8000); u32(42, 8000); u32(46, 2); u32(50, 2);
  b[54] = b[55] = b[56] = 255; // palette 0 = white, 1 = black
  for (let y = 0; y < r.h; y++) b.set(r.buf.subarray(y * r.rowBytes, y * r.rowBytes + r.rowBytes), off + (r.h - 1 - y) * stride);
  return "data:image/bmp;base64," + toBase64(b);
}
const escHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
/** The laptop print page: exactly one W×H mm page holding the sticker picture at W×H mm. */
export function laptopStickerPage(wMm: number, hMm: number, src: string, title: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>` +
    `@page{size:${wMm}mm ${hMm}mm;margin:0}` +
    `*{margin:0;padding:0}html,body{width:${wMm}mm;height:${hMm}mm;overflow:hidden;background:#fff}` +
    `img{display:block;width:${wMm}mm;height:${hMm}mm;image-rendering:pixelated;image-rendering:crisp-edges}` +
    `</style></head><body><img alt="" src="${src}"></body></html>`;
}
/** A thin frame on the label edge (laptop test print: shows a wrong scale / margin). */
export function framed(r: FullRaster, px = 2): FullRaster {
  const buf = new Uint8Array(r.buf);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (x < px || y < px || x >= r.w - px || y >= r.h - px) buf[y * r.rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return { ...r, buf };
}
export { CJK_CELLS as ONE_STICKER_CJK_CELLS };
export type { Fonts };
