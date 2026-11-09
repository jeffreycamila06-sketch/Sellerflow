// LABEL OVERFLOW (XP-420B paper test 2026-11-09): the Vietnamese sample at 60×40 with the QR on put the
// "p" of "shop" 1 mm from the bottom edge and the printer fed an extra BLANK label. For EVERY picture path
// and every size: the image is never taller than the label, and no ink sits in the bottom 1.5 mm
// (BOTTOM_SAFE_DOTS) — measured on what the printer actually receives, decoded back to dots.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { printOneStickerTest, printSlip, setStickerQrEntitled, setStickerQrOn, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../printing";
import { recommendedSettings, screenFitNotes, BOTTOM_SAFE_DOTS, type OneStickerSettings } from "../oneSticker";
import { renderOneStickerFor, laptopPage, oneStickerInputFrom, oneStickerFonts, renderOptsFor } from "../oneStickerPrint";
import { setStickerAllScripts } from "../oneStickerScripts";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { ADMIN_LANG_SAMPLES, adminSampleBuyer, adminSampleInput } from "../adminLangSamples";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { decodeCpcl, decodeEscpos, decodeLaptopPage, decodeNiimbot, decodeSdkStream, decodeTsplBands } from "./oneSticker.decode";
import type { FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 8, 6, 5);
const SIZES: [number, number, boolean?][] = [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60], [40, 30, true]];
const lowestInk = (r: FullRaster): number => { for (let y = r.h - 1; y >= 0; y--) for (let b = 0; b < r.rowBytes; b++) if (r.buf[y * r.rowBytes + b]) return y; return -1; };
const cfgFor = (w: number, h: number): Settings => ({ ...DEF_SETTINGS, stickerSize: `${w}x${h}`, printerType: "bluetooth" });
const draftFor = (w: number, h: number, custom?: boolean): OneStickerSettings => { const d = recommendedSettings({ w, h }); if (custom) d.size = { w, h, custom: true }; return d; };

type Path = "d520" | "xp420b" | "y41bt" | "escpos" | "cpcl" | "niimbot";
const PATHS: Path[] = ["d520", "xp420b", "y41bt", "escpos", "cpcl", "niimbot"];
/** The picture the printer receives, as a raster in LABEL coordinates (+ the label's height in dots). */
async function sent(path: Path, send: () => unknown, wMm: number, hMm: number): Promise<{ r: FullRaster; labelH: number; imageH: number }> {
  __resetNativePrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (path === "xp420b") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (path === "y41bt") rememberSavedPrinter({ address: "AA", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" });
  if (path === "escpos" || path === "cpcl") rememberSavedPrinter({ address: "AA", name: "GEN-1", model: "generic", lang: path });
  if (path === "niimbot") rememberSavedPrinter({ address: "AA", name: "B21-C123", transport: "niimbot" });
  if (path === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
  (window as W).SellerFlowPrinter = br;
  await send();
  const fn = path === "d520" ? "printStickerBitmap" : path === "niimbot" ? "printStickerImage" : "printRawTspl";
  await vi.waitFor(() => expect(br[fn].mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  const arg = br[fn].mock.calls[0][0] as { data?: string; image?: { w: number; h: number; rowBytes: number; data: string; labelHeightMm: number } };
  delete (window as W).SellerFlowPrinter;
  if (path === "niimbot") {
    const img = arg.image!;
    const r = decodeNiimbot(img);
    const inset = Math.round((img.labelHeightMm * 8 - img.h) / 2); // the SDK frame sits centred inside the paper
    return { r: { ...r, h: r.h + inset }, labelH: img.labelHeightMm * 8, imageH: img.h + 2 * inset };
  }
  const bytes = Uint8Array.from(Buffer.from(arg.data!, "base64"));
  if (path === "d520") { const r = decodeSdkStream(bytes); return { r, labelH: hMm * 8, imageH: r.h }; }
  if (path === "escpos") { const r = decodeEscpos(bytes); return { r, labelH: hMm * 8, imageH: r.h }; }
  if (path === "cpcl") { const r = decodeCpcl(bytes); return { r, labelH: hMm * 8, imageH: r.h }; }
  // TSPL: SIZE must be the label; every BITMAP band must end inside it
  const txt = Buffer.from(bytes).toString("latin1");
  expect(txt).toContain(`SIZE ${wMm} mm, ${hMm} mm`);
  const bottom = Math.max(...[...txt.matchAll(/BITMAP \d+,(\d+),\d+,(\d+),0,/g)].map((m) => Number(m[1]) + Number(m[2])));
  return { r: decodeTsplBands(bytes, wMm * 8, hMm * 8 + 64), labelH: hMm * 8, imageH: bottom };
}

beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(true); });
afterAll(() => { setStickerQrEntitled(false); setStickerQrOn(false); setStickerAllScripts(false); });

describe("new sticker: never taller than the label, no ink in the bottom 1.5 mm", () => {
  it("the safety is 1.5 mm (12 dots)", () => { expect(BOTTOM_SAFE_DOTS).toBe(12); });
  it("Vietnamese 60×40 on the XP-420B (the paper bug): the last line's descender stays ≥ 12 dots above the edge", async () => {
    const vi_ = ADMIN_LANG_SAMPLES.find((s) => s.key === "vi")!;
    const { r, labelH, imageH } = await sent("xp420b", () => printOneStickerTest(draftFor(60, 40), adminSampleBuyer(vi_, AT), "NT$", "My Shop", cfgFor(60, 40)), 60, 40);
    expect(imageH).toBeLessThanOrEqual(labelH);
    expect(labelH - 1 - lowestInk(r)).toBeGreaterThanOrEqual(BOTTOM_SAFE_DOTS); // was 8 dots on main
  }, 60000);
  for (const path of PATHS) {
    it(`${path}: every admin sample × every size`, async () => {
      const bad: string[] = [];
      for (const s of ADMIN_LANG_SAMPLES) for (const [w, h, custom] of SIZES) {
        if (path === "niimbot" && w > 50) continue; // the B21 takes ≤ 50 mm labels (too wide → today's sticker)
        const { r, labelH, imageH } = await sent(path, () => printOneStickerTest(draftFor(w, h, custom), adminSampleBuyer(s, AT), "NT$", "My Shop", cfgFor(w, h)), w, h);
        const margin = labelH - 1 - lowestInk(r);
        if (imageH > labelH) bad.push(`${s.key} ${w}x${h}: image ${imageH} > label ${labelH}`);
        if (margin < BOTTOM_SAFE_DOTS) bad.push(`${s.key} ${w}x${h}: ink ${margin} dots from the bottom`);
      }
      expect(bad).toEqual([]);
    }, 300000);
  }
  it("too much text (every part 2×, small labels): the print still keeps the margin, and the screen never says \"Everything fits\"", async () => {
    const bad: string[] = [];
    for (const k of ["vi", "th", "fb", "ja"]) for (const [w, h, custom] of [[50, 30], [60, 40], [40, 30, true]] as [number, number, boolean?][]) {
      const s = ADMIN_LANG_SAMPLES.find((x) => x.key === k)!;
      const d = draftFor(w, h, custom);
      for (const p of Object.values(d.parts)) p.scale = 2;
      const { r, labelH } = await sent("xp420b", () => printOneStickerTest(d, adminSampleBuyer(s, AT), "NT$", "My Shop", cfgFor(w, h)), w, h);
      if (labelH - 1 - lowestInk(r) < BOTTOM_SAFE_DOTS) bad.push(`${k} ${w}x${h}: ink in the margin`);
      const inp = adminSampleInput(s, "My Shop", AT);
      const notes = screenFitNotes(d, inp, await oneStickerFonts(d, inp), renderOptsFor("tspl", d, { bold: true }));
      if (notes.some((n) => n.kind === "ok")) bad.push(`${k} ${w}x${h}: "Everything fits" shown`);
    }
    expect(bad).toEqual([]);
  }, 300000);
  it("top: a comment that is the FIRST line keeps its tall marks (Ễ Ỗ Ặ) inside the top margin, every size and scale", async () => {
    const bad: string[] = [];
    const s = { ...ADMIN_LANG_SAMPLES.find((x) => x.key === "vi")!, item: "Ễ Ỗ Ặ Ẫ Ẳ" };
    for (const [w, h, custom] of SIZES) for (const scale of [1, 1.5, 2]) {
      const d = draftFor(w, h, custom);
      for (const k of ["shop", "buyer", "name", "user"] as const) d.parts[k].on = false;
      d.qr = false; d.parts.comment.scale = scale;
      const r = await renderOneStickerFor("tspl", d, oneStickerInputFrom(adminSampleBuyer(s, AT), "My Shop", AT), { bold: true });
      let top = -1; for (let y = 0; y < r.h && top < 0; y++) for (let b = 0; b < r.rowBytes; b++) if (r.buf[y * r.rowBytes + b]) { top = y; break; }
      if (top < BOTTOM_SAFE_DOTS) bad.push(`${w}x${h} ×${scale}: ink starts at row ${top}`);
    }
    expect(bad).toEqual([]);
  }, 300000);
  it("laptop: the page picture is the label size and keeps the bottom 1.5 mm clear", async () => {
    const bad: string[] = [];
    for (const s of ADMIN_LANG_SAMPLES) for (const [w, h, custom] of SIZES) {
      const d = draftFor(w, h, custom);
      const b: Buyer = adminSampleBuyer(s, AT);
      const page = laptopPage(await renderOneStickerFor("laptop", d, oneStickerInputFrom(b, "My Shop", AT, s.platform === "Facebook")), d, "t");
      const { raster, pageMm, imgMm } = decodeLaptopPage(page);
      if (imgMm[1] > pageMm[1] || raster.h > h * 8) bad.push(`${s.key} ${w}x${h}: image taller than the page`);
      if (h * 8 - 1 - lowestInk(raster) < BOTTOM_SAFE_DOTS) bad.push(`${s.key} ${w}x${h}: ink in the bottom margin`);
    }
    expect(bad).toEqual([]);
  }, 300000);
});

// extra stress for today's layouts (guardian, 2026-11-09): marks UNDER letters in the last comment row
const STRESS: { key: string; name: string; handle: string; item: string }[] = [
  { key: "th-short", name: "สมใจ ใจดี", handle: "somjai", item: "ชุดสีดำ 2 ตัว ขอบคุณค่ะ" },
  { key: "th-long", name: "สมใจ ใจดี", handle: "somjai", item: "ชุดสีดำ ไซส์ M 2 ตัว ขอบคุณค่ะ ฝากด้วยนะคะ ฤดูร้อน" },
  { key: "ko-long", name: "김민지", handle: "minji", item: "검정 원피스 두 개 주세요 감사합니다 정말" },
  { key: "ar-long", name: "فاطمة أحمد", handle: "fatima", item: "فستان أسود مقاس M شكرا جزيلا يا أختي" },
];
const stressBuyer = (x: (typeof STRESS)[number]): Buyer => adminSampleBuyer({ key: x.key, label: x.key, num: 88, name: x.name, handle: x.handle, platform: "TikTok", item: x.item }, AT);
describe("today's sticker with the all-scripts language fix: the same check", () => {
  for (const path of ["d520", "xp420b", "escpos", "cpcl", "niimbot"] as Path[]) {
    it(`${path}: every admin sample + the stress comments × every size (Vietnamese / Thai marks included)`, async () => {
      setStickerAllScripts(true);
      const bad: string[] = [];
      const sizes = path === "niimbot" ? [[50, 30]] : SIZES.filter(([, , c]) => !c);
      const buyers: [string, Buyer][] = [...ADMIN_LANG_SAMPLES.map((s) => [s.key, adminSampleBuyer(s, AT)] as [string, Buyer]), ...STRESS.map((x) => [x.key, stressBuyer(x)] as [string, Buyer])];
      for (const [key, b] of buyers) for (const [w, h] of sizes) {
        const s = { key };
        const { r, labelH, imageH } = await sent(path, () => printSlip(b, "NT$", "My Shop", cfgFor(w, h), { noOneSticker: true }), w, h);
        const margin = labelH - 1 - lowestInk(r);
        if (imageH > labelH) bad.push(`${s.key} ${w}x${h}: image ${imageH} > label ${labelH}`);
        if (margin < BOTTOM_SAFE_DOTS) bad.push(`${s.key} ${w}x${h}: ink ${margin} dots from the bottom`);
      }
      setStickerAllScripts(false);
      expect(bad).toEqual([]);
    }, 300000);
  }
});
