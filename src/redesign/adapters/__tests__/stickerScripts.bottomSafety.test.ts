// TODAY'S STICKER with the ALL-SCRIPTS letters (Jeff 2026-11-09, audit F2): the bottom 1.5 mm is kept
// clear by MOVING the picture up (up to 4 dots from the top) — never by erasing ink (7273e026 erased the
// bottoms of p / g / ụ / Thai marks at 70×50 / 80×50). If the lift is not enough, the comment takes ONE
// LINE FEWER with "…". English / Chinese and the switch OFF are untouched (byte-identical, see the capture).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFileSync } from "node:fs";
import {
  withScriptsBottomSafety, bottomSafetyPlan, withSyntheticCjk, stickerDrawOps, wrapWords, __setScriptsBottomSafetyOff, __scriptsCommentLessNow, __withScriptsCommentLess,
  SCRIPTS_BOTTOM_SAFE_DOTS, SCRIPTS_TOP_KEEP_DOTS, stickerQrPlacement, type FullRaster, type RasterPayload, type DrawOp,
} from "../stickerRaster";
import { printSlip, setStickerQrEntitled, setStickerQrOn, setStickerLayoutV2Allowed, setStickerCompactV2, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../printing";
import { setStickerAllScripts } from "../oneStickerScripts";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { ADMIN_LANG_SAMPLES, adminSampleBuyer } from "../adminLangSamples";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { decodeEscpos, decodeSdkStream, decodeTsplBands, decodeNiimbot } from "./oneSticker.decode";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 8, 6, 5);
const raster = (h: number, inkRows: number[], w = 64): FullRaster => {
  const rowBytes = w >> 3, buf = new Uint8Array(rowBytes * h);
  for (const y of inkRows) buf[y * rowBytes] = 0x81;
  return { buf, w, h, rowBytes };
};
const inkRows = (r: FullRaster) => { const out: number[] = []; for (let y = 0; y < r.h; y++) for (let b = 0; b < r.rowBytes; b++) if (r.buf[y * r.rowBytes + b]) { out.push(y); break; } return out; };
const SYN = new Set([0x0e01]);

describe("the decision (pure)", () => {
  it("need / room: the margin left to clear and the free rows above the 4-dot top keep", () => {
    expect(SCRIPTS_BOTTOM_SAFE_DOTS).toBe(12);
    expect(SCRIPTS_TOP_KEEP_DOTS).toBe(4);
    expect(bottomSafetyPlan(raster(100, [12, 94]))).toEqual({ need: 7, room: 8 });
  });
  it("enough room: the picture moves up, every row of ink kept (7273e026 kept 8 dots on top and ERASED the rest)", () => {
    const r = withSyntheticCjk(SYN, () => withScriptsBottomSafety(() => raster(100, [12, 50, 94]), () => 0));
    expect(inkRows(r)).toEqual([5, 43, 87]); // was [8, 46] — the row at 94 → 90 erased
  });
  it("not enough room: drawn again with ONE COMMENT LINE FEWER, that picture moved up", () => {
    const draw = vi.fn(() => (__scriptsCommentLessNow() ? raster(100, [10, 80]) : raster(100, [6, 99])));
    const r = withSyntheticCjk(SYN, () => withScriptsBottomSafety(draw, () => 0));
    expect(draw).toHaveBeenCalledTimes(2);
    expect(inkRows(r)).toEqual([10, 80]); // that picture is already clear of the margin → not moved
    expect(__scriptsCommentLessNow()).toBe(0); // restored
  });
  it("neither is enough (the lowest line is not the comment): the full lift, NOTHING erased (listed in PRINTING_MAP §6)", () => {
    const draw = () => raster(100, [9, 40, 99]);
    const r = withSyntheticCjk(SYN, () => withScriptsBottomSafety(draw, () => 0));
    expect(inkRows(r)).toEqual([4, 35, 94]);
  });
  it("outside the all-scripts letters: one draw, untouched", () => {
    const draw = vi.fn(() => raster(100, [2, 99]));
    expect(inkRows(withScriptsBottomSafety(draw, () => 0))).toEqual([2, 99]);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

describe("one comment line fewer: every wrapping layout honours it, the last kept line ends with \"…\"", () => {
  const base = (item: string, extra: Record<string, unknown> = {}): RasterPayload => ({
    storeName: "My Shop", sessionDate: "11/08/2026", currency: "NT$",
    buyer: { num: 12, name: "Amy", handle: "amy_live", totalSpent: 0, orders: [{ time: "14:05", item }] },
    settings: { printStoreName: true, printBuyerNumber: true, printBuyerUsername: true, printOrderItems: true, printTotal: false, printStoreScale: 1, printBuyerNumberScale: 1, printBuyerNameScale: 1, printUsernameScale: 1, printOrderScale: 1, printCommentScale: 1, printTotalScale: 1, ...extra },
  });
  const commentLines = (ops: DrawOp[], fromY: number) => [...new Set(ops.filter((o) => o.k !== "bar" && o.y >= fromY && o.x < 200).map((o) => o.y))];
  it("layout v2 (full-width comment)", () => {
    const p = base("ako si jeff pa reserve po yung black na dress size M thank you po salamat", { printCommentFullWidth: true });
    const a = stickerDrawOps(p, 80, 60).ops, b = __withScriptsCommentLess(() => stickerDrawOps(p, 80, 60).ops);
    const la = commentLines(a, 120), lb = commentLines(b, 120);
    expect(la.length).toBeGreaterThan(1);
    expect(lb.length).toBe(la.length - 1);
    expect(b.filter((o) => o.k === "txt" && o.y === Math.max(...lb)).map((o) => (o.k === "txt" ? o.s : "")).join("")).toMatch(/…$/);
  });
  it("the QR keep-out wrap", () => {
    const p = base("pa reserve po yung black dress size M salamat po ate ganda", { printStickerQr: true });
    const qr = stickerQrPlacement(p, 560, 400, 50);
    const a = stickerDrawOps(p, 70, 50, "extended", qr).ops, b = __withScriptsCommentLess(() => stickerDrawOps(p, 70, 50, "extended", qr).ops);
    const ta = a.filter((o) => o.k === "txt" && o.font === "4" && o.xm === 2 && o.x > 60), tb = b.filter((o) => o.k === "txt" && o.font === "4" && o.xm === 2 && o.x > 60);
    expect(ta.length).toBeGreaterThan(1);
    expect(tb.length).toBe(ta.length - 1);
    const lastOp = tb[tb.length - 1];
    expect(lastOp.k === "txt" ? lastOp.s : "").toMatch(/…$/);
    expect(wrapWords("aa bb cc", 2, 2)).toEqual(["aa", "b…"]); // the "…" helper it uses
  });
});

const STRESS: { key: string; name: string; handle: string; item: string }[] = [
  { key: "th-long", name: "สมใจ ใจดี", handle: "somjai", item: "ชุดสีดำ ไซส์ M 2 ตัว ขอบคุณค่ะ ฝากด้วยนะคะ ฤดูร้อน" },
  { key: "vi-gp", name: "Nguyễn Thị Ngọc", handle: "ngoc", item: "đầm đen size M giúp shop gói kỹ nhé ụ ợ ỵ" },
  { key: "ko-long", name: "김민지", handle: "minji", item: "검정 원피스 두 개 주세요 감사합니다 정말" },
];
type Path = "d520" | "xp420b" | "escpos" | "niimbot";
async function printed(path: Path, b: Buyer, cfg: Settings, w: number, h: number): Promise<FullRaster> {
  __resetNativePrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "xp420b") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (path === "escpos") rememberSavedPrinter({ address: "AA", name: "GEN-1", model: "generic", lang: "escpos" });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B21-C123", transport: "niimbot" });
  if (path === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
  (window as W).SellerFlowPrinter = br;
  printSlip(b, "NT$", "My Shop", cfg, { noOneSticker: true });
  const fn = path === "d520" ? "printStickerBitmap" : path === "niimbot" ? "printStickerImage" : "printRawTspl";
  await vi.waitFor(() => expect(br[fn].mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  delete (window as W).SellerFlowPrinter;
  const arg = br[fn].mock.calls[0][0] as { data?: string; image?: { w: number; h: number; rowBytes: number; data: string; labelHeightMm: number } };
  if (path === "niimbot") return decodeNiimbot(arg.image!);
  const bytes = Uint8Array.from(Buffer.from(arg.data!, "base64"));
  return path === "d520" ? decodeSdkStream(bytes) : path === "escpos" ? decodeEscpos(bytes) : decodeTsplBands(bytes, w * 8, h * 8);
}
const sameShifted = (raw: FullRaster, safe: FullRaster): number | null => {
  const a = inkRows(raw), b = inkRows(safe);
  if (!a.length) return b.length ? null : 0;
  const k = a[0] - b[0];
  if (k < 0) return null;
  for (let y = 0; y < safe.h; y++) {
    const src = y + k;
    for (let x = 0; x < safe.rowBytes; x++) if (safe.buf[y * safe.rowBytes + x] !== (src < raw.h ? raw.buf[src * raw.rowBytes + x] : 0)) return null;
  }
  return k;
};

beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterAll(() => { setStickerAllScripts(false); __setScriptsBottomSafetyOff(false); setStickerQrEntitled(false); setStickerQrOn(false); setStickerLayoutV2Allowed(false); setStickerCompactV2(false); });

describe("today's sticker, all-scripts letters: through the real print paths", () => {
  for (const path of ["d520", "xp420b", "escpos", "niimbot"] as Path[]) {
    it(`${path}: the picture is today's picture MOVED UP (never a row of ink erased), ≥ ${SCRIPTS_TOP_KEEP_DOTS} dots on top, 12 dots clear at the bottom — except the listed name-at-2× family`, async () => {
      const bad: string[] = [], listed: string[] = [];
      const buyers: [string, Buyer][] = [...ADMIN_LANG_SAMPLES.map((s) => [s.key, adminSampleBuyer(s, AT)] as [string, Buyer]), ...STRESS.map((x) => [x.key, adminSampleBuyer({ key: x.key, label: x.key, num: 88, name: x.name, handle: x.handle, platform: "TikTok", item: x.item }, AT)] as [string, Buyer])];
      const sizes = path === "niimbot" ? [[50, 30]] : [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60]];
      for (const v2 of [false, true]) for (const qr of [false, true]) for (const ns of [1, 2]) {
        setStickerLayoutV2Allowed(v2); setStickerQrEntitled(qr); setStickerQrOn(qr);
        for (const [key, b] of buyers) for (const [w, h] of sizes) {
          const cfg: Settings = { ...DEF_SETTINGS, stickerSize: `${w}x${h}`, printerType: "bluetooth", printBuyerNameScale: ns, printUsernameScale: ns, printBuyerNumberScale: ns };
          setStickerAllScripts(true);
          __setScriptsBottomSafetyOff(true);
          const raw = await printed(path, b, cfg, w, h);
          __setScriptsBottomSafetyOff(false);
          const safe = await printed(path, b, cfg, w, h);
          const tag = `${key} ${w}x${h} v2=${v2} qr=${qr} size=${ns}`;
          const k = sameShifted(raw, safe);
          const low = inkRows(safe).pop() ?? -1, top = inkRows(safe)[0] ?? 0;
          // in this whole matrix the 4-dot lift is always enough (or, for the listed family, nothing is):
          // the printed picture is EXACTLY today's picture moved up — so not one row of ink is erased
          if (k === null) bad.push(`${tag}: not the same picture moved up (ink erased or redrawn)`);
          if (top < Math.min(SCRIPTS_TOP_KEEP_DOTS, inkRows(raw)[0] ?? 0)) bad.push(`${tag}: ink starts at row ${top}`);
          if (path === "niimbot") continue; // the SDK frame sits 1 mm inside the paper (checked in labelFit)
          if (safe.h - 1 - low < SCRIPTS_BOTTOM_SAFE_DOTS) (ns === 2 ? listed : bad).push(`${tag}: ${safe.h - 1 - low} dots from the bottom`);
        }
      }
      setStickerAllScripts(false); setStickerLayoutV2Allowed(false); setStickerQrEntitled(false); setStickerQrOn(false);
      expect(bad).toEqual([]);
      // the listed family (PRINTING_MAP §6): name / buyer / @username at 2× on 60×40 / 70×50 / 80×50 — a tall
      // name (Chinese: today's layout as on main, switch OFF the same; the synthetic letters likewise) pushes
      // the @username to the edge. Not the comment, so neither rule applies; never cut — Jeff decides.
      for (const l of listed) expect(l, l).toMatch(/^\S+ (60x40|70x50|80x50) .*size=2/);
      if (process.env.LISTED_OUT) appendFileSync(process.env.LISTED_OUT, listed.map((l) => `${path} ${l}`).join("\n") + "\n");
    }, 600000);
  }
});
