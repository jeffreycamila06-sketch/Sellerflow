// Jeff 2026-11-10 (item 1, fixed): nothing saved + a size below 50×30 picked in Printer settings → the NEW sticker's
// first draft and the phone auto-save start with the QR OFF. The old "Print QR on sticker" switch (sfl_rd_sticker_qr)
// is per DEVICE and today's sticker of every account on the device reads it — it is NEVER touched. A separate device
// mark (sfl_rd_one_sticker_qr_off), read only by the new sticker, carries the "QR off"; it clears only when the seller
// turns the QR ON on the Live print pattern and saves.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { isStickerQrOn, setStickerQrOn, printSlip, DEF_SETTINGS, setStickerQrEntitled, __resetNativePrintQueue, type Settings } from "../printing";
import {
  pickOneStickerSize, markOneStickerQrOffAfterPick, oneStickerSeedQr, isOneStickerQrOffMarked, clearOneStickerQrOffMark, LS_ONE_STICKER_QR_OFF,
  seedOneSticker, autoSaveOneSticker, saveOneSticker, readSavedOneSticker, setOneStickerVisible, __resetOneStickerState, type SeedPattern,
} from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

const PP: SeedPattern = { shopName: true, shopNameSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };
type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); });
afterEach(() => { delete (window as W).SellerFlowPrinter; localStorage.clear(); __resetOneStickerState(); __resetSavedPrinter(); __resetNativePrintQueue(); });

/** RedesignApp.onPickOneSize (reachable only through Printer settings' one size list = an account with the new screen). */
function pick(w: number, h: number) {
  const r = pickOneStickerSize(w, h)!;
  return { r, qrOff: markOneStickerQrOffAfterPick(r.saved, r.size, isStickerQrOn()) };
}
/** What RedesignApp's first draft / auto-save start with. */
const seedQr = () => oneStickerSeedQr(isStickerQrOn());

describe("listed account, nothing saved, old QR ON → Custom 40×30 → 100×60", () => {
  it("the Live print pattern's first draft has the QR OFF; the old switch is still ON (not touched)", () => {
    setStickerQrOn(true);
    expect(pick(40, 30).qrOff).toBe(true); // the toast adds "QR needs a label at least 50×30 mm"
    pick(100, 60); // a bigger size never brings it back
    expect(isStickerQrOn()).toBe(true);
    expect(isOneStickerQrOffMarked()).toBe(true);
    expect(seedOneSticker(PP, "100x60mm (Standard)", seedQr(), "laptop", null).qr).toBe(false);
  });
  it("the phone auto-save after it → qr: false (old switch still ON)", () => {
    setStickerQrOn(true);
    pick(45, 40); // Custom narrower than 50 mm
    pick(100, 60);
    const s = autoSaveOneSticker({ visible: true, flagsLoaded: true, devicePath: "d520", printerSaved: true }, PP, "100x60mm (Standard)", seedQr(), "D520BT-Z")!;
    expect(s.qr).toBe(false);
    expect(readSavedOneSticker()!.qr).toBe(false);
    expect(isStickerQrOn()).toBe(true);
  });
  it("50×30 or bigger, or the old QR already off, or a new sticker already saved: no mark", () => {
    setStickerQrOn(true);
    expect(pick(50, 30).qrOff).toBe(false);
    expect(isOneStickerQrOffMarked()).toBe(false);
    setStickerQrOn(false);
    expect(pick(40, 30).qrOff).toBe(false);
    expect(isOneStickerQrOffMarked()).toBe(false);
    setStickerQrOn(true);
    saveOneSticker({ ...recommendedSettings({ w: 100, h: 60 }), qr: true });
    expect(pick(40, 30).qrOff).toBe(false); // the saved sticker has its own QR (normalizeSettings turns it off)
    expect(isOneStickerQrOffMarked()).toBe(false);
    expect(readSavedOneSticker()!.qr).toBe(false);
  });
});

describe("listed: the seller turns the QR ON on the Live print pattern and saves (≥ 50×30)", () => {
  it("→ qr: true saved, and the mark is cleared (the next first draft follows the old switch again)", () => {
    setStickerQrOn(true);
    pick(40, 30);
    pick(100, 60);
    expect(isOneStickerQrOffMarked()).toBe(true);
    // RedesignApp's Live print pattern onSave
    const next = { ...recommendedSettings({ w: 100, h: 60 }), qr: true };
    saveOneSticker(next);
    if (next.qr) clearOneStickerQrOffMark();
    expect(readSavedOneSticker()!.qr).toBe(true);
    expect(isOneStickerQrOffMarked()).toBe(false);
    expect(seedQr()).toBe(true);
  });
  it("RedesignApp: Save clears the mark only when the saved sticker has the QR on; seed + auto-save read it; the old switch is never written", () => {
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("if (next.qr) clearOneStickerQrOffMark();");
    expect(app).toContain("const newQrOff = markOneStickerQrOffAfterPick(r.saved, r.size, isStickerQrOn());");
    expect(app).toContain("seedOneSticker(pp, psSize, oneStickerSeedQr(isStickerQrOn()),");
    expect(app).toContain("pp, psSize, oneStickerSeedQr(isStickerQrOn()), savedBtPrinter()?.name ?? null);");
    expect(app).not.toMatch(/setStickerQrOn\(/); // RedesignApp never writes the old switch
    expect(fs.readFileSync("src/redesign/screens/PrinterSettings.tsx", "utf8")).not.toContain("oneSize.onPick(z.w, z.h); setStickerQr(");
  });
});

describe("shared device: listed account → Custom 40×30 → logout → unlisted account", () => {
  const AT = Date.UTC(2026, 10, 10, 6, 5);
  const buyer = { num: 12, name: "Amy Chen", handle: "amy.shop", platform: "TikTok", totalSpent: 0, totalOrders: 1,
    orders: [{ orderNum: AT, item: "A2 x2 350", qty: 1, price: 0, total: 0, time: "14:05", handle: "amy.shop", name: "Amy Chen", bNum: 12, platform: "TikTok", status: "New", date: "2026-11-10" }] } as unknown as Buyer;
  const cfg = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "100x60" } as Settings;
  async function sent(): Promise<string> {
    __resetSavedPrinter(); rememberSavedPrinter({ address: "AA", name: "D520BT-Z", transport: "ble" } as Parameters<typeof rememberSavedPrinter>[0]);
    const ok = () => vi.fn(async (_a: unknown) => ({ ok: true }));
    const b = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
    (window as W).SellerFlowPrinter = b;
    __resetNativePrintQueue();
    printSlip(buyer, "NT$", "My Shop", cfg, { at: AT });
    await vi.waitFor(() => expect(Object.values(b).some((f) => f.mock.calls.length > 0)).toBe(true), { timeout: 20000 });
    const [name, f] = Object.entries(b).find(([, x]) => x.mock.calls.length > 0)!;
    return `${name}:${JSON.stringify(f.mock.calls[0][0])}`;
  }
  it("the old QR switch is still ON and today's sticker prints byte-identical to a device without the pick", async () => {
    setStickerQrOn(true);
    setOneStickerVisible(false); // the unlisted account: today's sticker
    const before = await sent();
    setOneStickerVisible(true); // the listed account on the same device
    pick(40, 30);
    expect(localStorage.getItem(LS_ONE_STICKER_QR_OFF)).toBe("1");
    setOneStickerVisible(false); // logout → the unlisted account logs in
    expect(isStickerQrOn()).toBe(true);
    const after = await sent();
    expect(after).toBe(before);
  }, 60000);
});
