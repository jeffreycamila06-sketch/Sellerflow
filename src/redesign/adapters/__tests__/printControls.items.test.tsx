// Printer fix (Nov 3) — items 3 and 11, the two that the bitmap matrix cannot see:
//   3. a saved Niimbot shows "50×30 mm (fixed for this printer)" instead of the size picker;
//  11. a phone whose app lacks the generic / Niimbot print method gets a REASON ("Update the app to
//      print with this printer"), not a bare failure.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PrinterSettings from "../../screens/PrinterSettings";
import { TProvider, buildT } from "../../i18n";
import { printSlip, DEF_SETTINGS, PLUGIN_MISSING, setNativePrintFailureHandler, type Settings } from "../printing";
import { buildTestBuyer } from "../printerBridge";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";

vi.mock("../cjkAtlasLoader", () => ({ loadCjkAtlas: async () => ({}), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
const t = buildT("en") as unknown as Record<string, string>;
const noop = () => {};
type W = { SellerFlowPrinter?: unknown; Capacitor?: unknown };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
afterEach(() => { delete (window as W).SellerFlowPrinter; delete (window as W).Capacitor; __resetSavedPrinter(); setNativePrintFailureHandler(null); });

describe("item 3 — Niimbot: size is fixed at 50×30", () => {
  const view = () => render(
    <TProvider lang="en">
      <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={false}
        onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} />
    </TProvider>,
  );
  it("a saved Niimbot shows the fixed-size line, no size picker", () => {
    (window as W).Capacitor = {}; // the phone app — the size block only exists there (a laptop prints at the driver's paper size)
    (window as W).SellerFlowPrinter = { getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })) };
    rememberSavedPrinter({ address: "NN:NN", name: "B1-I603042141", model: "generic", transport: "niimbot" });
    view();
    expect(screen.getByTestId("ps-size-fixed").textContent).toBe(t.rd_ps_size_fixed_niimbot);
    expect(t.rd_ps_size_fixed_niimbot).toBe("50×30 mm (fixed for this printer)");
    expect(screen.queryByTestId("ps-size")).toBeNull();
  });
  it("any other saved printer keeps the size picker", () => {
    (window as W).Capacitor = {}; // the phone app — the size block only exists there (a laptop prints at the driver's paper size)
    (window as W).SellerFlowPrinter = { getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })) };
    rememberSavedPrinter({ address: "AA:AA", name: "D520BT-Z", model: "D520BT" });
    view();
    expect(screen.queryByTestId("ps-size-fixed")).toBeNull();
    expect(screen.getByTestId("ps-size")).toBeTruthy();
  });
});

describe("item 11 — missing print method = a reason, never a bare failure", () => {
  const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth" };
  it("generic printer, app without printRawTspl → PLUGIN_MISSING + 'Update the app…' reaches the failure handler", async () => {
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: vi.fn() }; // an older app shell
    const failures: { code: string; message: string }[] = [];
    setNativePrintFailureHandler(({ code, message }) => { failures.push({ code, message }); return true; });
    rememberSavedPrinter({ address: "BB:BB", name: "Y41BT-0FC4_LE", model: "generic", lang: "tspl" });
    printSlip(buildTestBuyer(), "NT$", "Store", cfg);
    await flush();
    expect(failures).toEqual([{ code: PLUGIN_MISSING, message: "Update the app to print with this printer." }]);
  });
  it("Niimbot, app without the Niimbot method → the same reason", async () => {
    (window as W).SellerFlowPrinter = { printStickerNative: vi.fn(), printStickerBitmap: vi.fn(), printRawTspl: vi.fn() };
    const failures: { code: string; message: string }[] = [];
    setNativePrintFailureHandler(({ code, message }) => { failures.push({ code, message }); return true; });
    rememberSavedPrinter({ address: "NN:NN", name: "B1-I603042141", model: "generic", transport: "niimbot" });
    printSlip(buildTestBuyer(), "NT$", "Store", cfg);
    await flush();
    expect(failures.map((f) => f.code)).toEqual([PLUGIN_MISSING]);
    expect(failures[0].message).toContain("Update the app");
  });
});
