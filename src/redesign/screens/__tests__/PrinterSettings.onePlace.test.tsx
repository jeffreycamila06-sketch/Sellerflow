// ONE PLACE FOR THE STICKER SIZE (Jeff 2026-11-10) — Printer settings side.
// C1 Niimbot: Sticker size (with Custom) up to the printer's width, no "set it in LIVE print pattern" note.
// C2 Laptop / web: Sticker size (with Custom) — the same list as the phone.
// C3 One list: 50×30 · 60×40 · 70×50 · 80×50 · 80×60 · 100×60 · Custom (30–110 mm), none wider than the printer.
// D  QR note below 50×30, too-wide message, a saved Custom shows as is.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import PrinterSettings, { type PsOneSize } from "../PrinterSettings";
import { TProvider } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";
import { oneStickerSizesFor } from "../../adapters/oneStickerPrint";

const noop = () => {};
afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });
const appShell = () => { (window as unknown as { Capacitor?: unknown }).Capacitor = {}; };
function renderPS(oneSize: PsOneSize | undefined, o: { open?: boolean; psType?: "bt" | "wifi"; sizeOnWifiTab?: boolean } = {}) {
  return render(
    <TProvider lang="en">
      <PrinterSettings onBack={noop} psType={o.psType ?? "bt"} psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={o.open ?? true}
        onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} oneSize={oneSize} sizeOnWifiTab={o.sizeOnWifiTab} />
    </TProvider>,
  );
}
const one = (printerName: string | null, current: PsOneSize["current"] = { w: 60, h: 40 }) =>
  ({ current, sizes: oneStickerSizesFor(printerName), printerName, onPick: vi.fn<(w: number, h: number) => void>() });
const listed = () => Array.from(document.querySelectorAll("[data-testid^='ps-size-opt-']")).map((e) => e.getAttribute("data-testid")!.replace("ps-size-opt-", ""));

describe("Printer settings → Sticker size: one list for the new sticker", () => {
  it("C3: AIMO / XP-420B / Flash: 50×30 → 100×60 + Custom, in that order", () => {
    appShell();
    for (const n of ["D520BT-Z", "XP-420B", "Y41BT-0FC4_LE"]) {
      const r = renderPS(one(n));
      expect(listed(), n).toEqual(["50x30", "60x40", "70x50", "80x50", "80x60", "100x60"]);
      expect(screen.getByTestId("ps-size-custom")).toBeTruthy();
      r.unmount();
    }
  });
  it("C1: Niimbot B1 / B21 → 50×30 + Custom; B3S → up to 70×50 + Custom; no 'set it in LIVE print pattern' note", () => {
    appShell();
    let r = renderPS(one("B1-H1", { w: 50, h: 30 }));
    expect(listed()).toEqual(["50x30"]);
    expect(screen.getByTestId("ps-size-custom")).toBeTruthy();
    expect(screen.queryByTestId("ps-custom-hidden")).toBeNull();
    expect(screen.queryByText(/Live print pattern/i)).toBeNull();
    r.unmount();
    r = renderPS(one("B21-C2", { w: 50, h: 30 }));
    expect(listed()).toEqual(["50x30"]);
    r.unmount();
    renderPS(one("B3S-P1", { w: 50, h: 30 }));
    expect(listed()).toEqual(["50x30", "60x40", "70x50"]);
  });
  it("C1: Niimbot Custom wider than the printer → the too-wide message, Save size off; 45×30 can be saved", () => {
    appShell();
    const o = one("B1-H1", { w: 50, h: 30 });
    renderPS(o);
    fireEvent.click(screen.getByTestId("ps-size-custom"));
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "60" } });
    fireEvent.change(screen.getByTestId("ps-custom-h"), { target: { value: "30" } });
    expect(screen.getByTestId("ps-custom-too-wide").textContent).toBe("Your B1 takes labels up to 50 mm wide — this size is wider.");
    expect((screen.getByTestId("ps-custom-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "45" } });
    fireEvent.click(screen.getByTestId("ps-custom-save"));
    expect(o.onPick).toHaveBeenCalledWith(45, 30);
  });
  it("C2: laptop / web (no app): the list + Custom instead of the 'printer driver' note", () => {
    renderPS(one(null, { w: 100, h: 60 }));
    expect(listed()).toEqual(["50x30", "60x40", "70x50", "80x50", "80x60", "100x60"]);
    expect(screen.getByTestId("ps-size-custom")).toBeTruthy();
    expect(screen.queryByText(/computer's printer settings/)).toBeNull();
    expect(screen.getByTestId("ps-size-current").textContent).toBe("100x60mm (Standard)");
  });
  it("C2: laptop on the WiFi tab: the Sticker size card is there too", () => {
    renderPS(one(null), { psType: "wifi", sizeOnWifiTab: true });
    expect(screen.getByTestId("ps-wifi-size-card")).toBeTruthy();
    expect(listed()).toEqual(["50x30", "60x40", "70x50", "80x50", "80x60", "100x60"]);
  });
  it("tap a size → onPick; the current size is marked; Custom → Save size sends W×H (30–110 mm rule)", () => {
    appShell();
    const o = one("D520BT-Z");
    renderPS(o);
    expect(screen.getByTestId("ps-size-opt-60x40").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("ps-size-opt-80x50"));
    expect(o.onPick).toHaveBeenLastCalledWith(80, 50);
    fireEvent.click(screen.getByTestId("ps-size-custom"));
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "25" } });
    expect(screen.getByTestId("ps-custom-err").textContent).toContain("30–110 mm");
    expect((screen.getByTestId("ps-custom-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ps-custom-w"), { target: { value: "62" } });
    fireEvent.click(screen.getByTestId("ps-custom-save"));
    expect(o.onPick).toHaveBeenLastCalledWith(62, 40);
  });
  it("D: a saved Custom shows as 'Custom W×H mm' (untouched); below 50×30 the QR note shows", () => {
    appShell();
    renderPS(one("D520BT-Z", { w: 40, h: 30, custom: true }), { open: false });
    expect(screen.getByTestId("ps-size-current").textContent).toBe("Custom 40×30 mm");
    expect(screen.getByTestId("ps-size-qr-note").textContent).toBe("QR needs a label at least 50×30 mm");
  });
  it("D: a saved size wider than the printer → the too-wide message (the size is kept until the seller picks)", () => {
    appShell();
    renderPS(one("B21-C2", { w: 100, h: 60 }), { open: false });
    expect(screen.getByTestId("ps-size-too-wide").textContent).toBe("Your B21 takes labels up to 50 mm wide — this size is wider.");
  });
  it("Custom W × H: one line, inputs full width and ≥ 44 px; every option ≥ 44 px", () => {
    appShell();
    renderPS(one("D520BT-Z"));
    for (const id of ["ps-size-opt-50x30", "ps-size-custom"]) expect(parseFloat((screen.getByTestId(id) as HTMLElement).style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(screen.getByTestId("ps-size-custom"));
    for (const id of ["ps-custom-w", "ps-custom-h"]) {
      const el = screen.getByTestId(id) as HTMLInputElement;
      expect(el.style.width).toBe("100%");
      expect(parseFloat(el.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
    expect((screen.getByTestId("ps-custom").firstElementChild as HTMLElement).style.gridTemplateColumns).toBe("minmax(0,1fr) auto minmax(0,1fr)");
  });
});

describe("RedesignApp wiring (source)", () => {
  const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("Change on the Live print pattern opens Printer settings (list open) and Back returns to the Live print pattern", () => {
    expect(app).toContain('onChangeSize={() => { setPsBack("printpattern"); setPsSizeOpen(true); setScreen("printersettings"); }}');
    expect(app).toContain("onBack={() => setScreen(psBack)}");
  });
  it("the Live print pattern gets the size from Printer settings (oneStickerSizeNow) — the same size every print uses", () => {
    expect(app).toContain("size={osSizeNow ?? { w: 100, h: 60 }}");
    expect(app).toContain("oneStickerSizeNow(pp, psSize, osDevicePath, osPrinterName)");
    expect(app).toContain("const r = pickOneStickerSize(w, h);");
  });
  it("accounts that don't see the new screen: no one size list, no Custom (today's Printer settings)", () => {
    expect(app).toContain('const osSizeMode = oneStickerOn && osDevicePath !== "text" && osDevicePath !== "wifi";');
    expect(app).toContain("oneSize={osSizeMode && osSizeNow ?");
    expect(app).toContain("customSize={oneStickerOn && !osSizeMode ?");
    expect(app).toContain('sizeOnWifiTab={oneStickerOn && (osDevicePath === "laptop" || (osDevicePath === "wifi" && psBack === "printpattern"))}');
  });
});
