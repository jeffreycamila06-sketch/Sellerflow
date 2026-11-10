// AUTO-SAVE (Jeff 2026-11-10): a PHONE whose account sees the new Live print pattern saves the new sticker by
// itself the first time (no Save tap) — once per phone, only when the visibility is certain, never on the laptop /
// the text sticker / WiFi, never over a saved size. Accounts that don't see the screen keep today's sticker
// byte for byte (also on a shared phone). Each print goes through the real printSlip router.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { printSlip, DEF_SETTINGS, setStickerQrEntitled, oneStickerDevicePath, __resetNativePrintQueue, type Settings } from "../printing";
import { setOneStickerVisible, readSavedOneSticker, saveOneSticker, oneStickerVisibleFor, autoSaveOneSticker, reconcileOneStickerSize, psLabelFor, shouldAutoSaveOneSticker, seedOneSticker, __resetOneStickerState, type SeedPattern } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { rememberSavedPrinter, savedBtPrinter, __resetSavedPrinter } from "../savedPrinter";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const AT = Date.UTC(2026, 10, 10, 6, 5);
const buyer = { num: 12, name: "Amy Chen", handle: "amy.shop", platform: "TikTok", totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: AT, item: "A2 x2 350", qty: 1, price: 0, total: 0, time: "14:05", handle: "amy.shop", name: "Amy Chen", bNum: 12, platform: "TikTok", status: "New", date: "2026-11-10" }] } as unknown as Buyer;
const PP: SeedPattern = { shopName: true, shopNameSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };
type P = { key: string; path: string; printer?: { address: string; name: string; model?: "generic"; lang?: "tspl"; transport?: string }; fn: string };
const PATHS: P[] = [
  { key: "AIMO D520", path: "d520", printer: { address: "AA", name: "D520BT-Z", transport: "ble" }, fn: "printStickerBitmap" },
  { key: "Xprinter XP-420B", path: "tspl", printer: { address: "AA", name: "XP-420B", model: "generic", lang: "tspl" }, fn: "printRawTspl" },
  { key: "Flash Y41BT", path: "tspl", printer: { address: "AA", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" }, fn: "printRawTspl" },
  { key: "Niimbot B1", path: "niimbot", printer: { address: "AA", name: "B1-H1", transport: "niimbot" }, fn: "printStickerImage" },
];
const cfg = (type: "bluetooth" | "lan" = "bluetooth", size = "60x40mm"): Settings => ({ ...DEF_SETTINGS, printerType: type, stickerSize: size.replace("mm", "") } as Settings);
function phone(p?: P): Record<string, ReturnType<typeof vi.fn>> {
  __resetSavedPrinter(); if (p?.printer) rememberSavedPrinter(p.printer as Parameters<typeof rememberSavedPrinter>[0]);
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
// what RedesignApp's effect does on an app open
const open = (visible: boolean, flagsLoaded: boolean, psType: "bluetooth" | "lan" = "bluetooth", psSize = "60x40mm", printer: string | null = savedBtPrinter()?.name ?? null) =>
  autoSaveOneSticker({ visible, flagsLoaded, devicePath: oneStickerDevicePath(cfg(psType, psSize)), printerSaved: savedBtPrinter() != null }, PP, psSize, false, printer);

beforeAll(() => { installSans(); installNodeFallbackDrawer(); setStickerQrEntitled(true); });
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetOneStickerState(); __resetSavedPrinter(); __resetNativePrintQueue(); localStorage.clear(); });

describe("listed account, phone, nothing saved → the new sticker is saved on open and prints", () => {
  for (const p of PATHS) it(p.key, async () => {
    const b = phone(p);
    const today = await sent(b); // before: today's sticker
    setOneStickerVisible(true);
    const s = open(true, true, "bluetooth", "60x40mm", p.printer?.name ?? null);
    expect(s, "auto-saved").not.toBeNull();
    expect(readSavedOneSticker()).toEqual(s);
    expect(s!.size).toEqual(p.path === "niimbot" ? { w: 50, h: 30 } : { w: 60, h: 40 }); // the Printer settings size (Niimbot: 50×30)
    const now = await sent(b);
    expect(now.startsWith(`${p.fn}:`), now.slice(0, 40)).toBe(true);
    expect(now).not.toBe(today); // the new sticker, not today's
    // = exactly what a Save on the Live print pattern of the same draft prints
    localStorage.clear(); __resetOneStickerState(); setOneStickerVisible(true);
    saveOneSticker(seedOneSticker(PP, "60x40mm", false, p.path, p.printer?.name ?? null));
    expect(await sent(b)).toBe(now);
  }, 120000);
});

describe("one size in both places after the auto-save, also after the next app open", () => {
  it("D520 (60×40) and Niimbot (50×30): Printer settings shows the saved size and the open-time reconcile keeps it", () => {
    phone(PATHS[0]);
    const d = open(true, true)!;
    const label = psLabelFor(d.size, "d520")!; // what RedesignApp puts in Printer settings
    expect(label).toBe("60x40mm");
    expect(reconcileOneStickerSize(label, { devicePath: "d520" })).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 60, h: 40 });
    localStorage.clear(); __resetOneStickerState();
    phone(PATHS[3]);
    const n = open(true, true, "bluetooth", "60x40mm", "B1-H1")!;
    const nl = psLabelFor(n.size, "niimbot")!;
    expect(nl).toBe("50x30mm");
    expect(reconcileOneStickerSize(nl, { niimbot: true, devicePath: "niimbot", printerName: "B1-H1" })).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 50, h: 30 });
  });
});

describe("first-time printer setup (guardian, 0559cfe6: a Niimbot was saved as an AIMO 100×60)", () => {
  it("no Bluetooth printer saved yet → no auto-save; the Niimbot is saved → 50×30 new sticker, printed by the Niimbot driver, no \"too wide\"", async () => {
    const b = phone(); // the Bluetooth card tapped, nothing picked yet: the path looks like a D520
    expect(oneStickerDevicePath(cfg())).toBe("d520");
    setOneStickerVisible(true);
    expect(open(true, true, "bluetooth", "100x60mm")).toBeNull();
    expect(readSavedOneSticker()).toBeNull();
    rememberSavedPrinter({ address: "NN", name: "B1-H1", transport: "niimbot" }); // pickPrinter saved it → onPrinterSaved
    const s = open(true, true, "bluetooth", "100x60mm");
    expect(s!.size).toEqual({ w: 50, h: 30 });
    const notices: unknown[] = [];
    const { setOneStickerNoticeHandler } = await import("../printing");
    setOneStickerNoticeHandler((n) => notices.push(n));
    try {
      const out = await sent(b);
      expect(out.startsWith("printStickerImage:")).toBe(true);
      expect(JSON.parse(out.slice("printStickerImage:".length)).image).toMatchObject({ labelWidthMm: 50, labelHeightMm: 30 });
      expect(notices).toEqual([]);
    } finally { setOneStickerNoticeHandler(null); }
  }, 60000);
  it("PrinterSettings calls onPrinterSaved right after the printer is saved, before the test sticker; RedesignApp wires it to the same auto-save", () => {
    const ps = fs.readFileSync("src/redesign/screens/PrinterSettings.tsx", "utf8");
    expect(ps).toMatch(/const r = await btCall<BluetoothScanResult>\("setBluetoothLabelPrinter", save\);\s*onPrinterSaved\?\.\(\);[^\n]*\n\s*const tp = testPrintFor\(/);
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("onPrinterSaved={autoSaveNow}");
    // the older printer screen (setup v2 off) too
    expect(ps).toMatch(/async function selectBt\(p: BluetoothPrinterDevice\) \{\s*const r = await btCall<BluetoothScanResult>\("setBluetoothLabelPrinter"[^\n]*\n\s*onPrinterSaved\?\.\(\);/);
  });
});

describe("never touched / never saved", () => {
  it("a saved standard or Custom size is not changed", () => {
    phone(PATHS[0]);
    saveOneSticker(recommendedSettings({ w: 80, h: 50 }));
    expect(open(true, true)).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 80, h: 50 });
    saveOneSticker({ ...recommendedSettings({ w: 45, h: 35, custom: true }) });
    expect(open(true, true)).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 45, h: 35, custom: true });
  });
  it("laptop / web (no printer bridge) → no auto-save (Save is still needed)", () => {
    expect(oneStickerDevicePath(cfg())).toBe("laptop");
    expect(open(true, true)).toBeNull();
    expect(readSavedOneSticker()).toBeNull();
  });
  it("a phone on the text sticker or WiFi → nothing changes", () => {
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn() }; // an older app: no picture method → text
    expect(oneStickerDevicePath(cfg())).toBe("text");
    expect(open(true, true)).toBeNull();
    phone(PATHS[0]);
    expect(oneStickerDevicePath(cfg("lan"))).toBe("wifi");
    expect(open(true, true, "lan")).toBeNull();
    expect(readSavedOneSticker()).toBeNull();
  });
  it("not visible for the account, or the reads not finished / failed → no auto-save (fail closed)", () => {
    phone(PATHS[0]);
    expect(open(false, true)).toBeNull();
    expect(open(true, false)).toBeNull();
    expect(readSavedOneSticker()).toBeNull();
    for (const visible of [true, false]) for (const flagsLoaded of [true, false]) for (const devicePath of ["d520", "tspl", "escpos", "cpcl", "niimbot", "laptop", "text", "wifi"]) for (const printerSaved of [true, false]) for (const saved of [true, false])
      expect(shouldAutoSaveOneSticker({ visible, flagsLoaded, devicePath, printerSaved, saved })).toBe(visible && flagsLoaded && printerSaved && !saved && ["d520", "tspl", "escpos", "cpcl", "niimbot"].includes(devicePath));
  });
});

describe("accounts that don't see the new screen keep today's sticker byte for byte", () => {
  it("shared phone: a listed account auto-saved, then an unlisted account signs in → today's sticker (= a phone that never saved)", async () => {
    const b = phone(PATHS[0]);
    const never = await sent(b);
    setOneStickerVisible(true); open(true, true);
    expect(readSavedOneSticker()).not.toBeNull();
    setOneStickerVisible(oneStickerVisibleFor("seller", false, false, false)); // the unlisted account (switch OFF)
    expect(await sent(b)).toBe(never);
  }, 60000);
  it("global switch ON (one_sticker_enabled = 'true'): an unlisted account's phone auto-saves and prints the new sticker; switch back OFF → today's sticker again", async () => {
    const b = phone(PATHS[1]);
    const never = await sent(b);
    const visible = oneStickerVisibleFor("seller", true, false, false);
    expect(visible).toBe(true);
    setOneStickerVisible(visible);
    expect(open(visible, true, "bluetooth", "60x40mm", "XP-420B")).not.toBeNull();
    expect(await sent(b)).not.toBe(never);
    setOneStickerVisible(oneStickerVisibleFor("seller", false, false, false));
    expect(await sent(b)).toBe(never);
  }, 60000);
});

describe("RedesignApp wiring", () => {
  it("runs only after both reads finished, from the phone's own device path; a standard size also goes to Printer settings (one size, both places)", () => {
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("const flagsLoaded = switchesOk(featureSw) && featureAccessOk();");
    expect(app).toContain("const next = autoSaveOneSticker({ visible: oneStickerOn, flagsLoaded, devicePath, printerSaved: savedBtPrinter() != null }, pp, psSize, isStickerQrOn(), savedBtPrinter()?.name ?? null);");
    expect(app).toContain("const label = psLabelFor(next.size, devicePath);");
    expect(app).toContain("useEffect(() => { autoSaveNow(); }, [oneStickerOn, flagsLoaded, osDevicePath, osPrinterName]);");
    // the one read-only printer ask: visible account, both reads answered, Bluetooth phone, nothing known / saved
    expect(app).toContain('if (printerAsked.current || !oneStickerOn || !flagsLoaded || !hasBtBridge() || savedBtPrinter() != null || readSavedOneSticker() != null) return;');
  });
});
