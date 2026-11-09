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
/** No ink in the bottom 1.5 mm of the label (the gap sensor; XP-420B fed a blank label when a
 *  descender reached 1 mm from the edge) — the layout's own margin, measured on real ink. */
export const BOTTOM_SAFE_DOTS = 12;
export function baseSizes(wMm: number, hMm: number): Base {
  // the APPROVED preview's own formulas (mm of label HEIGHT → dots per em at 8 dots/mm), on a height
  // no taller than 3/4 of the width: every standard size (all at least 4:3 wide) is exactly the
  // preview, while a square / tall custom label (50×50, 40×60 …) keeps its text narrow enough that a
  // 4-digit buyer number still fits next to the QR
  const hEff = Math.min(hMm, (wMm * 3) / 4);
  const mm = (k: number) => Math.max(10, Math.round(hEff * k * 8));
  const num = mm(0.19);
  return {
    shop: mm(0.10), word: Math.round(num * 0.42), num, name: mm(0.105), user: mm(0.085), comment: mm(0.12),
    date: Math.round(Math.min(3.0, Math.max(2.0, hMm * 0.065)) * 8), // fixed, 2.0–3.0 mm
    minComment: hMm < 35 ? 17 : 19, // ≈2.1 mm on a short label, ≈2.4 mm otherwise
    margin: BOTTOM_SAFE_DOTS,        // 1.5 mm (also the bottom ink safety)
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
/** width = cut with "…" (or the buyer number too wide); height = off the bottom (only when even the
 *  smallest readable sizes cannot hold every line — never on a label ≥ 30 mm, test-proven); smaller =
 *  the print made this fixed line smaller so that no line goes missing (bottom safety guard). */
export interface FitWarning { part: PartKey | "qr"; kind: "width" | "height" | "smaller" }
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
  const set = new Set<SansWeight>([700]); // the date (the "Buyer" word follows Buyer #)
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
/** The faces / cells the picture of `s` + `inp` needs but `fonts` lacks (empty = the picture is the
 *  real one). The print keeps its own fallback; the SCREEN never shows a device-font picture as the
 *  sticker — a non-empty list there means "Preview couldn't load". */
export function missingFonts(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts): string[] {
  const miss: string[] = [];
  for (const w of new Set<SansWeight>([...weightsFor(s), 400])) if (!fonts.sans[w]) miss.push(`sans${w}`);
  const text = printableText(allText(inp));
  if (KANA_FULLWIDTH.test(text) && !fonts.cjkx) miss.push("cjkx");
  if (hasIdeograph(text)) for (const cell of cjkCellsFor(layoutSticker(s, inp, fonts).sizes)) if (!fonts.cjk?.[cell]) miss.push(`cjk${cell}`);
  return miss;
}
export function fontsReadySync(): Fonts {
  return { sans: { 400: getSansFace(400) ?? undefined, 700: getSansFace(700) ?? undefined, 900: getSansFace(900) ?? undefined }, cjkx: getSansFace("cjkx"), cjk: {} };
}
export { CJK_CELLS };

// ── Layout ────────────────────────────────────────────────────────────────────────────────────
interface Laid { run: LineRun; px: number; weight: SansWeight; ink: boolean; x: number; baseline: number; clip: number; part: PartKey | "date" }
interface QrBox { matrix: boolean[][]; x: number; y: number; mod: number }
export interface Layout { w: number; h: number; lines: Laid[]; qr: QrBox | null; warnings: FitWarning[]; sizes: number[]; commentPx: number | null; commentWantPx: number | null }
/** px of a fixed part chosen by the bottom-safety guard (shop / buyer number / name / @username). */
type PxOver = Partial<Record<"shop" | "buyer" | "name" | "user", number>>;
const GUARD_ORDER = ["user", "name", "buyer", "shop"] as const; // the lowest line gives way first
interface Pass { L: Layout; crossing: PartKey[]; commentMissing: boolean; numberCut: boolean; px: PxOver }
const passFits = (q: Pass) => !q.crossing.length && !q.commentMissing && !q.numberCut;
/** A generator step: a heavy layout yields after every pass, so the screen can run it in idle time. */
export type Steps<T> = Generator<void, T, void>;
export function runSteps<T>(g: Steps<T>): T { for (;;) { const r = g.next(); if (r.done) return r.value; } }
function* passG(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts, over: PxOver): Steps<Pass> {
  const q = layoutPass(s, inp, fonts, opts, over);
  yield;
  return q;
}
/** The smallest size a fixed line is ever made (≈2.4 mm; ≈2.1 mm on a 50×30-class label). */
export const minReadablePx = (wMm: number, hMm: number): number => (isSmallClass(wMm, hMm) ? 17 : 19);

/** The sticker layout. BOTTOM SAFETY GUARD (Jeff 2026-11-09: a line is NEVER missing): when a real
 *  buyer's Buyer #, name, @username or 2-line Facebook name would cross the bottom 1.5 mm, the comment
 *  gives up space first (its own shrink → fewer lines → "…", keeping at least one line); only then is
 *  the lowest fixed line made smaller, just enough, never below minReadablePx — the line above next
 *  if that is not enough. Each line made smaller → a "smaller" warning (amber note). The saved setting
 *  is never changed; the preview draws this same layout. */
export function layoutSticker(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): Layout {
  return runSteps(layoutStickerSteps(s, inp, fonts, opts));
}
export function* layoutStickerSteps(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): Steps<Layout> {
  let q = yield* passG(s, inp, fonts, opts, {});
  if (passFits(q)) return q.L;
  const minP = minReadablePx(s.size.w, s.size.h);
  const over: PxOver = {};
  const shrunk: PartKey[] = [];
  // A (Jeff): a buyer number cut across its width (beside the QR, or by the date / the label edge on any
  // size) → the number is made just small enough to print whole (never cut, a QR kept; never below the
  // readable minimum)
  if (q.numberCut && q.px.buyer != null && q.px.buyer > minP) {
    const cur = q.px.buyer;
    const whole = (x: Pass) => !x.numberCut;
    const atMin = yield* passG(s, inp, fonts, opts, { buyer: minP });
    let lo = minP;
    if (whole(atMin)) { let hi = cur - 1; while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (whole(yield* passG(s, inp, fonts, opts, { buyer: mid }))) lo = mid; else hi = mid - 1; } }
    over.buyer = lo; shrunk.push("buyer");
    q = lo === minP ? atMin : yield* passG(s, inp, fonts, opts, { ...over });
  }
  // a number still cut at the readable minimum (unreachable in the tested range) must not make the loop
  // below shrink other lines for nothing: from here the lines are judged without it
  const cutStuck = q.numberCut;
  const fitsLines = (x: Pass) => !x.crossing.length && !x.commentMissing && (cutStuck || !x.numberCut);
  for (const k of GUARD_ORDER) {
    if (fitsLines(q)) break;
    const cur = q.px[k];
    if (cur == null) continue; // not on this sticker
    const lo0 = Math.min(cur, minP);
    if (lo0 >= cur) continue; // already at (or below) the readable minimum
    const atMin = yield* passG(s, inp, fonts, opts, { ...over, [k]: lo0 });
    if (!fitsLines(atMin)) { over[k] = lo0; q = atMin; shrunk.push(k); continue; }
    let lo = lo0, hi = cur - 1; // lo always fits; the biggest size that fits
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fitsLines(yield* passG(s, inp, fonts, opts, { ...over, [k]: mid }))) lo = mid; else hi = mid - 1; }
    over[k] = lo; shrunk.push(k);
    q = lo === lo0 ? atMin : yield* passG(s, inp, fonts, opts, { ...over });
  }
  const L = q.L;
  if (!fitsLines(q)) {
    // unreachable on any label ≥ 30 mm (oneSticker.noLineMissing.test.ts): even every line at its
    // readable minimum crosses — never ink in the margin (a blank label), the red note says it
    const drop = new Set<string>(q.crossing);
    L.lines = L.lines.filter((l) => !drop.has(l.part));
    for (const part of q.crossing) L.warnings.push({ part, kind: "height" });
    if (q.commentMissing) L.warnings.push({ part: "comment", kind: "height" });
    // (a number still cut at the readable minimum keeps its "width" warning: red on the screen)
  }
  for (const part of shrunk) L.warnings.push({ part, kind: "smaller" });
  L.warnings = dedupWarnings(L.warnings);
  return L;
}
/** True when this buyer's lines only fit because the guard makes a fixed line smaller (or not even then). */
export function needsFitGuard(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): boolean {
  return !passFits(layoutPass(s, inp, fonts, opts, {}));
}
function* needsFitGuardG(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts): Steps<boolean> {
  return !passFits(yield* passG(s, inp, fonts, opts, {}));
}

function layoutPass(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts, over: PxOver): Pass {
  const wMm = s.size.w, hMm = s.size.h;
  const W = opts.canvas?.w ?? wMm * DOTS_PER_MM, H = opts.canvas?.h ?? hMm * DOTS_PER_MM;
  const B = baseSizes(wMm, hMm);
  const mx = opts.canvas?.edgeX ?? B.margin, my = opts.canvas?.edgeY ?? B.margin;
  const fb = inp.fbNameOnly === true || isFacebookLike(inp.platform);
  const lines: Laid[] = [];
  const warnings: FitWarning[] = [];
  const sizes: number[] = [];
  const crossing: PartKey[] = []; // fixed lines whose real ink would cross the bottom limit (the guard fixes them)
  let numberCut = false;          // the buyer number cut across its width — QR, date or edge (the guard fixes it)
  const usedPx: PxOver = {};
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
  const dExt = lineExtent(dRun, B.date, 700, fonts); // heights from the CHOSEN weight: a lighter line never moves the rest
  const dTop = my, dBase = my + Math.max(dExt.asc, Math.round(B.date * 0.74));
  const dX = W - mx - dRun.width;
  add({ run: dRun, px: B.date, weight: dSt.weight, ink: dSt.ink, x: dX, baseline: dBase, clip: W, part: "date" });
  const dBottom = dBase + Math.max(dExt.desc, 2);
  const obstacles: { top: number; bottom: number; left: number }[] = [{ top: dTop - 2, bottom: dBottom + 2, left: dX - 10 }]; // 1.2 mm clear of the date (preview)

  // the buyer line at its widest — at least 4 digits ("Buyer 8888", the most a busy live reaches): the
  // QR never takes the room that number needs (a smaller module first; the number is never cut by it)
  const num = inp.buyerNum != null && String(inp.buyerNum) !== "" ? String(inp.buyerNum) : "";
  const handle = printableText(inp.handle).replace(/^@+/, "");
  const qrUrl = s.qr && !fb && qrAllowedForPlatform(inp.platform) && handle ? tiktokProfileUrl(handle) : null;
  const m = qrUrl ? qrMatrix(qrUrl, "M") : null;
  const lineNeed = (pn: number) => measure("Buyer", Math.max(10, Math.round(pn * 0.42)), wt("buyer"), fonts).width + Math.max(6, Math.round(pn * 0.14)) + measure(num.length >= 4 ? num : "8888", pn, wt("buyer"), fonts).width;
  // a narrow custom label (e.g. 30–40 mm wide): the 1× number is capped so "Buyer 8888" fits beside the
  // smallest QR — the recommended settings always fit; a bigger step the seller picks can still be red
  let numBase = B.num, startBelowDate = false;
  if (P.buyer.on && num) {
    const qrFits = !!m && m.length * 4 <= W * 0.45;
    const qrFoot = qrFits ? m!.length * 4 + 4 * 4 + Math.max(4, mx - 4) : mx;
    // with no shop line the buyer line sits beside the date too
    const shopPrinted = P.shop.on && !!printableText(inp.storeName) && !isSmallClass(wMm, hMm);
    const capFor = (right: number) => { let b = B.num; while (b > 10 && mx + lineNeed(b) > right) b--; return b; };
    const beside = capFor(Math.min(W - qrFoot, shopPrinted ? W : dX - 10));
    numBase = beside;
    // a label so narrow that the fixed date leaves no room beside it (e.g. 30 mm wide): the left
    // column starts under the date instead of shrinking the number
    if (!shopPrinted && beside < B.num * 0.8) { startBelowDate = true; numBase = capFor(W - qrFoot); }
  }
  const buyerPx = over.buyer ?? px("buyer", numBase), buyerWordPx = Math.max(10, Math.round(buyerPx * 0.42)), buyerGap = Math.max(6, Math.round(buyerPx * 0.14));
  const buyerNeed = P.buyer.on && num ? lineNeed(buyerPx) : 0;
  // QR — TikTok only, under the date, right side
  let qr: QrBox | null = null;
  if (m) {
    {
      const n = m.length;
      const top = dBottom + 6;
      const room = H - my - top;
      let mod = 0, roomOnly = 0;
      for (const cand of [6, 5, 4]) {
        if (!(n * cand <= room && n * cand <= W * 0.45)) continue;
        roomOnly ||= cand;
        const left = W - Math.max(4, mx - 4) - n * cand - cand * 4; // the QR with its quiet zone
        if (!buyerNeed || mx + buyerNeed <= left) { mod = cand; break; }
      }
      if (!mod && roomOnly) mod = [6, 5, 4].filter((c) => c <= roomOnly).pop() ?? roomOnly; // the smallest that fits; the screen shows red
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
  let y = startBelowDate ? dBottom + 4 : my;
  // BOTTOM SAFETY (label overflow, XP-420B paper test 2026-11-09): no INK below this row — measured on
  // the real glyphs (descenders, marks under a letter, device-font runs), never on line boxes. A
  // descender 1 mm from the edge made the printer feed an extra blank label. On a label-sized canvas
  // this is the 1.5 mm margin (BOTTOM_SAFE_DOTS); the Niimbot frame already sits 1 mm inside the paper.
  const bottomLimit = H - my;
  const placeLine = (run: LineRun, p: number, st: InkStyle, part: PartKey, extraGap = true): number => {
    const w = st.weight;
    // the line's height comes from the seller's CHOSEN weight: the guard printing it lighter never
    // moves the lines below (and so never changes how big the comment can be)
    const ext = lineExtent(run, p, wt(part), fonts);
    const asc = Math.max(ext.asc, Math.round(p * 0.72)), desc = Math.max(ext.desc, Math.round(p * 0.08));
    const baseline = y + asc;
    const clip = rightAt(y, baseline + desc);
    if (mx + run.width > clip) warnings.push({ part, kind: "width" });
    // a line whose real ink would cross the bottom limit: the guard (layoutSticker) lays the sticker out
    // again with this line smaller — never dropped, never half a line in the margin
    if (baseline + desc > bottomLimit) crossing.push(part);
    add({ run, px: p, weight: w, ink: st.ink, x: mx, baseline, clip, part });
    y = baseline + desc + (extraGap ? gapOf(p) : 0);
    return baseline;
  };
  const widthAtY = (p: number) => Math.max(10, rightAt(y, y + Math.round(p * 1.05)) - mx);

  // 1. shop name
  const shop = printableText(inp.storeName);
  if (P.shop.on && shop && !isSmallClass(wMm, hMm)) {
    const p = over.shop ?? px("shop", B.shop);
    usedPx.shop = p;
    const { st, out: { line, cut } } = fitted(shop, p, wt("shop"), widthAtY(p));
    if (cut) warnings.push({ part: "shop", kind: "width" });
    placeLine(line, p, st, "shop");
  }
  // 2. "Buyer 12"
  if (P.buyer.on && num) {
    const pn = buyerPx, pw = buyerWordPx; // the small word: 0.42 of the number (preview)
    const { st: nSt, out: nRun } = one(num, pn, wt("buyer"));
    const { st: wSt, out: wRun } = one("Buyer", pw, wt("buyer")); // the seller's Buyer # weight (preview)
    usedPx.buyer = pn;
    const ext = lineExtent(nRun, pn, wt("buyer"), fonts);
    const asc = Math.max(ext.asc, Math.round(pn * 0.72));
    const baseline = y + asc;
    const clip = rightAt(y, baseline);
    const gap = buyerGap;
    if (mx + wRun.width + gap + nRun.width > clip) { warnings.push({ part: "buyer", kind: "width" }); numberCut = true; }
    // the bottom check reads BOTH runs' real ink — the small word's "y" hangs below the digits
    const inkDesc = Math.max(ext.desc, lineExtent(wRun, pw, wt("buyer"), fonts).desc);
    if (baseline + inkDesc > bottomLimit) crossing.push("buyer");
    add({ run: wRun, px: pw, weight: wSt.weight, ink: wSt.ink, x: mx, baseline, clip, part: "buyer" });
    add({ run: nRun, px: pn, weight: nSt.weight, ink: nSt.ink, x: mx + wRun.width + gap, baseline, clip, part: "buyer" });
    y = baseline + Math.max(ext.desc, 2) + gapOf(pn);
  }
  // 3. name (Facebook: up to 2 lines)
  const name = printableText(inp.name);
  if (P.name.on && name) {
    const p = over.name ?? px("name", B.name);
    usedPx.name = p;
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
    const p = over.user ?? px("user", B.user);
    usedPx.user = p;
    const { st, out: { line, cut } } = fitted("@" + handle, p, wt("user"), widthAtY(p));
    if (cut) warnings.push({ part: "user", kind: "width" });
    placeLine(line, p, st, "user");
  }
  // 5. comment / price — every line left; shrink to the minimum, then "…"
  let commentPx: number | null = null, commentWantPx: number | null = null;
  const comment = printableText(inp.items.filter(Boolean).join(" · "));
  if (P.comment.on && comment) {
    const startY0 = y;
    const wChosen = wt("comment");
    // the comment is the FIRST thing on the label (every part above it off): its tall marks (Ễ Ỗ) must
    // not start above the top margin — the first line moves down by the real height of the marks on THAT
    // line (the first line as it wraps here, also as a cut "…" line), settled in ≤ 3 rounds
    const lineHOf = (p: number) => (hasIdeograph(comment) ? Math.max(Math.round(p * 1.12), (() => { const c = cjkCellFor(p); return c.cell * c.mag + cjkInk(p, wChosen).dy + 2; })()) : Math.round(p * 1.12));
    const leadFor = (p: number): number => {
      if (startY0 > my) return 0;
      const lh = lineHOf(p);
      let lead = 0;
      for (let round = 0; round < 3; round++) {
        const sy = startY0 + lead;
        const widthAt = (i: number) => Math.max(10, rightAt(sy + i * lh, sy + (i + 1) * lh) - mx);
        let asc = 0;
        for (const m of [99, 1]) { const l0 = wrapText(comment, p, wChosen, widthAt, m, fonts).lines[0]; if (l0) asc = Math.max(asc, lineExtent(l0, p, wChosen, fonts).asc); }
        const next = Math.max(0, asc - Math.round(p * 0.88));
        if (next <= lead) break;
        lead = next;
      }
      return lead;
    };
    let p = px("comment", B.comment);
    commentWantPx = p;
    const minP = Math.min(p, B.minComment);
    for (;;) {
      const startY = startY0 + leadFor(p);
      // Chinese characters fill their whole cell: stacked lines get at least 2 white dots between them
      const lineH = lineHOf(p);
      const maxLines = Math.max(0, Math.floor((bottomLimit - startY + Math.round(p * 0.12)) / lineH));
      const widthOf = (i: number) => Math.max(10, rightAt(startY + i * lineH, startY + (i + 1) * lineH) - mx);
      // the last line's REAL ink (a "p", "g", "ị" or a Thai mark under it) must stay above the bottom
      // limit — the line box alone lets it run into the margin; one line fewer then ("…" / smaller)
      const inkFits = (lines: LineRun[], weight: SansWeight) => !lines.length || startY + (lines.length - 1) * lineH + Math.round(p * 0.88) + lineExtent(lines[lines.length - 1], p, weight, fonts).desc <= bottomLimit;
      const wrapAt = (weight: SansWeight) => {
        for (let m = maxLines; m > 0; m--) {
          const r = wrapText(comment, p, weight, widthOf, m, fonts);
          if (inkFits(r.lines, weight)) return r; // fewer lines than the text needs → r.cut ("…" / the size loop shrinks first)
        }
        return { lines: [] as LineRun[], cut: true };
      };
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
          add({ run: l, px: p, weight: w, ink: st.ink, x: mx, baseline, clip: widthOf(i) + mx, part: "comment" });
        });
        commentPx = p;
        break;
      }
      p = Math.max(minP, Math.round(p * 0.92) === p ? p - 1 : Math.round(p * 0.92));
    }
  }
  const commentMissing = P.comment.on && !!comment && !lines.some((l) => l.part === "comment");
  return { L: { w: W, h: H, lines, qr, warnings: dedupWarnings(warnings), sizes, commentPx, commentWantPx }, crossing: [...new Set(crossing)], commentMissing, numberCut, px: usedPx };
}
// ── The notes under the preview (approved Step 0 preview) ───────────────────────────────────────
//   bad  = a part runs off the BOTTOM of the label, or the buyer number does not fit (red "Too big")
//   warn = the comment was made smaller to fit (N %), the comment end was cut ("…"), the QR has no
//          room, or a fixed line was made smaller so that no line goes missing (amber)
//   info = a one-line part shortened with "…", no shop name on a label this small (grey)
//   ok   = everything fits (shown when there is no bad / warn)
export type FitNote = { kind: "bad"; parts: PartKey[] } | { kind: "shrunk"; pct: number } | { kind: "cut" } | { kind: "smaller"; parts: PartKey[] } | { kind: "short"; parts: PartKey[] } | { kind: "qr" } | { kind: "small" } | { kind: "ok" };
// The note pill's tone per kind (approved preview): green "fits", amber when the comment / QR had to
// give way, red when something is off the label; "Shortened with …" and "small label" are grey info.
export const NOTE_TONE: Record<FitNote["kind"], "ok" | "warn" | "bad" | "info"> = { ok: "ok", bad: "bad", shrunk: "warn", cut: "warn", smaller: "warn", qr: "warn", short: "info", small: "info" };
export function fitNotes(L: Pick<Layout, "warnings" | "commentPx" | "commentWantPx">, s: OneStickerSettings): FitNote[] {
  const out: FitNote[] = [];
  // off the bottom — or a buyer number too wide to print whole (a number is never shortened with "…")
  const off = L.warnings.filter((w) => (w.kind === "height" || (w.part === "buyer" && w.kind === "width")) && w.part !== "qr").map((w) => w.part as PartKey);
  if (off.length) out.push({ kind: "bad", parts: [...new Set(off)] });
  // the print made a fixed line smaller so that no line goes missing (amber; a part already red says it)
  const smaller = L.warnings.filter((w) => w.kind === "smaller" && !off.includes(w.part as PartKey)).map((w) => w.part as PartKey);
  const commentCut = L.warnings.some((w) => w.part === "comment" && w.kind === "width");
  if (L.commentPx != null && L.commentWantPx != null && L.commentPx < L.commentWantPx && !commentCut && !off.includes("comment")) out.push({ kind: "shrunk", pct: Math.round((L.commentPx / L.commentWantPx) * 100) });
  if (commentCut) out.push({ kind: "cut" });
  if (smaller.length) out.push({ kind: "smaller", parts: [...new Set(smaller)] });
  const short = L.warnings.filter((w) => w.kind === "width" && w.part !== "comment" && w.part !== "qr" && w.part !== "buyer").map((w) => w.part as PartKey);
  if (short.length) out.push({ kind: "short", parts: [...new Set(short)] });
  if (L.warnings.some((w) => w.part === "qr") && s.qr) out.push({ kind: "qr" });
  if (isSmallClass(s.size.w, s.size.h) && s.parts.shop.on) out.push({ kind: "small" });
  // "Everything fits" when nothing is red or amber (a one-line part shortened with "…" and "no shop
  // name on this size" are grey info notes)
  if (!out.some((n) => n.kind !== "small" && n.kind !== "short")) out.unshift({ kind: "ok" });
  return out;
}
// The WORST-CASE buyers the screen checks before Save (Jeff 2026-11-09): tall marks above and below
// (Vietnamese, Thai), Chinese with Latin descenders, a Facebook name that needs two lines, a SHORT TikTok
// handle (its small QR takes a bigger module → less width for the number) — every one as buyer #8888,
// with a comment of low-hanging letters / marks. A part that one of them would only fit by being made
// smaller is red on the screen, and its "+" stops at the largest size that always fits.
export const WORST_CASE_COMMENT = "gjpqy Ụ ợ";
export const WORST_CASE_BUYERS: readonly Pick<OneStickerInput, "name" | "handle" | "platform" | "fbNameOnly">[] = [
  { name: "Nguyễn Thị Ngọc Quỳnh", handle: "quynh.nguyen_gpqy", platform: "TikTok" },
  { name: "陳小美 Gigi Quyên", handle: "gigi.chen_pqy", platform: "TikTok" },
  { name: "ฐิติพัฒน์ ปู่ฤทธิ์", handle: "thitiphat_gpqy", platform: "TikTok" },
  { name: "Nguyễn Thị Ngọc Quỳnh", handle: "ab", platform: "TikTok" },
  { name: "Huỳnh Ỷ Ỵ Ỹ Ngọc", handle: "yy.jpg", platform: "TikTok" },           // marks above AND below, y / j / p / g
  { name: "Йорданка Щерева", handle: "yordanka_jq", platform: "TikTok" },        // Cyrillic Й / Щ (tall + low tail)
  { name: "Maria Clara Dela Cruz Santos Reyes Gonzaga Quiñones", handle: "Maria Clara Dela Cruz Santos Reyes Gonzaga Quiñones", platform: "Facebook", fbNameOnly: true },
  { name: "Nguyễn Thị Ngọc Quỳnh Huỳnh Phương Thùy Dương", handle: "Nguyễn Thị Ngọc Quỳnh Huỳnh Phương Thùy Dương", platform: "Facebook", fbNameOnly: true }, // a long Vietnamese 2-line Facebook name
];
export const worstCaseInputs = (inp: OneStickerInput): OneStickerInput[] => WORST_CASE_BUYERS.map((b) => ({ ...inp, ...b, buyerNum: "8888", items: [WORST_CASE_COMMENT] }));
/** Ideographs measured as their full cell: the check never depends on the atlases loaded. */
const worstFonts = (f: Fonts): Fonts => ({ ...f, cjkBox: true });
/** The fixed parts the guard changes for any of these buyers (made smaller, a number made whole, or not
 *  even then) — the parts "over their limit". */
function* guardedPartsG(s: OneStickerSettings, list: [OneStickerInput, Fonts][], opts: RenderOpts): Steps<Set<PartKey>> {
  const out = new Set<PartKey>();
  for (const [b, f] of list) {
    if (!(yield* needsFitGuardG(s, b, f, opts))) continue;
    for (const x of (yield* layoutStickerSteps(s, b, f, opts)).warnings) if ((x.kind === "smaller" || x.kind === "height" || (x.part === "buyer" && x.kind === "width")) && x.part !== "qr") out.add(x.part);
  }
  return out;
}
const screenBuyers = (inp: OneStickerInput, fonts: Fonts): [OneStickerInput, Fonts][] => [[inp, fonts], ...worstCaseInputs(inp).map((b) => [b, worstFonts(fonts)] as [OneStickerInput, Fonts])];
/** The notes for the screen: the layout of the preview's sample, plus the buyer number at its widest
 *  (4 digits) — a number that fits as #128 but not as #8888 is red, never "Everything fits" — plus the
 *  worst-case buyers (WORST_CASE_BUYERS): a part one of them would need made smaller is red. */
export function screenFitNotes(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): FitNote[] {
  return runSteps(screenFitNotesSteps(s, inp, fonts, opts));
}
export function* screenFitNotesSteps(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): Steps<FitNote[]> {
  const L = yield* layoutStickerSteps(s, inp, fonts, opts);
  const worst = yield* guardedPartsG(s, worstCaseInputs(inp).map((b) => [b, worstFonts(fonts)] as [OneStickerInput, Fonts]), opts);
  const extra: FitWarning[] = [...worst].map((part) => ({ part, kind: "height" as const }));
  const n = String(inp.buyerNum ?? "");
  if (s.parts.buyer.on && n && n.length < 4) {
    const wide = yield* layoutStickerSteps(s, { ...inp, buyerNum: "8888" }, fonts, opts);
    extra.push(...wide.warnings.filter((w) => w.part === "buyer" && (w.kind === "width" || w.kind === "smaller") && !L.warnings.some((x) => x.part === "buyer" && x.kind === w.kind)).map((w) => ({ part: w.part, kind: "height" as const })));
  }
  return fitNotes({ ...L, warnings: dedupWarnings([...L.warnings, ...extra]) }, s);
}
/** The "+" limits (Jeff 2026-11-09): the largest size step of each fixed part at which the preview's
 *  sample and every worst-case buyer fit with no line made smaller and #8888 printed whole.
 *  - A part OVER its limit (the guard changes it for one of them) gets its own limit (below its size →
 *    a grey "+"); parts are taken bottom-up as the guard takes them (Buyer # first when the number is cut).
 *  - Every other part's limit is worked out with the over parts HELD AT THEIR LIMITS (so only the part
 *    that is over gets a grey "+"). No entry = no limit. The comment has none: it always gives way first. */
export function screenStepCaps(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): Partial<Record<PartKey, number>> {
  return runSteps(screenStepCapsSteps(s, inp, fonts, opts));
}
export function* screenStepCapsSteps(s: OneStickerSettings, inp: OneStickerInput, fonts: Fonts, opts: RenderOpts = {}): Steps<Partial<Record<PartKey, number>>> {
  const caps: Partial<Record<PartKey, number>> = {};
  const list = screenBuyers(inp, fonts);
  const fits = function* (t: OneStickerSettings): Steps<boolean> { for (const [b, f] of list) if (yield* needsFitGuardG(t, b, f, opts)) return false; return true; };
  const at = (t: OneStickerSettings, k: PartKey, i: number): OneStickerSettings => ({ ...t, parts: { ...t.parts, [k]: { ...t.parts[k], scale: SCALE_STEPS[i] } } });
  const idx = (t: OneStickerSettings, k: PartKey) => Math.max(0, SCALE_STEPS.findIndex((x) => x === snapScale(t.parts[k].scale)));
  const fixedOn = (["buyer", "user", "name", "shop"] as const).filter((k) => s.parts[k].on && !(k === "shop" && isSmallClass(s.size.w, s.size.h)));
  let t = s;
  // 1. the parts over their limit, one at a time (each lowered to where the guard no longer changes it;
  //    asked again after each, so a part is never blamed for what the one before already fixed)
  const over = new Set<PartKey>();
  for (const k of fixedOn) {
    if (!(yield* guardedPartsG(t, list, opts)).has(k)) continue;
    over.add(k);
    const cur = idx(t, k);
    const okAt = function* (i: number): Steps<boolean> { return !(yield* guardedPartsG(at(t, k, i), list, opts)).has(k); };
    let lo = -1, hi = cur - 1; // the largest step below its size at which the guard leaves it alone
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (mid >= 0 && (yield* okAt(mid))) lo = mid; else hi = mid - 1; }
    const lim = Math.max(0, lo);
    caps[k] = SCALE_STEPS[lim];
    t = at(t, k, lim);
  }
  // 2. every other part, with the over parts held at their limits
  if (!(yield* fits(t))) return caps; // still not fitting: no limits for the rest (the red note says why)
  for (const k of fixedOn) {
    if (over.has(k)) continue;
    const top = SCALE_STEPS.length - 1;
    if (yield* fits(at(t, k, top))) continue; // the usual case: one check
    let lo = idx(t, k), hi = top - 1; // lo fits (t fits)
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (yield* fits(at(t, k, mid))) lo = mid; else hi = mid - 1; }
    caps[k] = SCALE_STEPS[lo];
  }
  return caps;
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
