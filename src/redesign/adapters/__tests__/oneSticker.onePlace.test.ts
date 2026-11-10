// ONE PLACE FOR THE STICKER SIZE (Jeff 2026-11-10) — the glue + the real prints.
// The size is picked ONLY in Printer settings (pickOneStickerSize); the saved new sticker follows, and every
// picture path prints at that size: AIMO D520, Xprinter XP-420B / Flash Y41BT (TSPL), Niimbot, laptop. One list
// for every new-sticker device (none wider than the printer), Custom 30–110 mm, QR off below 50×30, a saved size
// is never changed by itself, the laptop's pick before its Save is remembered, the auto-save uses a fitting pick.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { printSlip, DEF_SETTINGS, setStickerQrEntitled, __resetNativePrintQueue, type Settings } from "../printing";
import {
  setOneStickerVisible, readSavedOneSticker, saveOneSticker, oneStickerActive, pickOneStickerSize, oneStickerSizeNow, oneStickerSizesFor, readOneStickerSizeChoice,
  clearOneStickerSizeChoice, autoSaveOneSticker, seedOneSticker, renderOneStickerFor, laptopPage, oneStickerInputFrom, LS_ONE_STICKER_SIZE, __resetOneStickerState, type SeedPattern,
} from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 10, 6, 5);
const buyer = { num: 12, name: "Amy Chen", handle: "amy.shop", platform: "TikTok", totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: AT, item: "A2 x2 350", qty: 1, price: 0, total: 0, time: "14:05", handle: "amy.shop", name: "Amy Chen", bNum: 12, platform: "TikTok", status: "New", date: "2026-11-10" }] } as unknown as Buyer;
const PP: SeedPattern = { shopName: true, shopNameSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };
type P = { key: string; printer: { address: string; name: string; model?: "generic"; lang?: "tspl"; transport?: string }; fn: string; pick: [number, number] };
const PATHS: P[] = [
  { key: "AIMO D520", printer: { address: "AA", name: "D520BT-Z", transport: "ble" }, fn: "printStickerBitmap", pick: [70, 50] },
  { key: "Xprinter XP-420B (TSPL)", printer: { address: "AA", name: "XP-420B", model: "generic", lang: "tspl" }, fn: "printRawTspl", pick: [80, 50] },
  { key: "Flash Y41BT (TSPL)", printer: { address: "AA", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" }, fn: "printRawTspl", pick: [50, 30] },
  { key: "Niimbot B3S", printer: { address: "AA", name: "B3S-P1", transport: "niimbot" }, fn: "printStickerImage", pick: [70, 50] },
];
const cfg = (): Settings => ({ ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "100x60" } as Settings);
function phone(p: P): Record<string, ReturnType<typeof vi.fn>> {
  __resetSavedPrinter(); rememberSavedPrinter(p.printer as Parameters<typeof rememberSavedPrinter>[0]);
  const ok = () => vi.fn(async (_a: unknown) => ({ ok: true }));
  const b = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  (window as W).SellerFlowPrinter = b; return b;
}
async function sent(b: Record<string, ReturnType<typeof vi.fn>>): Promise<string> {
  __resetNativePrintQueue();
  for (const f of Object.values(b)) f.mockClear();
  printSlip(buyer, "NT$", "My Shop", cfg(), { at: AT });
  await vi.waitFor(() => expect(Object.values(b).some((f) => f.mock.calls.length > 0)).toBe(true), { timeout: 20000 });
  const [name, f] = Object.entries(b).find(([, x]) => x.mock.calls.length > 0)!;
  return `${name}:${JSON.stringify(f.mock.calls[0][0])}`;
}

beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); });
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetOneStickerState(); __resetSavedPrinter(); __resetNativePrintQueue(); localStorage.clear(); });

describe("a size picked in Printer settings → the print follows (real print functions)", () => {
  for (const p of PATHS) it(p.key, async () => {
    const b = phone(p);
    setOneStickerVisible(true);
    const draft = recommendedSettings({ w: 50, h: 30 });
    saveOneSticker(draft);
    const before = await sent(b);
    const [w, h] = p.pick;
    const r = pickOneStickerSize(w, h)!;
    expect(r.saved!.size).toEqual({ w, h });
    expect(oneStickerActive()!.size).toEqual({ w, h }); // what every print reads
    const after = await sent(b);
    expect(after.startsWith(`${p.fn}:`), after.slice(0, 40)).toBe(true);
    if (w !== 50) expect(after).not.toBe(before);
    // = exactly what a sticker saved at that size prints (only the size changed)
    localStorage.clear(); __resetOneStickerState(); setOneStickerVisible(true);
    saveOneSticker({ ...draft, size: { w, h } });
    expect(await sent(b)).toBe(after);
  }, 120000);
  it("Niimbot: a Custom size from Printer settings prints at that size (the SDK label size)", async () => {
    const b = phone({ key: "B1", printer: { address: "AA", name: "B1-H1", transport: "niimbot" }, fn: "printStickerImage", pick: [40, 30] });
    setOneStickerVisible(true);
    saveOneSticker(recommendedSettings({ w: 50, h: 30 }));
    pickOneStickerSize(40, 30);
    const out = await sent(b);
    expect(out).toContain('"labelWidthMm":40');
    expect(out).toContain('"labelHeightMm":30');
  }, 120000);
  it("laptop: the page is the picked size", async () => {
    setOneStickerVisible(true);
    saveOneSticker(recommendedSettings({ w: 100, h: 60 }));
    pickOneStickerSize(80, 50);
    const os = oneStickerActive()!;
    const page = laptopPage(await renderOneStickerFor("laptop", os, oneStickerInputFrom(buyer, "My Shop", AT)), os, "t");
    expect(page).toContain("@page{size:80mm 50mm;margin:0}");
  }, 60000);
});

describe("one list for every new-sticker device; none wider than the printer", () => {
  it("50×30 · 60×40 · 70×50 · 80×50 · 80×60 · 100×60 (D520 / XP-420B / Flash / laptop)", () => {
    const all = [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60]].map(([w, h]) => ({ w, h }));
    for (const n of ["D520BT-Z", "XP-420B", "Y41BT-0FC4_LE", null]) expect(oneStickerSizesFor(n), String(n)).toEqual(all);
  });
  it("Niimbot B1 / B21: 50×30 only; B3S: up to 70×50", () => {
    expect(oneStickerSizesFor("B1-H1")).toEqual([{ w: 50, h: 30 }]);
    expect(oneStickerSizesFor("B21-C2")).toEqual([{ w: 50, h: 30 }]);
    expect(oneStickerSizesFor("B3S-P1")).toEqual([{ w: 50, h: 30 }, { w: 60, h: 40 }, { w: 70, h: 50 }]);
  });
});

describe("the size the Live print pattern and Save use", () => {
  it("saved → the saved size (standard or Custom) — never changed by itself", () => {
    saveOneSticker({ ...recommendedSettings({ w: 45, h: 35 }), size: { w: 45, h: 35, custom: true } });
    expect(oneStickerSizeNow(PP, "100x60mm (Standard)", "d520", "D520BT-Z")).toEqual({ w: 45, h: 35, custom: true });
    expect(oneStickerSizeNow(PP, "60x40mm", "niimbot", "B1-H1")).toEqual({ w: 45, h: 35, custom: true });
    saveOneSticker(recommendedSettings({ w: 100, h: 60 }));
    expect(oneStickerSizeNow(PP, "60x40mm", "niimbot", "B1-H1")).toEqual({ w: 100, h: 60 }); // too wide, but saved = kept (the screen says so)
  });
  it("laptop before its Save: a Printer settings pick (Custom too) is remembered and used; nothing is saved", () => {
    expect(oneStickerSizeNow(PP, "100x60mm (Standard)", "laptop", null)).toEqual({ w: 100, h: 60 });
    expect(pickOneStickerSize(62, 40)).toEqual({ size: { w: 62, h: 40, custom: true }, saved: null });
    expect(readSavedOneSticker()).toBeNull(); // the laptop still prints today's sticker until Save
    expect(oneStickerSizeNow(PP, "100x60mm (Standard)", "laptop", null)).toEqual({ w: 62, h: 40, custom: true });
    pickOneStickerSize(70, 50);
    expect(oneStickerSizeNow(PP, "100x60mm (Standard)", "laptop", null)).toEqual({ w: 70, h: 50 });
    // the Save on the Live print pattern saves that size, and the remembered pick is done
    saveOneSticker({ ...recommendedSettings({ w: 70, h: 50 }) });
    expect(localStorage.getItem(LS_ONE_STICKER_SIZE)).toBeNull();
  });
  it("a remembered pick wider than the printer, or 50×30 / Custom on a TEXT / WiFi phone, is not used", () => {
    pickOneStickerSize(100, 60);
    expect(oneStickerSizeNow(PP, "100x60mm (Standard)", "niimbot", "B1-H1")).toEqual({ w: 50, h: 30 });
    pickOneStickerSize(45, 35);
    expect(oneStickerSizeNow(PP, "60x40mm", "text", null)).toEqual({ w: 60, h: 40 });
    pickOneStickerSize(50, 30);
    expect(oneStickerSizeNow(PP, "60x40mm", "wifi", null)).toEqual({ w: 60, h: 40 });
  });
  it("Custom out of 30–110 mm → nothing", () => {
    expect(pickOneStickerSize(29, 40)).toBeNull();
    expect(pickOneStickerSize(40, 111)).toBeNull();
    expect(readOneStickerSizeChoice()).toBeNull();
  });
  it("below 50×30 the QR goes OFF on the saved sticker and stays off on a bigger size", () => {
    saveOneSticker({ ...recommendedSettings({ w: 60, h: 40 }), qr: true });
    expect(pickOneStickerSize(40, 30)!.saved!.qr).toBe(false);
    expect(pickOneStickerSize(60, 40)!.saved!.qr).toBe(false);
  });
  it("clearOneStickerSizeChoice removes the remembered pick", () => {
    pickOneStickerSize(62, 40);
    clearOneStickerSizeChoice();
    expect(readOneStickerSizeChoice()).toBeNull();
  });
});

describe("auto-save on a phone", () => {
  it("Niimbot B1, nothing picked: still 50×30 (unchanged)", () => {
    phone(PATHS[3]); __resetSavedPrinter(); rememberSavedPrinter({ address: "AA", name: "B1-H1", transport: "niimbot" } as Parameters<typeof rememberSavedPrinter>[0]);
    expect(autoSaveOneSticker({ visible: true, flagsLoaded: true, devicePath: "niimbot", printerSaved: true }, PP, "100x60mm (Standard)", false, "B1-H1")!.size).toEqual({ w: 50, h: 30 });
  });
  it("a size picked in Printer settings before the printer was saved is the auto-saved size — when the printer takes it", () => {
    pickOneStickerSize(45, 30);
    expect(autoSaveOneSticker({ visible: true, flagsLoaded: true, devicePath: "niimbot", printerSaved: true }, PP, "100x60mm (Standard)", false, "B1-H1")!.size).toEqual({ w: 45, h: 30, custom: true });
    localStorage.clear(); __resetOneStickerState();
    pickOneStickerSize(100, 60); // too wide for a B1 → the first draft's 50×30
    expect(autoSaveOneSticker({ visible: true, flagsLoaded: true, devicePath: "niimbot", printerSaved: true }, PP, "100x60mm (Standard)", false, "B1-H1")!.size).toEqual({ w: 50, h: 30 });
  });
  it("without a pick the auto-save is exactly the first draft (seedOneSticker) as before", () => {
    const s = autoSaveOneSticker({ visible: true, flagsLoaded: true, devicePath: "d520", printerSaved: true }, PP, "60x40mm", false, "D520BT-Z")!;
    expect(s).toEqual(seedOneSticker(PP, "60x40mm", false, "d520", "D520BT-Z"));
  });
});
