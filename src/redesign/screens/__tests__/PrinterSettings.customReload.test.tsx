// BLOCKING BUG (43907e13): a saved Custom size was lost on the next app open. Saving Custom never changes
// psSize (psLabelFor(custom) = null), so the old label (e.g. "60x40mm") stays; on the next open the reconcile
// effect (RedesignApp) ran reconcileOneStickerSize(psSize) → syncOneStickerSizeFromPrinter and replaced the
// saved custom (45x35) with 60x40 — against "last save wins". Fix: a saved size with no Printer settings label
// (custom) is kept by the reconcile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PrinterSettings from "../PrinterSettings";
import { TProvider } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";
import { recommendedSettings } from "../../adapters/oneSticker";
import { saveOneSticker, readSavedOneSticker, saveOneStickerSizeFromPrinterCustom, syncOneStickerSizeFromPrinter, reconcileOneStickerSize, __resetOneStickerState } from "../../adapters/oneStickerPrint";

vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: async () => { throw new Error("no font C"); }, loadCjkRegAtlas: async () => { throw new Error("no font C"); } }));
beforeEach(() => { (window as unknown as { Capacitor?: unknown }).Capacitor = {}; localStorage.clear(); __resetOneStickerState(); });
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; localStorage.clear(); });

// what RedesignApp's reconcile effect does on the next app open (psSize still the old label)
const reopen = (psSize = "60x40mm") => reconcileOneStickerSize(psSize, { printerName: "D520BT-Z", niimbot: false, devicePath: "d520" });
const header = (psSize = "60x40mm") => {
  const saved = readSavedOneSticker();
  render(
    <TProvider lang="en">
      <PrinterSettings onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}} psSize={psSize} psSizeOpen={false}
        onTogglePsSize={() => {}} onPickPsSize={() => {}} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }}
        customSize={{ allowed: true, saved: saved ? saved.size : null, printerName: "D520BT-Z", onSave: () => {} }} />
    </TProvider>,
  );
  return screen.getByTestId("ps-size-current").textContent;
};

describe("a saved Custom size survives the next app open", () => {
  it("saved in Printer settings (45×35) → reopen with psSize \"60x40mm\" → still 45×35 custom; the header says \"Custom 45×35 mm\"", () => {
    saveOneSticker(recommendedSettings({ w: 60, h: 40 }));
    saveOneStickerSizeFromPrinterCustom(45, 35);
    expect(reopen()).toBeNull(); // Printer settings is not changed either
    expect(readSavedOneSticker()!.size).toEqual({ w: 45, h: 35, custom: true });
    expect(header()).toBe("Custom 45×35 mm");
  });
  it("saved on the Live print pattern (45×35) → reopen with psSize \"60x40mm\" → still 45×35 custom; the header says \"Custom 45×35 mm\"", () => {
    saveOneSticker({ ...recommendedSettings({ w: 45, h: 35, custom: true }) }); // the Live print pattern's Save
    expect(reopen()).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 45, h: 35, custom: true });
    expect(header()).toBe("Custom 45×35 mm");
  });
  it("after the Custom, a standard size picked in Printer settings wins (last save wins) and survives the reopen", () => {
    saveOneSticker(recommendedSettings({ w: 60, h: 40 }));
    saveOneStickerSizeFromPrinterCustom(45, 35);
    expect(syncOneStickerSizeFromPrinter("80x60mm", { printerName: "D520BT-Z", devicePath: "d520" }).status).toBe("synced");
    expect(readSavedOneSticker()!.size).toEqual({ w: 80, h: 60 });
    expect(reopen("80x60mm")).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 80, h: 60 });
    expect(header("80x60mm")).toBe("80x60mm");
  });
  it("unchanged: a saved STANDARD size still follows a Printer settings label picked while the screen was hidden", () => {
    saveOneSticker(recommendedSettings({ w: 70, h: 50 }));
    expect(reopen("60x40mm")).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 60, h: 40 });
  });
});
