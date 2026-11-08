// ONE SIZE, BOTH PLACES — the Printer settings "Label size" and the new Live print pattern size.
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { LS_ONE_STICKER, readSavedOneSticker, saveOneSticker, syncOneStickerSizeFromPrinter, sizeFromPrinterLabel, printerLabelFor, __resetOneStickerState, setOneStickerVisible, oneStickerActive } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";

afterEach(() => { try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ } __resetOneStickerState(); });

describe("Printer settings Label size ↔ one sticker size", () => {
  it("reads every Printer settings label", () => {
    expect(sizeFromPrinterLabel("100x60mm (Standard)")).toEqual({ w: 100, h: 60 });
    expect(sizeFromPrinterLabel("60x40mm")).toEqual({ w: 60, h: 40 });
    expect(sizeFromPrinterLabel("50x30mm")).toEqual({ w: 50, h: 30 });
    expect(sizeFromPrinterLabel("nonsense")).toBeNull();
    for (const z of [{ w: 100, h: 60 }, { w: 80, h: 50 }, { w: 60, h: 40 }]) expect(sizeFromPrinterLabel(printerLabelFor(z))).toEqual(z);
  });
  it("a device that saved the new pattern: picking a size in Printer settings changes the size it prints — and only the size", () => {
    const s = recommendedSettings({ w: 100, h: 60 });
    s.parts.comment.scale = 1.5; s.parts.name.weight = "extra"; s.qr = false;
    saveOneSticker(s);
    setOneStickerVisible(true);
    const next = syncOneStickerSizeFromPrinter("60x40mm")!;
    expect(next.size).toEqual({ w: 60, h: 40 });
    const saved = readSavedOneSticker()!;
    expect(saved.size).toEqual({ w: 60, h: 40 });
    expect(saved.parts.comment.scale).toBe(1.5);
    expect(saved.parts.name.weight).toBe("extra");
    expect(saved.qr).toBe(false);
    expect(oneStickerActive()?.size).toEqual({ w: 60, h: 40 }); // the next print uses it
  });
  it("a device that never saved the new pattern stays on today's sticker (nothing is saved)", () => {
    expect(syncOneStickerSizeFromPrinter("60x40mm")).toBeNull();
    expect(readSavedOneSticker()).toBeNull();
  });
  it("a custom size picked on the new screen is replaced by the standard size picked in Printer settings", () => {
    saveOneSticker({ ...recommendedSettings({ w: 75, h: 45 }), size: { w: 75, h: 45, custom: true } });
    expect(syncOneStickerSizeFromPrinter("80x50mm")!.size).toEqual({ w: 80, h: 50 });
  });
  it("RedesignApp wires both directions (Printer settings pick → one sticker; Save → Printer settings label)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(src).toMatch(/onPickPsSize=\{\(s\) => \{ setPsSize\(s\); setPsSizeOpen\(false\); if \(oneStickerOn\) syncOneStickerSizeFromPrinter\(s\); \}\}/);
    expect(src).toMatch(/setPsSize\(printerLabelFor\(next\.size\)\)/);
  });
});
