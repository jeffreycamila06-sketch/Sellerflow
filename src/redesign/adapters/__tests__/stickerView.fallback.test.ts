// TikTok / Facebook view — the test print's FALLBACK to today's sticker (the picture could not be made,
// or the size is too wide for the printer). A Facebook sample must print there exactly what a real
// Facebook order prints in the same fallback: the name only, never "@name".
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({ failPicture: false }));
vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  return { ...m, renderOneStickerFor: async (...a: Parameters<typeof m.renderOneStickerFor>) => { if (ctl.failPicture) throw new Error("picture failed (test)"); return m.renderOneStickerFor(...a); } };
});

import { printOneStickerTest, printSlip, DEF_SETTINGS, __resetNativePrintQueue, setStickerQrEntitled, setStickerQrOn, ONE_STICKER_FALLBACK, ONE_STICKER_TOO_WIDE, BITMAP_SPP_FAILED, type Settings } from "../printing";
import { saveOneSticker, setOneStickerVisible, sampleBuyer, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { viewSampleBuyer } from "../stickerViewSample";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 8, 6, 5);
const SHOP = "Maria Ukay";
const cfg: Settings = { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" };
const draft = { ...recommendedSettings({ w: 60, h: 40 }), qr: true };
const realFacebookOrder = (handle: string): Buyer => ({
  num: 128, name: "Maria Santos", handle, platform: "Facebook", totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: AT, item: "COMMENT / PRICE", qty: 1, price: 0, total: 0, time: "14:05", handle, name: "Maria Santos", bNum: 128, platform: "Facebook", status: "New", date: "2026-11-08" }],
} as unknown as Buyer);

type Case = "d520" | "tspl" | "niimbot";
const FN: Record<Case, string> = { d520: "printStickerBitmap", tspl: "printRawTspl", niimbot: "printStickerImage" };
const reset = () => { delete (window as W).SellerFlowPrinter; __resetNativePrintQueue(); __resetSavedPrinter(); __resetOneStickerState(); try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ } ctl.failPicture = false; };
/** One print in the fallback; returns what the printer was handed (today's sticker). */
async function fallbackSend(c: Case, send: () => unknown): Promise<string> {
  __resetNativePrintQueue(); __resetSavedPrinter();
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br: Record<string, ReturnType<typeof ok>> = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  if (c === "d520") rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
  if (c === "tspl") rememberSavedPrinter({ address: "AA", name: "XP-420B", model: "generic", lang: "tspl" });
  if (c === "niimbot") rememberSavedPrinter({ address: "AA", name: "B21-C123", transport: "niimbot" }); // takes ≤ 50 mm: 60×40 is too wide
  (window as W).SellerFlowPrinter = br;
  ctl.failPicture = c !== "niimbot"; // D520 / TSPL: the picture fails; Niimbot: the size is too wide
  await send();
  await vi.waitFor(() => expect(br[FN[c]].mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  expect(Object.values(br).reduce((a, f) => a + f.mock.calls.length, 0), "one job").toBe(1);
  const handed = JSON.stringify(br[FN[c]].mock.calls[0][0]);
  delete (window as W).SellerFlowPrinter;
  return handed;
}

beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); setStickerQrOn(true); });
afterEach(() => reset());

describe("test print that falls back to today's sticker", () => {
  it.each(["d520", "tspl", "niimbot"] as Case[])("%s: the Facebook sample = a real Facebook order in the same fallback (name only)", async (c) => {
    reset();
    let code = "";
    const test = await fallbackSend(c, async () => { code = (await printOneStickerTest(draft, viewSampleBuyer("facebook", undefined, AT), "NT$", SHOP, cfg)).code; });
    expect(code).toBe(c === "niimbot" ? ONE_STICKER_TOO_WIDE : ONE_STICKER_FALLBACK); // it really was the fallback
    for (const handle of ["Maria Santos", "24681357902468135"]) {
      reset();
      saveOneSticker(draft); setOneStickerVisible(true);
      const real = await fallbackSend(c, () => printSlip(realFacebookOrder(handle), "NT$", SHOP, cfg));
      expect(real === test, `${c} ${handle}: bytes handed to the printer`).toBe(true);
    }
    // and not the TikTok sample's fallback (which keeps its @username)
    reset();
    const tiktok = await fallbackSend(c, () => printOneStickerTest(draft, sampleBuyer(undefined, AT), "NT$", SHOP, cfg));
    expect(tiktok).not.toBe(test);
  }, 120000);
  it.each(["d520", "tspl", "niimbot"] as Case[])("%s: the TikTok sample's fallback = a real TikTok order's (unchanged)", async (c) => {
    reset();
    const test = await fallbackSend(c, () => printOneStickerTest(draft, sampleBuyer(undefined, AT), "NT$", SHOP, cfg));
    reset();
    saveOneSticker(draft); setOneStickerVisible(true);
    const real = await fallbackSend(c, () => printSlip(sampleBuyer(undefined, AT), "NT$", SHOP, cfg));
    expect(real === test).toBe(true);
  }, 120000);
  // old Bluetooth: the picture is made but the send fails → the TEXT sticker (printStickerNative)
  const sppSend = async (send: () => unknown): Promise<string> => {
    __resetNativePrintQueue(); __resetSavedPrinter();
    const native = vi.fn(async (_a: unknown) => ({ ok: true }));
    const bitmap = vi.fn(async (_a: unknown) => ({ ok: false, code: BITMAP_SPP_FAILED, message: "" }));
    rememberSavedPrinter({ address: "AA", name: "D520BT-Z" });
    (window as W).SellerFlowPrinter = { printStickerNative: native, printStickerBitmap: bitmap };
    await send();
    await vi.waitFor(() => expect(native.mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
    expect(bitmap.mock.calls.length, "the picture was tried once").toBe(1);
    const handed = JSON.stringify(native.mock.calls[0][0]);
    delete (window as W).SellerFlowPrinter;
    return handed;
  };
  it("old-Bluetooth send failed → TEXT sticker: the Facebook sample = a real Facebook order (no @name); TikTok = a real TikTok order", async () => {
    reset();
    const fbTest = await sppSend(() => printOneStickerTest(draft, viewSampleBuyer("facebook", undefined, AT), "NT$", SHOP, cfg));
    expect(fbTest).not.toContain("@Maria Santos");
    for (const handle of ["Maria Santos", "24681357902468135"]) {
      reset();
      saveOneSticker(draft); setOneStickerVisible(true);
      expect(await sppSend(() => printSlip(realFacebookOrder(handle), "NT$", SHOP, cfg)) === fbTest, handle).toBe(true);
    }
    reset();
    const ttTest = await sppSend(() => printOneStickerTest(draft, sampleBuyer(undefined, AT), "NT$", SHOP, cfg));
    reset();
    saveOneSticker(draft); setOneStickerVisible(true);
    expect(await sppSend(() => printSlip(sampleBuyer(undefined, AT), "NT$", SHOP, cfg)) === ttTest).toBe(true);
    expect(ttTest).toContain("maria_live");
  }, 120000);
});
