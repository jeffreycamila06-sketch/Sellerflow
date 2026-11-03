// LIVE print pattern — "will it fit?" warning. Nov 3 (item 8): it measures the layout that WILL PRINT for
// the saved printer (fixed-cell / font-C compact v1 / compact v2 / the Niimbot frame / the laptop's image page)
// with the same payload the print builds, against TWO fixed samples: a Latin buyer (a 20-letter three-word
// name, a 27-character six-word comment) and a Chinese buyer (王小明 / 我要黑色 — round 3, item 5). The buyer
// number is the worst case: 12345, or the highest buyer number of the current session when the screen knows it
// (round 3, item 3). Display only — nothing printed.
import type { NativeStickerPayload, Settings, StickerPath } from "./printing";
import { buildNativeStickerPayload, imageStickerPayload, imagePathAtlases, stickerCompactV2Effective, NIIMBOT_CANVAS, NIIMBOT_LABEL } from "./printing";
import type { Buyer } from "../../lib/orderTypes";
import { stickerDrawOps, stickerQrPlacement, rightmostOpEdge, STICKER_LAYOUTS, isPropCompactSize, propLayoutLines, propLayoutLinesV2, propStackTops, COMPACT_V2_GAP, type DrawOp, type RasterPayload, type RasterAtlases, type PropFont } from "./stickerRaster";

export const FIT_SAMPLE_NAME = "Cristine Ramos Cabanas";        // 20 letters, 3 words
export const FIT_SAMPLE_COMMENT = "Mine black size XL 2pcs 350";   // 27 characters, 6 words
export const FIT_SAMPLE_HANDLE = "cristineramos";
export const FIT_SAMPLE_NUM = 12345;                               // the worst-case buyer number (5 digits)
export const FIT_SAMPLE_CJK_NAME = "王小明";
export const FIT_SAMPLE_CJK_COMMENT = "我要黑色";

// Item 7 (round 3): the laptop prints the same bitmap ("browser" is a StickerPath) — one measure for every path.
export type FitPath = StickerPath;
// The size controls of the LIVE print pattern that can push or cut (item 14): each maps to its Settings scale.
export type FitControl = "printStoreScale" | "printBuyerNumberScale" | "printBuyerNameScale" | "printUsernameScale" | "printCommentScale";
export const FIT_CONTROLS: FitControl[] = ["printStoreScale", "printBuyerNumberScale", "printBuyerNameScale", "printUsernameScale", "printCommentScale"];
export type FitIssue = "push" | "cut" | "limit";
export interface StickerFit {
  overflow: boolean;                 // a) something ends past the bottom or right edge (or into the QR column)
  commentScale: number | null;       // b) always null since Nov 3 (item 4): the comment prints at the CHOSEN size
  cut: boolean;                      // c) fewer comment words / name letters than at all-1× scales (or a "…" cut on the compact layouts)
  // item 14: per control (only the ones above 1×) — "push" = because of this control a line runs off the sticker;
  // "cut" = because of it less of the name / comment fits; "limit" (item 2, round 2) = the buyer number prints at
  // the largest size that fits whole (below the chosen level). Round 3 (item 3): "limit" only when the cap is the
  // reason — a number that pushes lines off says "push". Shown in red next to that control.
  controls: Partial<Record<FitControl, FitIssue>>;
}
export interface FitSample { name: string; comment: string; handle: string; num: number }
export const sampleBuyer = (s: Partial<FitSample> = {}): Buyer => {
  const name = s.name ?? FIT_SAMPLE_NAME, comment = s.comment ?? FIT_SAMPLE_COMMENT, handle = s.handle ?? FIT_SAMPLE_HANDLE, num = s.num ?? FIT_SAMPLE_NUM;
  return { handle, name, platform: "TikTok", num, totalSpent: 350, totalOrders: 1,
    orders: [{ orderNum: 1, item: comment, qty: 1, price: 350, total: 350, time: "14:05", handle, name, bNum: num, platform: "TikTok", status: "New", date: "2026-09-30" }] } as Buyer;
};
const SAMPLES = (num: number): FitSample[] => [
  { name: FIT_SAMPLE_NAME, comment: FIT_SAMPLE_COMMENT, handle: FIT_SAMPLE_HANDLE, num },
  { name: FIT_SAMPLE_CJK_NAME, comment: FIT_SAMPLE_CJK_COMMENT, handle: FIT_SAMPLE_HANDLE, num },
];

interface Measure { overflow: boolean; cut: boolean; words: number; letters: number; commentXm: number | null; offN: number; cutN: number; numScale: number }
const units = (s: string) => (/[㐀-鿿]/.test(s) ? [...s.replace(/[\s…]/g, "")].length : s.split(/\s+/).filter(Boolean).length); // words, or ideographs
// PURE: the measure of the layout that prints for (path, payload, atlases). Exported for the tests.
export function measurePrint(path: StickerPath, np: NativeStickerPayload, img: RasterPayload, atlases: RasterAtlases, sample: Pick<FitSample, "name" | "comment"> = { name: FIT_SAMPLE_NAME, comment: FIT_SAMPLE_COMMENT }): Measure {
  const w = path === "niimbot" ? NIIMBOT_LABEL.w : np.labelWidthMm, h = path === "niimbot" ? NIIMBOT_LABEL.h : np.labelHeightMm;
  const compact = atlases.proportional && isPropCompactSize(w, h);
  const nameKey = [...sample.name].slice(0, 2).join(""), commentKey = [...sample.comment].slice(0, 2).join("");
  const numText = String(img.buyer?.num ?? img.buyer?.bNum ?? 0);
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
    const comment = lines.find((l) => l.line.text.startsWith(commentKey));
    const cutN = lines.filter((l) => l.line.cut).length;
    const numLine = lines.find((l) => l.line.text === numText);
    return { overflow: offN > 0, cut: cutN > 0, words: comment ? units(comment.line.text) : 0, letters: lines.filter((l) => l.line.text.startsWith(nameKey)).reduce((n, l) => n + [...l.line.text.replace(/[\s…]/g, "")].length, 0), commentXm: null, offN, cutN, numScale: numLine?.scale ?? 1 };
  }
  const cfg = STICKER_LAYOUTS[`${w}x${h}`] ?? STICKER_LAYOUTS["100x60"];
  const r = stickerDrawOps(img, w, h, "extended", stickerQrPlacement(img, cfg.wDots, h * 8, h));
  const sep = r.ops.find((o) => o.k === "bar" && o.x === 16);
  const sepY = sep ? sep.y : Infinity;
  const numOpAny = r.ops.find((o) => o.k === "txt" && o.s === numText);
  const buyerY = numOpAny ? numOpAny.y : -1;
  const text = r.ops.filter((o): o is Exclude<DrawOp, { k: "bar" }> => o.k !== "bar");
  const comment = text.filter((o) => o.y > sepY && !(o.k === "txt" && o.font === "2"));
  const name = text.filter((o) => (o.k === "cjk" || o.font === "4") && o.y < sepY && o.y > 48 && o.y !== buyerY);
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
    words: comment.reduce((n, o) => n + units(o.s), 0),
    letters: name.reduce((n, o) => n + [...o.s.replace(/[\s…]/g, "")].length, 0),
  };
}

const RANK: Record<FitIssue, number> = { push: 3, limit: 2, cut: 1 };
// The fit of what the saved printer prints for these settings (async: the font-C atlases load on demand).
// opts.maxBuyerNum = the highest buyer number of the current session (the screen passes it when it knows one).
export async function stickerFit(settings: Settings, cur: string, shopName: string, path: FitPath, opts: { maxBuyerNum?: number } = {}): Promise<StickerFit> {
  const num = opts.maxBuyerNum && opts.maxBuyerNum > 0 ? Math.floor(opts.maxBuyerNum) : FIT_SAMPLE_NUM;
  const measure = async (st: Settings, sample: FitSample) => {
    const np0 = buildNativeStickerPayload(sampleBuyer(sample), cur, shopName, st);
    const np = path === "niimbot" ? { ...np0, labelWidthMm: NIIMBOT_LABEL.w, labelHeightMm: NIIMBOT_LABEL.h } : np0;
    const img = imageStickerPayload(np, "TikTok");
    const atlases = path === "aimo" && !(stickerCompactV2Effective() && isPropCompactSize(np.labelWidthMm, np.labelHeightMm)) ? await aimoAtlases(np) : await imagePathAtlases(np, img);
    return measurePrint(path, np, img, atlases, sample);
  };
  const ones: Settings = { ...settings, printStoreScale: 1, printBuyerNumberScale: 1, printBuyerNameScale: 1, printUsernameScale: 1, printOrderScale: 1, printCommentScale: 1, printTotalScale: 1 };
  const out: StickerFit = { overflow: false, commentScale: null, cut: false, controls: {} };
  for (const sample of SAMPLES(num)) {
    const now = await measure(settings, sample);
    const base = await measure(ones, sample);
    for (const c of FIT_CONTROLS) {
      const wanted = Number(settings[c]) || 1;
      if (wanted <= 1) continue;
      const without = await measure({ ...settings, [c]: 1 }, sample);            // this control alone back at 1×
      const alone = await measure({ ...ones, [c]: settings[c] }, sample);         // item 6: ONLY this control raised (several 3× together each get their line)
      let issue: FitIssue | null = null;
      if (now.offN > without.offN || alone.offN > base.offN) issue = "push";                  // it pushes more off the sticker
      else if (c === "printBuyerNumberScale" && now.numScale < wanted) issue = "limit";       // item 2: printed whole at the largest size that fits
      else if (now.cutN > without.cutN || now.words < without.words || now.letters < without.letters || alone.cutN > base.cutN || alone.words < base.words || alone.letters < base.letters) issue = "cut"; // less fits because of it
      if (issue && (!out.controls[c] || RANK[issue] > RANK[out.controls[c]!])) out.controls[c] = issue;
    }
    out.overflow ||= now.overflow;
    out.cut ||= now.cut || now.words < base.words || now.letters < base.letters;
  }
  return out;
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
