// LIVE print pattern — "will it fit?" warning. Nov 3 (item 8): it measures the layout that WILL PRINT for
// the saved printer (fixed-cell / font-C compact v1 / compact v2 / the Niimbot frame) with the same payload
// the print builds, against a fixed sample: a 20-letter three-word name and a 27-character six-word
// comment. Display only — nothing printed.
import type { NativeStickerPayload, Settings, StickerPath } from "./printing";
import { buildNativeStickerPayload, imageStickerPayload, imagePathAtlases, stickerCompactV2Effective, NIIMBOT_CANVAS, NIIMBOT_LABEL, BROWSER_STICKER_FONTS, BROWSER_STICKER_PAD, browserStickerQr } from "./printing";
import type { Buyer } from "../../lib/orderTypes";
import { stickerDrawOps, stickerQrPlacement, rightmostOpEdge, STICKER_LAYOUTS, isPropCompactSize, propLayoutLines, propLayoutLinesV2, propStackTops, COMPACT_V2_GAP, type DrawOp, type RasterPayload, type RasterAtlases, type PropFont } from "./stickerRaster";

export const FIT_SAMPLE_NAME = "Cristine Ramos Cabanas";        // 20 letters, 3 words
export const FIT_SAMPLE_COMMENT = "Mine black size XL 2pcs 350";   // 27 characters, 6 words
export const FIT_SAMPLE_HANDLE = "cristineramos";

// Item 5 (round 2): "browser" = the laptop print page (no native printer) — measured from its own font table.
export type FitPath = StickerPath | "browser";
// The size controls of the LIVE print pattern that can push or cut (item 14): each maps to its Settings scale.
export type FitControl = "printStoreScale" | "printBuyerNumberScale" | "printBuyerNameScale" | "printUsernameScale" | "printCommentScale";
export const FIT_CONTROLS: FitControl[] = ["printStoreScale", "printBuyerNumberScale", "printBuyerNameScale", "printUsernameScale", "printCommentScale"];
export interface StickerFit {
  overflow: boolean;                 // a) something ends past the bottom or right edge (or into the QR column)
  commentScale: number | null;       // b) always null since Nov 3 (item 4): the comment prints at the CHOSEN size
  cut: boolean;                      // c) fewer comment words / name letters than at all-1× scales (or a "…" cut on the compact layouts)
  // item 14: per control (only the ones above 1×) — "push" = with this control back at 1× nothing runs off the
  // sticker; "cut" = with it back at 1× more of the name / comment fits. Shown in red next to that control.
  // "limit" (item 2, round 2) = the buyer number prints at the largest size that fits whole (below the chosen level).
  controls: Partial<Record<FitControl, "push" | "cut" | "limit">>;
}
export const sampleBuyer = (): Buyer => ({
  handle: FIT_SAMPLE_HANDLE, name: FIT_SAMPLE_NAME, platform: "TikTok", num: 12, totalSpent: 350, totalOrders: 1,
  orders: [{ orderNum: 1, item: FIT_SAMPLE_COMMENT, qty: 1, price: 350, total: 350, time: "14:05", handle: FIT_SAMPLE_HANDLE, name: FIT_SAMPLE_NAME, bNum: 12, platform: "TikTok", status: "New", date: "2026-09-30" }],
} as Buyer);

interface Measure { overflow: boolean; cut: boolean; words: number; letters: number; commentXm: number | null; offN: number; cutN: number; numScale: number }
// PURE: the measure of the layout that prints for (path, payload, atlases). Exported for the tests.
export function measurePrint(path: StickerPath, np: NativeStickerPayload, img: RasterPayload, atlases: RasterAtlases): Measure {
  const w = path === "niimbot" ? NIIMBOT_LABEL.w : np.labelWidthMm, h = path === "niimbot" ? NIIMBOT_LABEL.h : np.labelHeightMm;
  const compact = atlases.proportional && isPropCompactSize(w, h);
  if (compact) {
    const canvas = path === "niimbot" ? NIIMBOT_CANVAS : undefined;
    const L = img.settings?.printCompactV2 ? propLayoutLinesV2(img, w, h, atlases, canvas) : propLayoutLines(img, w, h, atlases, canvas);
    const H = L.h;
    const v1 = "x" in L;
    const rows = v1 ? (L.lines as { font: PropFont; scale?: number }[]).map((l) => l.font.h * (l.scale ?? 1)) : [];
    const tops = v1 ? propStackTops(L.lines, H, L.header) : [];
    const lines = [...(L.lines as { line: { cut: boolean; text: string; inkWidth: number }; font: PropFont; scale?: number; top?: number; x?: number }[]), ...(v1 ? L.header?.lines ?? [] : [])];
    let offN = 0; // rows off the sticker (past the bottom, or into the QR column / past the right edge)
    const rightLimit = L.qr ? L.qr.x0 : L.w;
    for (const l of lines) if ((l.x ?? (v1 ? L.x : 0)) + l.line.inkWidth * (l.scale ?? 1) > rightLimit) offN++;
    if (v1) { rows.forEach((hh, i) => { if (tops[i] + hh > H) offN++; }); if (rows.length && rows.reduce((a, b) => a + b, 0) + (L.header?.h ?? 0) + COMPACT_V2_GAP * (rows.length + 1) > H) offN++; }
    else lines.forEach((l) => { if ((l.top ?? 0) + l.font.h * (l.scale ?? 1) > H) offN++; });
    const comment = lines.find((l) => l.line.text.startsWith(FIT_SAMPLE_COMMENT.slice(0, 6)) || l.line.text.startsWith("Mine"));
    const cutN = lines.filter((l) => l.line.cut).length;
    const numText = String(img.buyer?.num ?? img.buyer?.bNum ?? 0);
    const numLine = lines.find((l) => l.line.text === numText);
    return { overflow: offN > 0, cut: cutN > 0, words: comment ? comment.line.text.split(/\s+/).filter(Boolean).length : 0, letters: lines.filter((l) => l.line.text.startsWith("Cristine")).reduce((n, l) => n + l.line.text.replace(/[\s…]/g, "").length, 0), commentXm: null, offN, cutN, numScale: numLine?.scale ?? 1 };
  }
  const cfg = STICKER_LAYOUTS[`${w}x${h}`] ?? STICKER_LAYOUTS["100x60"];
  const r = stickerDrawOps(img, w, h, "extended", stickerQrPlacement(img, cfg.wDots, h * 8, h));
  const sep = r.ops.find((o) => o.k === "bar" && o.x === 16);
  const sepY = sep ? sep.y : Infinity;
  const buyerOp = r.ops.find((o) => o.k === "txt" && o.s === "Buyer");
  const buyerY = buyerOp ? buyerOp.y : -1;
  const text = r.ops.filter((o): o is Exclude<DrawOp, { k: "bar" }> => o.k !== "bar");
  const comment = text.filter((o) => o.y > sepY && !(o.k === "txt" && o.font === "2"));
  const name = text.filter((o) => o.k === "txt" && o.font === "4" && o.y < sepY && o.y > 48 && o.y !== buyerY);
  // text that reaches into the QR column (50×30 / the sizes with a QR) is "off the sticker" too
  const qr = stickerQrPlacement(img, cfg.wDots, h * 8, h);
  const qrH = qr ? qr.matrix.length * qr.scale : 0;
  const intoQr = !!qr && text.some((o) => o.y < qr.y0 + qrH && o.y + opHeight(o) > qr.y0 && rightmostOpEdge([o]) > qr.x0);
  const offN = r.ops.filter((o) => o.y + (o.k === "bar" ? o.h : opHeight(o)) > r.hDots).length + text.filter((o) => rightmostOpEdge([o]) > r.wDots).length + (intoQr ? 1 : 0);
  const cutN = text.filter((o) => o.s.includes("…")).length;
  // the 50×30 number: its level = ym / 2 (the fixed-cell sizes scale the number's height only → never limited)
  const numOp = w === 50 && h === 30 ? text.find((o) => o.k === "txt" && o.font === "4" && o.y === 6) : undefined;
  return {
    overflow: offN > 0, offN, cutN, numScale: numOp ? Math.max(1, Math.round((numOp.ym ?? 2) / 2)) : Number.POSITIVE_INFINITY,
    cut: cutN > 0,
    commentXm: comment.length ? comment[0].xm : null,
    words: comment.reduce((n, o) => n + o.s.split(/\s+/).filter(Boolean).length, 0),
    letters: name.reduce((n, o) => n + o.s.replace(/\s/g, "").length, 0),
  };
}

// PURE estimate of the laptop print page (printing.browserStickerHtml) for the fixed sample: the page is one
// label tall (overflow hidden) with vh-scaled fonts; a nowrap line is cut with "…" when its text is wider than
// the column (ponytail: text width ≈ 0.58 em per character of the bold sans — an estimate, not a browser layout).
export function measureBrowserPage(cfg: Settings, buyer: Buyer, storeName: string, wMm: number, hMm: number): Measure {
  const vh = hMm / 100, vw = wMm / 100;
  const clamp = (f: { min: number; max: number; vh?: number; vw?: number }) => Math.min(f.max, Math.max(f.min, (f.vh ?? 0) * vh + (f.vw ?? 0) * vw));
  const L = (v: unknown) => Math.max(1, Math.min(8, Number(v) || 1));
  const padY = clamp(BROWSER_STICKER_PAD.y), padX = clamp(BROWSER_STICKER_PAD.x);
  const innerH = hMm - 2 * padY, innerW = wMm - 2 * padX;
  const qr = browserStickerQr(buyer, cfg);
  const qrPad = qr ? qr.sizeMm + 1.5 : 0;
  const F = BROWSER_STICKER_FONTS;
  const size = (f: { min: number; vh: number; max: number }, lv = 1) => clamp(f) * lv;
  const textW = (t: string, mm: number) => [...t].length * 0.58 * mm;
  let h = 0, offN = 0, cutN = 0, words = 0, letters = 0;
  const block = (mm: number, lh: number, extra = 0) => { h += mm * lh + extra; };
  block(size(F.brand), F.brand.lh);                       // head row (brand + date)
  h += 0.6 + 0.6 + clamp({ min: 1, vh: 2.5, max: 2.4 });  // bar + margins
  if (cfg.printStoreName && storeName) { const mm = size(F.store, L(cfg.printStoreScale)); block(mm, F.store.lh); if (textW(storeName, mm) > innerW) cutN++; }
  if (cfg.printBuyerNumber) { const mm = size(F.bnum, L(cfg.printBuyerNumberScale)); block(mm, F.bnum.lh); if (textW(`Buyer ${buyer.num}`, mm) > innerW) offN++; }
  if (buyer.name && cfg.printBuyerName !== false) { const mm = size(F.name, L(cfg.printBuyerNameScale)); block(mm, F.name.lh, 1); const fit = Math.floor((innerW - qrPad) / (0.58 * mm)); if (fit < [...buyer.name].length) cutN++; letters = Math.min([...buyer.name.replace(/\s/g, "")].length, Math.max(0, fit - 1)); }
  if (cfg.printBuyerUsername && buyer.handle) { const mm = size(F.user, L(cfg.printUsernameScale)); block(mm, F.user.lh); if (textW("@" + buyer.handle, mm) > innerW - qrPad) cutN++; }
  const item = buyer.orders?.[0]?.item ? String(buyer.orders[0].item) : "";
  if (cfg.printOrderItems && item) {
    if (buyer.orders?.[0]?.time && cfg.printDateTime !== false) block(size(F.ftime), F.ftime.lh);
    const mm = size(F.code, L(cfg.printCommentScale)); block(mm, F.code.lh);
    const fit = Math.floor((innerW - qrPad) / (0.58 * mm));
    const t = item.slice(0, 14);
    if (fit < [...t].length) cutN++;
    words = t.slice(0, Math.max(0, fit - 1)).split(/\s+/).filter(Boolean).length;
  }
  if (h > innerH) offN++;
  return { overflow: offN > 0, cut: cutN > 0, words, letters, commentXm: null, offN, cutN, numScale: Number.POSITIVE_INFINITY };
}

// The fit of what the saved printer prints for these settings (async: the font-C atlases load on demand).
export async function stickerFit(settings: Settings, cur: string, shopName: string, path: FitPath): Promise<StickerFit> {
  const measure = async (st: Settings) => {
    if (path === "browser") { const wh = String(st.stickerSize ?? "100x60").match(/^(\d+)x(\d+)/); return measureBrowserPage(st, sampleBuyer(), shopName, Number(wh?.[1] ?? 100), Number(wh?.[2] ?? 60)); }
    const np0 = buildNativeStickerPayload(sampleBuyer(), cur, shopName, st);
    const np = path === "niimbot" ? { ...np0, labelWidthMm: NIIMBOT_LABEL.w, labelHeightMm: NIIMBOT_LABEL.h } : np0;
    const img = imageStickerPayload(np, "TikTok");
    const atlases = path === "aimo" && !(stickerCompactV2Effective() && isPropCompactSize(np.labelWidthMm, np.labelHeightMm)) ? await aimoAtlases(np) : await imagePathAtlases(np, img);
    return measurePrint(path, np, img, atlases);
  };
  const now = await measure(settings);
  const ones: Settings = { ...settings, printStoreScale: 1, printBuyerNumberScale: 1, printBuyerNameScale: 1, printUsernameScale: 1, printOrderScale: 1, printCommentScale: 1, printTotalScale: 1 };
  const base = await measure(ones);
  const controls: StickerFit["controls"] = {};
  for (const c of FIT_CONTROLS) {
    const wanted = Number(settings[c]) || 1;
    if (wanted <= 1) continue;
    if (c === "printBuyerNumberScale" && now.numScale < wanted) { controls[c] = "limit"; continue; } // item 2: printed whole at the largest size that fits
    const without = await measure({ ...settings, [c]: 1 });            // this control alone back at 1×
    const alone = await measure({ ...ones, [c]: settings[c] });         // item 6: ONLY this control raised (several 3× together each get their line)
    if (now.offN > without.offN || alone.offN > base.offN) controls[c] = "push";                  // it pushes more off the sticker
    else if (now.cutN > without.cutN || now.words < without.words || now.letters < without.letters || alone.cutN > base.cutN || alone.words < base.words || alone.letters < base.letters) controls[c] = "cut"; // less fits because of it
  }
  return { overflow: now.overflow, commentScale: null, cut: now.cut || now.words < base.words || now.letters < base.letters, controls };
}
const opHeight = (o: Exclude<DrawOp, { k: "bar" }>): number => (o.k === "cjk" ? 24 : o.font === "4" ? 32 : o.font === "3" ? 24 : o.font === "2" ? 20 : 12) * (o.ym ?? 1);
async function aimoAtlases(np: NativeStickerPayload): Promise<RasterAtlases> {
  const { LATIN_ATLAS } = await import("./glyphAtlas.latin");
  const { payloadNeedsCjk } = await import("./stickerRaster");
  let cjk = {};
  if (payloadNeedsCjk(np)) { try { cjk = await (await import("./cjkAtlasLoader")).loadCjkAtlas(); } catch { cjk = {}; } }
  return { latin: LATIN_ATLAS, cjk };
}
export const stickerFitWarns = (f: StickerFit): boolean => f.overflow || f.commentScale != null || f.cut;
