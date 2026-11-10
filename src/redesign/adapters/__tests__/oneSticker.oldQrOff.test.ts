// Jeff 2026-11-10 (item 1): nothing saved yet + a size below 50×30 picked in Printer settings (listed or Custom) →
// the old "Print QR on sticker" switch goes OFF too, so the first draft and the phone auto-save start with QR OFF.
// It never comes back by itself on a bigger size. Accounts without the new screen: nothing changes.
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { isStickerQrOn, setStickerQrOn } from "../printing";
import { pickOneStickerSize, oldQrOffAfterPick, seedOneSticker, autoSaveOneSticker, saveOneSticker, readSavedOneSticker, __resetOneStickerState, type SeedPattern } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";

const PP: SeedPattern = { shopName: true, shopNameSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 };
afterEach(() => { localStorage.clear(); __resetOneStickerState(); });

/** RedesignApp.onPickOneSize (the only place it runs — reachable only through Printer settings' one size list). */
function pick(w: number, h: number) {
  const r = pickOneStickerSize(w, h)!;
  if (oldQrOffAfterPick(r.saved, r.size) && isStickerQrOn()) setStickerQrOn(false);
  return r;
}

describe("old QR switch after a small size picked with nothing saved", () => {
  it("QR ON → 40×30 → 100×60 → the Live print pattern's first draft has the QR OFF", () => {
    setStickerQrOn(true);
    pick(40, 30);
    expect(isStickerQrOn()).toBe(false);
    pick(100, 60); // a bigger size never turns it back on
    expect(isStickerQrOn()).toBe(false);
    expect(seedOneSticker(PP, "100x60mm (Standard)", isStickerQrOn(), "laptop", null).qr).toBe(false);
  });
  it("the phone auto-save after it → qr: false", () => {
    setStickerQrOn(true);
    pick(45, 40); // Custom narrower than 50 mm
    pick(100, 60);
    const s = autoSaveOneSticker({ visible: true, flagsLoaded: true, devicePath: "d520", printerSaved: true }, PP, "100x60mm (Standard)", isStickerQrOn(), "D520BT-Z")!;
    expect(s.qr).toBe(false);
    expect(readSavedOneSticker()!.qr).toBe(false);
  });
  it("a size of 50×30 or bigger leaves the switch as it is; the seller can turn it on again", () => {
    setStickerQrOn(true);
    pick(50, 30);
    expect(isStickerQrOn()).toBe(true);
    pick(60, 40);
    expect(isStickerQrOn()).toBe(true);
    pick(40, 30); setStickerQrOn(true); // the seller turns it on again
    pick(100, 60);
    expect(isStickerQrOn()).toBe(true);
  });
  it("a new sticker already saved: the old switch is not touched (the saved sticker has its own QR)", () => {
    saveOneSticker({ ...recommendedSettings({ w: 100, h: 60 }), qr: true });
    setStickerQrOn(true);
    pick(40, 30);
    expect(isStickerQrOn()).toBe(true);
    expect(readSavedOneSticker()!.qr).toBe(false);
  });
  it("only the new screen's size list does it (accounts without it: today's Printer settings never touch the switch)", () => {
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("if (oldQrOffAfterPick(r.saved, r.size) && isStickerQrOn()) setStickerQrOn(false);");
    expect(app.match(/setStickerQrOn\(/g)!.length).toBe(1); // nowhere else in RedesignApp
    const fn = app.slice(app.indexOf("const onPickOneSize = "), app.indexOf("};", app.indexOf("const onPickOneSize = ")));
    expect(fn).toContain("setStickerQrOn(false)");
    expect(app).toContain("onPick: onPickOneSize"); // passed only inside oneSize (osSizeMode = the new screen, not TEXT / WiFi)
    expect(app).toContain("oneSize={osSizeMode && osSizeNow ?");
  });
});
