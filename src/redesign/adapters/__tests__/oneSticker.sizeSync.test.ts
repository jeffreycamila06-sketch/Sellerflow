// ONE SIZE, BOTH PLACES — the Printer settings "Label size" and the new Live print pattern size.
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { LS_ONE_STICKER, readSavedOneSticker, saveOneSticker, syncOneStickerSizeFromPrinter, sizeFromPrinterLabel, printerLabelFor, psLabelFor, __resetOneStickerState, setOneStickerVisible, oneStickerActive } from "../oneStickerPrint";
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
    const res = syncOneStickerSizeFromPrinter("60x40mm");
    expect(res.status).toBe("synced");
    const saved = readSavedOneSticker()!;
    expect(saved.size).toEqual({ w: 60, h: 40 });
    expect(saved.parts.comment.scale).toBe(1.5);
    expect(saved.parts.name.weight).toBe("extra");
    expect(saved.qr).toBe(false);
    expect(oneStickerActive()?.size).toEqual({ w: 60, h: 40 }); // the next print uses it
  });
  it("a device that never saved the new pattern stays on today's sticker (nothing is saved)", () => {
    expect(syncOneStickerSizeFromPrinter("60x40mm")).toEqual({ status: "none" });
    expect(readSavedOneSticker()).toBeNull();
  });
  it("a custom size picked on the new screen is replaced by the standard size picked in Printer settings", () => {
    saveOneSticker({ ...recommendedSettings({ w: 75, h: 45 }), size: { w: 75, h: 45, custom: true } });
    const r = syncOneStickerSizeFromPrinter("80x50mm");
    expect(r.status === "synced" && r.settings.size).toEqual({ w: 80, h: 50 });
  });
  it("a size the saved sticker can't take is KEPT and reported (Niimbot, too wide, 50×30 on TEXT / WiFi) — never a silent disagreement", () => {
    saveOneSticker(recommendedSettings({ w: 50, h: 30 }));
    expect(syncOneStickerSizeFromPrinter("60x40mm", { printerName: "B1-H123", niimbot: true })).toEqual({ status: "kept", reason: "niimbot", keep: { w: 50, h: 30 } });
    expect(syncOneStickerSizeFromPrinter("60x40mm", { printerName: "B21-X" })).toEqual({ status: "kept", reason: "too_wide", keep: { w: 50, h: 30 }, model: "B21", maxMm: 50 });
    expect(readSavedOneSticker()!.size).toEqual({ w: 50, h: 30 });
    saveOneSticker(recommendedSettings({ w: 60, h: 40 }));
    for (const devicePath of ["text", "wifi"]) expect(syncOneStickerSizeFromPrinter("50x30mm", { devicePath })).toEqual({ status: "kept", reason: "text_50x30", keep: { w: 60, h: 40 } });
    expect(readSavedOneSticker()!.size).toEqual({ w: 60, h: 40 });
    const r = syncOneStickerSizeFromPrinter("50x30mm", { devicePath: "d520" });
    expect(r.status === "synced" && r.settings.size).toEqual({ w: 50, h: 30 }); // an image path takes it
  });
  it("RedesignApp puts Printer settings back to the kept size and shows the message", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    const at = src.indexOf("syncOneStickerSizeFromPrinter(s,");
    const block = src.slice(at, at + 1500);
    expect(block).toContain('if (sync.status === "kept")');
    expect(block).toContain("setPsSize(psLabelFor(sync.keep, devPath) ?? psSize)");
    expect(block).toMatch(/rd_os_sync_niimbot[\s\S]*rd_os_sync_too_wide[\s\S]*rd_os_sync_text/);
  });
  it("Printer settings only ever shows one of its own sizes: psLabelFor (standard, not custom, no 50×30 on TEXT / WiFi)", () => {
    expect(psLabelFor({ w: 100, h: 60 })).toBe("100x60mm (Standard)");
    expect(psLabelFor({ w: 60, h: 40 }, "niimbot")).toBe("60x40mm");
    expect(psLabelFor({ w: 50, h: 30 }, "d520")).toBe("50x30mm");
    expect(psLabelFor({ w: 50, h: 30 }, "text")).toBeNull();
    expect(psLabelFor({ w: 50, h: 30 }, "wifi")).toBeNull();
    expect(psLabelFor({ w: 40, h: 30, custom: true })).toBeNull();
    expect(psLabelFor({ w: 75, h: 45 })).toBeNull(); // not a standard size
  });
  it("a Niimbot with a saved CUSTOM 40×30: the pick is kept as custom (Printer settings must keep its previous size)", () => {
    saveOneSticker({ ...recommendedSettings({ w: 40, h: 30 }), size: { w: 40, h: 30, custom: true } });
    const r = syncOneStickerSizeFromPrinter("60x40mm", { printerName: "B1-H1", niimbot: true });
    expect(r).toEqual({ status: "kept", reason: "niimbot", keep: { w: 40, h: 30, custom: true } });
    expect(r.status === "kept" && psLabelFor(r.keep, "niimbot")).toBeNull(); // → RedesignApp keeps the previous psSize
  });
  it("RedesignApp: Save and the kept-size revert use the same rule; a TEXT / WiFi phone never starts at 50×30; the laptop test never waits on a path without a page", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(src).toContain("const label = psLabelFor(next.size, oneStickerDevicePath(");
    expect(src).toContain('if ((path === "text" || path === "wifi") && size.w === 50 && size.h === 30) size = { w: 60, h: 40 };');
    const pr = fs.readFileSync(path.join(__dirname, "../printing.ts"), "utf8");
    expect(pr).toContain('if (!r.ok || r.via !== "browser") res({ ok: r.ok, code: "", message: "", via: r.via });');
  });
  it("RedesignApp wires both directions (Printer settings pick → one sticker; Save → Printer settings label)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(src).toMatch(/onPickPsSize=\{\(s\) => \{ setPsSize\(s\); setPsSizeOpen\(false\); if \(oneStickerOn\) \{\s*const sync = syncOneStickerSizeFromPrinter\(s, \{ printerName: savedBtPrinter\(\)\?\.name \?\? null, niimbot: savedIsNiimbot\(\), devicePath: oneStickerDevicePath\(/);
    expect(src).toMatch(/const label = psLabelFor\(next\.size, oneStickerDevicePath\([\s\S]{0,120}if \(label\) setPsSize\(label\);/);
  });
});
