// PIXEL TEST — laptop picture == phone picture == exact preview, for every size × sample × path.
// Each print goes through the REAL printSlip router (switch on, this device saved the new pattern);
// what the printer RECEIVES is decoded back to pixels and compared with the preview picture that
// the Live print pattern screen draws for that path. Any difference = fail.
// Set PIXEL_TABLE_OUT=<file.md> to also write the table (docs/design/one-sticker/pixel-table.md).
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { printSlip, DEF_SETTINGS, setStickerQrEntitled, __resetNativePrintQueue, __resetWebPrintQueue, __webPrintIdle, type Settings } from "../printing";
import { setOneStickerVisible, saveOneSticker, __resetOneStickerState, oneStickerInputFrom, renderOptsFor, oneStickerFonts, type OneStickerPath } from "../oneStickerPrint";
import { recommendedSettings, renderOneSticker, type OneStickerSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { knownTsplJob } from "../printerModels";
import { fbNameOnly, printableBuyer } from "../fbName";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { decodeSdkStream, decodeTsplBands, decodeEscpos, decodeCpcl, decodeNiimbot, decodeLaptopPage, sameRaster } from "./oneSticker.decode";
import type { FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

import { AT, SAMPLES, SIZES } from "./oneSticker.samples";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const PATHS: { path: OneStickerPath; printer?: { name: string; model?: "generic"; lang?: "tspl" | "escpos" | "cpcl"; transport?: string }; maxW?: number }[] = [
  { path: "d520" },
  { path: "tspl", printer: { name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" } },
  { path: "escpos", printer: { name: "Printer-ESC", model: "generic", lang: "escpos" } },
  { path: "cpcl", printer: { name: "Printer-CPCL", model: "generic", lang: "cpcl" } },
  { path: "niimbot", printer: { name: "B3S_P-1", transport: "niimbot" }, maxW: 75 },
  { path: "laptop" },
];

const rows: string[] = [];
beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); });
afterAll(() => {
  setStickerQrEntitled(false); __resetOneStickerState(); __resetSavedPrinter(); delete (window as W).SellerFlowPrinter;
  const out = process.env.PIXEL_TABLE_OUT;
  if (out) fs.writeFileSync(out, ["# Pixel test — paper picture vs exact preview", "", "Every cell: what the printer RECEIVES (decoded) compared pixel by pixel with the preview of the Live print pattern screen for that path. ✅ = identical.", "", "| size | sample | AIMO D520 | Y41BT/XP-420B (TSPL) | ESC/POS | CPCL | Niimbot | laptop |", "|---|---|---|---|---|---|---|---|", ...rows, ""].join("\n"));
});

async function preview(path: OneStickerPath, s: OneStickerSettings, buyer: Buyer, shop: string): Promise<FullRaster> {
  const pb = printableBuyer(buyer);
  const inp = oneStickerInputFrom(pb, shop, AT, fbNameOnly(pb.platform, pb.name));
  const fonts = await oneStickerFonts(s, inp);
  const job = path === "tspl" ? knownTsplJob("Y41BT-0FC4_LE") : {};
  return renderOneSticker(s, inp, fonts, renderOptsFor(path, s, job));
}
async function printed(path: OneStickerPath, s: OneStickerSettings, buyer: Buyer, shop: string): Promise<FullRaster> {
  const cfg: Settings = { ...DEF_SETTINGS, printerType: path === "laptop" ? "lan" : "bluetooth" };
  __resetNativePrintQueue(); __resetSavedPrinter();
  const p = PATHS.find((x) => x.path === path)!;
  if (p.printer) rememberSavedPrinter({ address: "AA:BB", ...p.printer });
  if (path === "laptop") {
    delete (window as W).SellerFlowPrinter; __resetWebPrintQueue();
    let frame: HTMLIFrameElement | null = null;
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "iframe") frame = el as HTMLIFrameElement; return el; });
    const r = printSlip(buyer, "NT$", shop, cfg, { at: AT });
    expect(r.via).toBe("browser");
    await __webPrintIdle();
    await vi.waitFor(() => expect((frame as HTMLIFrameElement | null)?.contentDocument?.documentElement.outerHTML ?? "").toContain("data:image/bmp"));
    const html = (frame as unknown as HTMLIFrameElement).contentDocument!.documentElement.outerHTML;
    spy.mockRestore(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove());
    const page = decodeLaptopPage(html);
    expect(page.pageMm).toEqual([s.size.w, s.size.h]);
    expect(page.imgMm).toEqual([s.size.w, s.size.h]);
    return page.raster;
  }
  const ok = () => vi.fn(async () => ({ ok: true }));
  const bridge: Record<string, ReturnType<typeof vi.fn>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  (window as W).SellerFlowPrinter = bridge;
  printSlip(buyer, "NT$", shop, cfg, { at: AT });
  const fn = path === "d520" ? "printStickerBitmap" : path === "niimbot" ? "printStickerImage" : "printRawTspl";
  await vi.waitFor(() => expect(bridge[fn].mock.calls.length).toBe(1), { timeout: 20000 });
  expect(bridge.printStickerNative).not.toHaveBeenCalled(); // never the TEXT sticker on an image path
  const arg = bridge[fn].mock.calls[0][0] as { data?: string; image?: { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number } };
  if (path === "niimbot") { expect([arg.image!.labelWidthMm, arg.image!.labelHeightMm]).toEqual([s.size.w, s.size.h]); return decodeNiimbot(arg.image!); }
  const bytes = Uint8Array.from(Buffer.from(arg.data!, "base64"));
  if (path === "d520") return decodeSdkStream(bytes);
  if (path === "tspl") {
    const head = Buffer.from(bytes.subarray(0, 120)).toString("latin1");
    expect(head).toContain(`SIZE ${s.size.w} mm, ${s.size.h} mm`);
    expect(head).toContain("DENSITY 15"); expect(head).toContain("SPEED 4"); // the approved Y41BT / XP-420B job
    return decodeTsplBands(bytes, s.size.w * 8, s.size.h * 8);
  }
  return path === "escpos" ? decodeEscpos(bytes) : decodeCpcl(bytes);
}

describe("pixel test — paper == preview on every path (switch on, device saved)", () => {
  for (const [w, h] of SIZES) {
    it(`${w}×${h}`, async () => {
      setOneStickerVisible(true);
      for (const smp of SAMPLES) {
        const s = { ...recommendedSettings({ w, h, ...([w, h].join("x") === "40x30" || [w, h].join("x") === "75x45" ? { custom: true } : {}) }), qr: smp.qr };
        saveOneSticker(s);
        const cells: string[] = [];
        for (const p of PATHS) {
          if (p.maxW && w > p.maxW) { cells.push("n/a (wider than the printer)"); continue; }
          const want = await preview(p.path, s, smp.buyer, smp.shop);
          const got = await printed(p.path, s, smp.buyer, smp.shop);
          const same = sameRaster(want, got);
          expect(same, `${w}x${h} ${smp.key} ${p.path}`).toBe(true);
          cells.push(same ? "✅" : "❌");
        }
        rows.push(`| ${w}×${h} | ${smp.key} | ${cells.join(" | ")} |`);
      }
    }, 120000);
  }
});
