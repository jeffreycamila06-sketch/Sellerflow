// QR rules on the NEW sticker (Jeff 2026-11-10) — measured on what EVERY printer RECEIVES:
//  2. the QR's right side is at least 2 mm (16 dots) from the LABEL's right edge (Flash Y41BT 50×40 paper test:
//     a 1 mm gap was cut when the paper sat ~1 mm to the right);
//  3. a QR prints only on a label at least 50 mm wide AND 30 mm high (50×30 allowed); smaller → no QR;
//  and "Buyer #8888 is never cut" still holds beside the QR.
// Each print goes through the real printSlip router (device saved the new sticker); the bytes are decoded back.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { printSlip, DEF_SETTINGS, setStickerQrEntitled, __resetNativePrintQueue, __resetWebPrintQueue, __webPrintIdle, type Settings } from "../printing";
import { setOneStickerVisible, saveOneSticker, __resetOneStickerState, oneStickerInputFrom, renderOptsFor, oneStickerFonts, type OneStickerPath } from "../oneStickerPrint";
import { recommendedSettings, normalizeSettings, layoutSticker, qrSizeOk, QR_RIGHT_MIN_DOTS, STANDARD_SIZES, type OneStickerSettings, type Layout } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { knownTsplJob } from "../printerModels";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { decodeSdkStream, decodeTsplBands, decodeEscpos, decodeCpcl, decodeNiimbot, decodeLaptopPage } from "./oneSticker.decode";
import type { FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 10, 6, 5);
const buyer = (handle: string): Buyer => ({ num: 8888, name: "Nguyễn Thị Ngọc", handle, platform: "TikTok", totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: AT, item: "A2 x2 350", qty: 1, price: 0, total: 0, time: "14:05", handle, name: "Nguyễn Thị Ngọc", bNum: 8888, platform: "TikTok", status: "New", date: "2026-11-10" }] } as unknown as Buyer);
const HANDLES = ["ab", "quynh.nguyen_gpqy"]; // a short handle (small QR → big module) and a long one
export const PRINTERS: { key: string; path: OneStickerPath; printer?: { name: string; model?: "generic"; lang?: "tspl" | "escpos" | "cpcl"; transport?: string }; maxW?: number }[] = [
  { key: "AIMO D520", path: "d520" },
  { key: "Xprinter XP-420B", path: "tspl", printer: { name: "XP-420B", model: "generic", lang: "tspl" } },
  { key: "Flash Y41BT", path: "tspl", printer: { name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" } },
  { key: "generic ESC/POS", path: "escpos", printer: { name: "Printer-ESC", model: "generic", lang: "escpos" } },
  { key: "generic CPCL", path: "cpcl", printer: { name: "Printer-CPCL", model: "generic", lang: "cpcl" } },
  { key: "Niimbot B3S", path: "niimbot", printer: { name: "B3S_P-1", transport: "niimbot" }, maxW: 75 },
  { key: "laptop", path: "laptop" },
];
export const QR_SIZES: [number, number][] = [[50, 30], [50, 40], [60, 40], [40, 30], [45, 35], [30, 30], [49, 40], [70, 50], [80, 60], [100, 60], [110, 80]];
const settingsFor = (w: number, h: number): OneStickerSettings => ({ ...recommendedSettings({ w, h, ...(STANDARD_SIZES.some((z) => z.w === w && z.h === h) ? {} : { custom: true }) }), qr: true });

beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); });
afterAll(() => { setStickerQrEntitled(false); __resetOneStickerState(); __resetSavedPrinter(); delete (window as W).SellerFlowPrinter; });

async function layoutFor(path: OneStickerPath, s: OneStickerSettings, b: Buyer): Promise<Layout> {
  const inp = oneStickerInputFrom(b, "My Shop", AT, false);
  const fonts = await oneStickerFonts(s, inp);
  return layoutSticker(s, inp, fonts, renderOptsFor(path, s, path === "tspl" ? knownTsplJob("Y41BT-0FC4_LE") : {}));
}
async function printed(p: (typeof PRINTERS)[number], b: Buyer, s: OneStickerSettings): Promise<FullRaster> {
  const cfg: Settings = { ...DEF_SETTINGS, printerType: p.path === "laptop" ? "lan" : "bluetooth" };
  __resetNativePrintQueue(); __resetSavedPrinter();
  if (p.printer) rememberSavedPrinter({ address: "AA:BB", ...p.printer });
  if (p.path === "laptop") {
    delete (window as W).SellerFlowPrinter; __resetWebPrintQueue();
    let frame: HTMLIFrameElement | null = null;
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
    printSlip(b, "NT$", "My Shop", cfg, { at: AT });
    await __webPrintIdle();
    await vi.waitFor(() => expect((frame as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML ?? "").toContain("data:image/bmp"));
    const html = (frame as unknown as HTMLIFrameElement).contentDocument!.documentElement.outerHTML;
    spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
    return decodeLaptopPage(html).raster;
  }
  const ok = () => vi.fn(async () => ({ ok: true }));
  const bridge: Record<string, ReturnType<typeof vi.fn>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  (window as W).SellerFlowPrinter = bridge;
  printSlip(b, "NT$", "My Shop", cfg, { at: AT });
  const fn = p.path === "d520" ? "printStickerBitmap" : p.path === "niimbot" ? "printStickerImage" : "printRawTspl";
  await vi.waitFor(() => expect(bridge[fn].mock.calls.length).toBe(1), { timeout: 20000 });
  const arg = bridge[fn].mock.calls[0][0] as { data?: string; image?: { w: number; h: number; rowBytes: number; data: string } };
  if (p.path === "niimbot") return decodeNiimbot(arg.image!);
  const bytes = Uint8Array.from(Buffer.from(arg.data!, "base64"));
  return p.path === "d520" ? decodeSdkStream(bytes) : p.path === "tspl" ? decodeTsplBands(bytes, s.size.w * 8, s.size.h * 8) : p.path === "escpos" ? decodeEscpos(bytes) : decodeCpcl(bytes);
}
const inkAt = (r: FullRaster, x: number, y: number) => (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
/** the QR's right-most inked column on the PAPER (label coordinates) and the gap to the label's right edge */
function qrRightGap(r: FullRaster, L: Layout, labelW: number): { gap: number; inkedRows: number } {
  const q = L.qr!, n = q.matrix.length, inset = Math.round((labelW - r.w) / 2); // Niimbot: the frame sits 1 mm inside the label
  let right = -1, inkedRows = 0;
  for (let y = q.y; y < q.y + n * q.mod; y++) { let any = false; for (let x = q.x; x < r.w; x++) if (inkAt(r, x, y)) { right = Math.max(right, x); any = true; } if (any) inkedRows++; }
  return { gap: labelW - (right + inset) - 1, inkedRows };
}
const numberWhole = (L: Layout): boolean => {
  const n = L.lines.filter((l) => l.part === "buyer" && l.run.text !== "Buyer");
  return n.length === 1 && n[0].x + n[0].run.width <= n[0].clip && !L.warnings.some((w) => w.part === "buyer" && w.kind === "width");
};

describe("QR: ≥ 2 mm from the right edge, only on labels ≥ 50×30, Buyer #8888 never cut — every printer, measured on the bytes", () => {
  for (const p of PRINTERS) it(p.key, async () => {
    setOneStickerVisible(true);
    const bad: string[] = [];
    for (const [w, h] of QR_SIZES) for (const handle of HANDLES) {
      if (p.maxW && w > p.maxW) continue;
      const s = settingsFor(w, h);
      saveOneSticker(s);
      const b = buyer(handle);
      const L = await layoutFor(p.path, s, b);
      const r = await printed(p, b, s);
      const tag = `${w}×${h} @${handle}`;
      if (!qrSizeOk({ w, h })) { if (L.qr) bad.push(`${tag}: a QR below 50×30`); continue; }
      if (!L.qr) { if (h > 30 || w > 50) bad.push(`${tag}: no QR on a QR size`); continue; }
      const { gap, inkedRows } = qrRightGap(r, L, w * 8);
      if (inkedRows < L.qr.matrix.length * L.qr.mod * 0.5) bad.push(`${tag}: the QR is not on the paper`);
      if (gap < QR_RIGHT_MIN_DOTS) bad.push(`${tag}: QR ${gap} dots from the right edge (< ${QR_RIGHT_MIN_DOTS})`);
      if (!numberWhole(L)) bad.push(`${tag}: #8888 cut`);
    }
    expect(bad).toEqual([]);
  }, 300000);
});

describe("QR switch rule in the saved settings", () => {
  it("below 50×30 the QR is OFF (recommended + loaded settings); at 50×30 and above it follows the setting", () => {
    for (const [w, h] of [[40, 30], [45, 35], [30, 30], [49, 40], [50, 30], [50, 40], [60, 40]] as [number, number][]) {
      const want = w >= 50 && h >= 30;
      expect(recommendedSettings({ w, h }).qr, `${w}x${h}`).toBe(want);
      expect(normalizeSettings({ size: { w, h, custom: true }, qr: true }).qr, `${w}x${h}`).toBe(want);
      expect(normalizeSettings({ size: { w, h, custom: true }, qr: false }).qr).toBe(false);
    }
  });
});
