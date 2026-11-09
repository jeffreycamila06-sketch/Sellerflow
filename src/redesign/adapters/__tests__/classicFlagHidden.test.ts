// Jeff 2026-11-09 (admin, AIMO D520): the new Live print pattern printed the OLD text sticker — no shop
// name at 60×40, thin letters, − / + never reached the paper. Cause: he once turned on "Classic text
// mode" (admin-only card). Printer setup v2 hides that card, but the router still honored the stored
// flag for admins → his phone was stuck on the TEXT path with no way to turn it off.
// Fix: the router honors the flag only while the card is on screen (classicTextCardShown) — exactly
// like for sellers, who never see it. The stored value is never deleted. Plus: per-account rollout of
// the new Live print pattern / all-scripts fix (features "one_sticker" / "sticker_all_scripts", sql/146).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { printSlip, setClassicTextAllowed, canUseClassicText, classicTextCardShown, oneStickerDevicePath, printsStickerViaImage, LS_CLASSIC_TEXT, DEF_SETTINGS, __resetNativePrintQueue, type Settings } from "../printing";
import { __resetSavedPrinter } from "../savedPrinter";
import { oneStickerVisibleFor, stickerAllScriptsFor } from "../oneStickerPrint";
import { FEATURE_KEYS } from "../featureAccess";
import type { Buyer } from "../../../lib/orderTypes";

type W = Window & { SellerFlowPrinter?: Record<string, unknown> };
const cfg: Settings = { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" };
const buyer = { num: 7, name: "Amy Chen", handle: "amy.shop", platform: "TikTok", totalSpent: 0, totalOrders: 1,
  orders: [{ orderNum: Date.UTC(2026, 10, 9, 6, 5), item: "A2 x2 350", qty: 1, price: 0, total: 0, time: "14:05", handle: "amy.shop", name: "Amy Chen", bNum: 7, platform: "TikTok", status: "New", date: "2026-11-09" }] } as unknown as Buyer;
const ROOT = path.resolve(__dirname, "../../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

function d520(v2App: boolean) {
  const ok = () => vi.fn(async () => ({ ok: true }));
  const b = { printStickerNative: ok(), printStickerBitmap: ok(), ...(v2App ? { testGenericPrinter: ok() } : {}) };
  (window as W).SellerFlowPrinter = b;
  return b;
}
async function printOnce(b: ReturnType<typeof d520>): Promise<"bitmap" | "text"> {
  printSlip(buyer, "NT$", "My Shop", cfg);
  for (let i = 0; i < 400 && !b.printStickerBitmap.mock.calls.length && !b.printStickerNative.mock.calls.length; i++) await new Promise((r) => setTimeout(r, 10));
  return b.printStickerBitmap.mock.calls.length ? "bitmap" : "text";
}
// What RedesignApp does on every render (synchronously, before oneStickerDevicePath is read).
const wire = (role: string, flowV2: boolean) => setClassicTextAllowed(classicTextCardShown(canUseClassicText(role, "jeff@x.com"), flowV2, typeof (window as W).SellerFlowPrinter?.testGenericPrinter === "function"));

beforeEach(() => { __resetNativePrintQueue(); __resetSavedPrinter(); localStorage.setItem(LS_CLASSIC_TEXT, "1"); });
afterEach(() => { delete (window as W).SellerFlowPrinter; setClassicTextAllowed(false); localStorage.clear(); });

describe("Classic text flag while the card is hidden", () => {
  it("the cause (main's wiring = the account may use it, nothing else): admin + stored flag + setup v2 → the D520 prints the TEXT sticker", async () => {
    const b = d520(true);
    setClassicTextAllowed(canUseClassicText("admin", "jeff@x.com"));
    expect(oneStickerDevicePath(cfg)).toBe("text");
    expect(await printOnce(b)).toBe("text");
  });
  it("FIX: admin + stored flag + setup v2 (card hidden) → the D520 prints the picture; the screen agrees; the stored value is kept", async () => {
    const b = d520(true);
    wire("admin", true);
    expect(oneStickerDevicePath(cfg)).toBe("d520");
    expect(printsStickerViaImage(cfg)).toBe(true);
    expect(await printOnce(b)).toBe("bitmap");
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(localStorage.getItem(LS_CLASSIC_TEXT)).toBe("1");
  });
  it("the card still on screen (older app without setup v2, or the v2 switch off for this account) → the flag is still honored, as before", async () => {
    let b = d520(false); wire("admin", true);
    expect(oneStickerDevicePath(cfg)).toBe("text");
    expect(await printOnce(b)).toBe("text");
    __resetNativePrintQueue();
    b = d520(true); wire("admin", false);
    expect(oneStickerDevicePath(cfg)).toBe("text");
    expect(await printOnce(b)).toBe("text");
  });
  it("sellers: unchanged — a stray flag is ignored with or without setup v2", async () => {
    for (const v2 of [true, false]) {
      __resetNativePrintQueue();
      const b = d520(v2); wire("seller", v2);
      expect(await printOnce(b)).toBe("bitmap");
    }
  });
  it("classicTextCardShown = PrinterSettings' `showClassicToggle && !v2`", () => {
    for (const canUse of [true, false]) for (const flowV2 of [true, false]) for (const bridge of [true, false])
      expect(classicTextCardShown(canUse, flowV2, bridge), `${canUse} ${flowV2} ${bridge}`).toBe(canUse && !(flowV2 && bridge));
  });
  it("RedesignApp sets the router flag in the SAME render (not an effect) from classicTextCardShown, and shows the card from it", () => {
    const app = read("src/redesign/RedesignApp.tsx");
    expect(app).not.toMatch(/useEffect\(\(\) => \{ setClassicTextAllowed/);
    expect(app).toMatch(/const classicShown = classicTextCardShown\(classicAllowed, printerFlowV2, hasGenericPrinterBridge\(\)\);\n\s*setClassicTextAllowed\(classicShown\);/);
    expect(app).toContain("showClassicToggle={classicShown}");
    expect(app).toContain("flowV2={printerFlowV2}");
    expect(app.indexOf("setClassicTextAllowed(classicShown)")).toBeLessThan(app.indexOf("devicePath={oneStickerDevicePath("));
  });
});

describe("per-account rollout of the new Live print pattern / all-scripts fix (sql/146)", () => {
  it("visible = admin OR the switch OR feature one_sticker; all scripts = admin OR the switch OR feature sticker_all_scripts", () => {
    expect(oneStickerVisibleFor("seller", false, false)).toBe(false);
    expect(oneStickerVisibleFor("seller", false, false, true)).toBe(true);
    expect(oneStickerVisibleFor("seller", true, false)).toBe(true);
    expect(oneStickerVisibleFor("admin", false, true)).toBe(true);
    expect(stickerAllScriptsFor(false, false)).toBe(false);
    expect(stickerAllScriptsFor(false, false, true)).toBe(true);
    expect(stickerAllScriptsFor(true, false)).toBe(true);
    expect(stickerAllScriptsFor(false, true)).toBe(true);
  });
  it("RedesignApp reads the two features; the app knows the keys; sql/146 = sql/140's key list + the two", () => {
    const app = read("src/redesign/RedesignApp.tsx");
    expect(app).toContain('oneStickerVisibleFor(auth.profile?.role, featureSw.oneSticker, isAdmin, hasFeature("one_sticker"))');
    expect(app).toContain('stickerAllScriptsFor(featureSw.stickerAllScripts, isAdmin, hasFeature("sticker_all_scripts"))');
    expect(FEATURE_KEYS).toContain("one_sticker");
    expect(FEATURE_KEYS).toContain("sticker_all_scripts");
    const keys = (f: string) => /values (\('fb_preview'\)[^\n]*)/.exec(read(f))![1].trim();
    expect(keys("sql/146_one_sticker_feature_access.sql")).toBe(`${keys("sql/140_buyer_contact.sql")}, ('one_sticker'), ('sticker_all_scripts')`);
    expect(keys("sql/146_one_sticker_feature_access_rollback.sql")).toBe(keys("sql/140_buyer_contact.sql"));
  });
});
