// LIVE print pattern — "will it fit?" warning. Nov 3 (item 8): it measures the layout that WILL PRINT for
// the saved printer (fixed-cell / font-C compact v1 / compact v2 / the Niimbot frame) with the same payload
// the print builds, against a fixed sample: a 20-letter three-word name and a 27-character six-word
// comment. Display only — nothing printed.
import type { NativeStickerPayload, Settings, StickerPath } from "./printing";
import { buildNativeStickerPayload, imageStickerPayload, imagePathAtlases, stickerCompactV2Effective, NIIMBOT_CANVAS, NIIMBOT_LABEL } from "./printing";
import type { Buyer } from "../../lib/orderTypes";
import { stickerDrawOps, stickerQrPlacement, rightmostOpEdge, STICKER_LAYOUTS, isPropCompactSize, propLayoutLines, propLayoutLinesV2, propLineTops, COMPACT_V2_GAP, type DrawOp, type RasterPayload, type RasterAtlases, type PropFont } from "./stickerRaster";

export const FIT_SAMPLE_NAME = "Cristine Ramos Cabanas";        // 20 letters, 3 words
export const FIT_SAMPLE_COMMENT = "Mine black size XL 2pcs 350";   // 27 characters, 6 words
export const FIT_SAMPLE_HANDLE = "cristineramos";

// The size controls of the LIVE print pattern that can push or cut (item 14): each maps to its Settings scale.
export type FitControl = "printStoreScale" | "printBuyerNumberScale" | "printBuyerNameScale" | "printUsernameScale" | "printCommentScale";
export const FIT_CONTROLS: FitControl[] = ["printStoreScale", "printBuyerNumberScale", "printBuyerNameScale", "printUsernameScale", "printCommentScale"];
export interface StickerFit {
  overflow: boolean;                 // a) something ends past the bottom or right edge (or into the QR column)
  commentScale: number | null;       // b) always null since Nov 3 (item 4): the comment prints at the CHOSEN size
  cut: boolean;                      // c) fewer comment words / name letters than at all-1× scales (or a "…" cut on the compact layouts)
  // item 14: per control (only the ones above 1×) — "push" = with this control back at 1× nothing runs off the
  // sticker; "cut" = with it back at 1× more of the name / comment fits. Shown in red next to that control.
  controls: Partial<Record<FitControl, "push" | "cut">>;
}
export const sampleBuyer = (): Buyer => ({
  handle: FIT_SAMPLE_HANDLE, name: FIT_SAMPLE_NAME, platform: "TikTok", num: 12, totalSpent: 350, totalOrders: 1,
  orders: [{ orderNum: 1, item: FIT_SAMPLE_COMMENT, qty: 1, price: 350, total: 350, time: "14:05", handle: FIT_SAMPLE_HANDLE, name: FIT_SAMPLE_NAME, bNum: 12, platform: "TikTok", status: "New", date: "2026-09-30" }],
} as Buyer);

interface Measure { overflow: boolean; cut: boolean; words: number; letters: number; commentXm: number | null; offN: number; cutN: number }
// PURE: the measure of the layout that prints for (path, payload, atlases). Exported for the tests.
export function measurePrint(path: StickerPath, np: NativeStickerPayload, img: RasterPayload, atlases: RasterAtlases): Measure {
  const w = path === "niimbot" ? NIIMBOT_LABEL.w : np.labelWidthMm, h = path === "niimbot" ? NIIMBOT_LABEL.h : np.labelHeightMm;
  const compact = atlases.proportional && isPropCompactSize(w, h);
  if (compact) {
    const canvas = path === "niimbot" ? NIIMBOT_CANVAS : undefined;
    const L = img.settings?.printCompactV2 ? propLayoutLinesV2(img, w, h, atlases, canvas) : propLayoutLines(img, w, h, atlases, canvas);
    const H = L.h;
    const rows = "x" in L ? (L.lines as { font: PropFont; scale?: number }[]).map((l) => l.font.h * (l.scale ?? 1)) : [];
    const tops = "x" in L ? propLineTops(rows.map((hh) => ({ font: { h: hh } as PropFont })), H) : [];
    const lines = L.lines as { line: { cut: boolean; text: string; inkWidth: number }; font: PropFont; scale?: number; top?: number; x?: number }[];
    let offN = 0; // rows off the sticker (past the bottom, or into the QR column / past the right edge)
    const rightLimit = L.qr ? L.qr.x0 : L.w;
    for (const l of lines) if ((l.x ?? ("x" in L ? L.x : 0)) + l.line.inkWidth * (l.scale ?? 1) > rightLimit) offN++;
    if ("x" in L) { rows.forEach((hh, i) => { if (tops[i] + hh > H) offN++; }); if (rows.length && rows.reduce((a, b) => a + b, 0) + COMPACT_V2_GAP * (rows.length + 1) > H) offN++; }
    else lines.forEach((l) => { if ((l.top ?? 0) + l.font.h * (l.scale ?? 1) > H) offN++; });
    const comment = lines.find((l) => l.line.text.startsWith(FIT_SAMPLE_COMMENT.slice(0, 6)) || l.line.text.startsWith("Mine"));
    const cutN = lines.filter((l) => l.line.cut).length;
    return { overflow: offN > 0, cut: cutN > 0, words: comment ? comment.line.text.split(/\s+/).filter(Boolean).length : 0, letters: lines.filter((l) => l.line.text.startsWith("Cristine")).reduce((n, l) => n + l.line.text.replace(/[\s…]/g, "").length, 0), commentXm: null, offN, cutN };
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
  return {
    overflow: offN > 0, offN, cutN,
    cut: cutN > 0,
    commentXm: comment.length ? comment[0].xm : null,
    words: comment.reduce((n, o) => n + o.s.split(/\s+/).filter(Boolean).length, 0),
    letters: name.reduce((n, o) => n + o.s.replace(/\s/g, "").length, 0),
  };
}

// The fit of what the saved printer prints for these settings (async: the font-C atlases load on demand).
export async function stickerFit(settings: Settings, cur: string, shopName: string, path: StickerPath): Promise<StickerFit> {
  const measure = async (st: Settings) => {
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
    if ((Number(settings[c]) || 1) <= 1) continue;
    const without = await measure({ ...settings, [c]: 1 });            // this control alone back at 1×
    if (now.offN > without.offN) controls[c] = "push";                                            // it pushes more off the sticker
    else if (now.cutN > without.cutN || now.words < without.words || now.letters < without.letters) controls[c] = "cut"; // less fits because of it
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
