// Jeff 2026-11-10: Custom W×H in Printer settings → Sticker size (the new sticker's size — ONE size in both
// places, last Save wins), and the QR switch rule on the Live print pattern (QR only on labels ≥ 50×30).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PrinterSettings, { type PsCustomSize } from "../PrinterSettings";
import OneStickerPattern from "../../components/OneStickerPattern";
import { TProvider } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";
import { recommendedSettings, type OneStickerSettings } from "../../adapters/oneSticker";
import { saveOneSticker, readSavedOneSticker, saveOneStickerSizeFromPrinterCustom, syncOneStickerSizeFromPrinter, __resetOneStickerState } from "../../adapters/oneStickerPrint";

vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: async () => { throw new Error("no font C"); }, loadCjkRegAtlas: async () => { throw new Error("no font C"); } }));
const noop = () => {};
beforeEach(() => { (window as unknown as { Capacitor?: unknown }).Capacitor = {}; localStorage.clear(); __resetOneStickerState(); });
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; localStorage.clear(); });

const renderPS = (customSize?: PsCustomSize, open = true) => render(
  <TProvider lang="en">
    <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={open}
      onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} customSize={customSize} />
  </TProvider>,
);
const cs = (over: Partial<PsCustomSize> = {}): PsCustomSize => ({ allowed: true, saved: { w: 60, h: 40 }, printerName: "D520BT-Z", onSave: vi.fn(), ...over });

describe("Printer settings → Sticker size → Custom", () => {
  it("accounts without the new screen: no Custom row, no note (today's screen)", () => {
    renderPS(undefined);
    expect(screen.queryByTestId("ps-size-custom")).toBeNull();
    expect(screen.queryByTestId("ps-custom-hidden")).toBeNull();
  });
  it("Custom → W×H (same 30–110 mm rule) → Save size sends the size", () => {
    const c = cs(); renderPS(c);
    fireEvent.click(screen.getByTestId("ps-size-custom"));
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "50" } });
    fireEvent.change(screen.getByTestId("ps-custom-h"), { target: { value: "40" } });
    expect(screen.queryByTestId("ps-custom-err")).toBeNull();
    expect(screen.queryByTestId("ps-custom-qr-note")).toBeNull();
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "40" } });
    expect(screen.getByTestId("ps-custom-qr-note").textContent).toBe("QR needs a label at least 50×30 mm"); // said before Save
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "50" } });
    fireEvent.click(screen.getByTestId("ps-custom-save"));
    expect(c.onSave).toHaveBeenCalledWith(50, 40);
  });
  it("a size out of 30–110 mm or wider than the printer cannot be saved", () => {
    const c = cs({ printerName: "B1-I603042141" }); renderPS(c);
    fireEvent.click(screen.getByTestId("ps-size-custom"));
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "25" } });
    expect(screen.getByTestId("ps-custom-err").textContent).toContain("30–110");
    expect((screen.getByTestId("ps-custom-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "70" } }); // the B1 takes up to 50 mm
    expect(screen.getByTestId("ps-custom-too-wide")).toBeTruthy();
    expect((screen.getByTestId("ps-custom-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("ps-custom-save"));
    expect(c.onSave).not.toHaveBeenCalled();
  });
  it("a saved custom size shows as the current size; hidden with a note on the text / WiFi sticker or before the new sticker is saved", () => {
    const { unmount } = renderPS(cs({ saved: { w: 50, h: 40, custom: true } }), false);
    expect(screen.getByTestId("ps-size-current").textContent).toBe("Custom 50×40 mm");
    unmount();
    const a = renderPS(cs({ allowed: false, reason: "text" }));
    expect(screen.queryByTestId("ps-size-custom")).toBeNull();
    expect(screen.getByTestId("ps-custom-hidden").textContent).toContain("not available for this printer");
    a.unmount();
    const b = renderPS(cs({ allowed: false, reason: "not_saved", saved: null }));
    expect(screen.queryByTestId("ps-size-custom")).toBeNull();
    expect(screen.getByTestId("ps-custom-hidden").textContent).toContain("save the new sticker in Live print pattern first");
    b.unmount();
    // C1 (Jeff 2026-11-10): no "set it in LIVE print pattern" note for a Niimbot any more — its size is in the one list
    expect(screen.queryByText(/Your Niimbot prints the size set in Live print pattern/)).toBeNull();
  });
});

describe("ONE size in both places — the last Save wins", () => {
  it("Printer settings Custom → the Live print pattern opens on it; a Live print pattern save → Printer settings follows", () => {
    saveOneSticker(recommendedSettings({ w: 60, h: 40 }));
    expect(saveOneStickerSizeFromPrinterCustom(50, 40)!.size).toEqual({ w: 50, h: 40, custom: true });
    expect(readSavedOneSticker()!.size).toEqual({ w: 50, h: 40, custom: true }); // what the Live print pattern opens with
    expect(saveOneStickerSizeFromPrinterCustom(70, 50)!.size).toEqual({ w: 70, h: 50 }); // a standard W×H is that size
    saveOneSticker({ ...recommendedSettings({ w: 45, h: 35, custom: true }) }); // a later save on the Live print pattern
    expect(readSavedOneSticker()!.size).toEqual({ w: 45, h: 35, custom: true });
    expect(syncOneStickerSizeFromPrinter("80x60mm").status).toBe("synced"); // a later standard pick in Printer settings
    expect(readSavedOneSticker()!.size).toEqual({ w: 80, h: 60 });
  });
  it("nothing saved (the device still prints today's sticker) or a size out of range → nothing is saved", () => {
    expect(saveOneStickerSizeFromPrinterCustom(50, 40)).toBeNull();
    saveOneSticker(recommendedSettings({ w: 60, h: 40 }));
    expect(saveOneStickerSizeFromPrinterCustom(29, 40)).toBeNull();
    expect(readSavedOneSticker()!.size).toEqual({ w: 60, h: 40 });
  });
  it("a Custom size below 50×30 from Printer settings turns the QR OFF, and a bigger size later keeps it OFF", () => {
    saveOneSticker({ ...recommendedSettings({ w: 60, h: 40 }), qr: true });
    expect(saveOneStickerSizeFromPrinterCustom(40, 30)!.qr).toBe(false);
    expect(saveOneStickerSizeFromPrinterCustom(60, 50)!.qr).toBe(false);
  });
});

describe("Live print pattern: the QR switch below 50×30", () => {
  // the size comes from Printer settings (Jeff 2026-11-10): `size` = the size picked there
  let setSize: (z: { w: number; h: number; custom?: boolean }) => void = noop;
  const renderOS = (initial: OneStickerSettings) => {
    const onSave = vi.fn();
    const el = (size: { w: number; h: number; custom?: boolean }) => <TProvider lang="en"><OneStickerPattern onBack={noop} initial={initial} size={size} onChangeSize={noop} savedOnDevice onSave={onSave} shopName="Maria Ukay" devicePath="d520" qrAllowed onTest={noop} /></TProvider>;
    const r = render(el(initial.size));
    setSize = (z) => r.rerender(el(z));
    return onSave;
  };
  const sw = () => screen.getByTestId("os-qr-on") as HTMLButtonElement;
  it("a Custom 40×30: the QR is forced OFF, greyed, with the note, and can't be turned on; back to 60×40 it stays OFF", () => {
    const onSave = renderOS({ ...recommendedSettings({ w: 60, h: 40 }), qr: true });
    expect(sw().getAttribute("aria-checked")).toBe("true");
    setSize({ w: 40, h: 30, custom: true });
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(sw().disabled).toBe(true);
    expect(screen.getByTestId("os-row-qr").getAttribute("data-off")).toBe("1");
    expect(screen.getByTestId("os-qr-sub").textContent).toBe("QR needs a label at least 50×30 mm");
    fireEvent.click(sw());
    expect(sw().getAttribute("aria-checked")).toBe("false");
    setSize({ w: 60, h: 40 });
    expect(sw().disabled).toBe(false);
    expect(sw().getAttribute("aria-checked")).toBe("false"); // NOT turned back on
    fireEvent.click(screen.getByTestId("os-save"));
    expect(onSave.mock.calls[0][0].qr).toBe(false);
  });
  it("50×30 itself keeps the QR", () => {
    renderOS({ ...recommendedSettings({ w: 60, h: 40 }), qr: true });
    setSize({ w: 50, h: 30 });
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(sw().disabled).toBe(false);
  });
});

describe("RedesignApp wiring", () => {
  it("the old Custom row is passed only to TEXT / WiFi devices of accounts with the new Live print pattern (with its note); every other new-sticker device gets the one size list (oneSize)", async () => {
    const fs = await import("node:fs");
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("customSize={oneStickerOn && !osSizeMode ? (() => {");
    expect(app).toContain('const osSizeMode = oneStickerOn && osDevicePath !== "text" && osDevicePath !== "wifi";');
    expect(app).toContain('const older = devPath === "text" || devPath === "wifi";');
    expect(app).toContain("allowed: !older && saved != null,");
    expect(app).toContain('reason: older ? "text" as const : saved == null ? "not_saved" as const : undefined,');
    expect(app).not.toContain('"niimbot" as const');
    expect(app).toContain("oneSize={osSizeMode && osSizeNow ? { current: osSizeNow, sizes: oneStickerSizesFor(osPrinterName), printerName: osPrinterName, onPick: onPickOneSize } : undefined}");
  });
});
