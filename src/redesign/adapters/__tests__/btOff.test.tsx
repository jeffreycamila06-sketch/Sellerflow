// BLUETOOTH-OFF print failures → ONE simple modal per burst (JS-only).
// Every real native reject shape (iOS, Android BLE, Android Classic) is driven
// through the REAL printing.ts failure path into the modal hook.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";
import { isBluetoothOff, shouldOpenBtOff, useBtOffModal, BT_OFF_BURST_MS } from "../btOff";
import { printStickerBtRouted, setNativePrintFailureHandler, DEF_SETTINGS } from "../printing";
import { buildTestBuyer } from "../printerBridge";
import { TProvider } from "../../i18n";
import BtOffModal from "../../components/BtOffModal";

const IOS = { code: "BT_OFF", message: "Bluetooth is off. Turn it on in Control Center and try again." };
const ANDROID_BLE = { code: "BT_OFF", message: "Bluetooth is off. Turn it on then try again." };
const ANDROID_CLASSIC = { code: "BT_PRINT_FAILED", message: "Bluetooth print failed: Bluetooth is off" };
const ANDROID_SCAN = { code: "BT_DISABLED", message: "Bluetooth is off. Turn it on in Android Settings then try again." };
const LEGACY_NO_CODE = { code: "", message: "Bluetooth is turned off" };
const NON_BT = [
  { code: "BT_NOT_SET", message: "No Bluetooth printer saved. Tap Scan in Settings and pick a printer first." },
  { code: "BT_PERMISSION", message: "Bluetooth permission needed. Allow it then print again." },
  { code: "BT_PRINT_FAILED", message: "Bluetooth print failed: read failed, socket might closed or timeout" },
  { code: "BT_BUSY", message: "Printer is busy." },
  { code: "BT_NOT_FOUND", message: "Printer not found." },
  { code: "PRINTER_NOT_SET", message: "No WiFi printer saved." },
  { code: "", message: "" },
];

describe("isBluetoothOff (pure)", () => {
  it("every Bluetooth-OFF variant matches", () => {
    for (const v of [IOS, ANDROID_BLE, ANDROID_CLASSIC, ANDROID_SCAN, LEGACY_NO_CODE]) expect(isBluetoothOff(v.code, v.message), v.message).toBe(true);
    expect(isBluetoothOff("", "Bitmap sticker failed: Bluetooth is off. Turn it on then try again.")).toBe(true);
  });
  it("non-Bluetooth-off failures do NOT match", () => {
    for (const v of NON_BT) expect(isBluetoothOff(v.code, v.message), v.code).toBe(false);
  });
  it("burst gate: opens only when closed AND outside the burst window", () => {
    expect(shouldOpenBtOff(false, null, 1000)).toBe(true);
    expect(shouldOpenBtOff(true, null, 1000)).toBe(false);
    expect(shouldOpenBtOff(false, 1000, 1000 + BT_OFF_BURST_MS)).toBe(false);
    expect(shouldOpenBtOff(false, 1000, 1001 + BT_OFF_BURST_MS)).toBe(true);
  });
});

describe("real print failure path → modal", () => {
  let clock = 1_000_000;
  const hook = () => {
    const h = renderHook(() => useBtOffModal(() => clock));
    setNativePrintFailureHandler(({ code, message }) => h.result.current.report(code, message));
    return h;
  };
  const bridgeRejecting = (err: unknown) => {
    (window as unknown as { SellerFlowPrinter: unknown }).SellerFlowPrinter = { printStickerNative: vi.fn().mockRejectedValue(err) };
  };
  const print = () => act(async () => { await printStickerBtRouted(buildTestBuyer(), "NT$", "Shop", DEF_SETTINGS); });
  beforeEach(() => { clock = 1_000_000; vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { setNativePrintFailureHandler(null); delete (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter; vi.restoreAllMocks(); });

  for (const [name, err] of [["iOS", IOS], ["Android BLE", ANDROID_BLE], ["Android Classic", ANDROID_CLASSIC]] as const) {
    it(`${name} reject → modal opens; print reports not-printed (order untouched)`, async () => {
      const h = hook();
      bridgeRejecting(err);
      let r: { ok: boolean } | undefined;
      await act(async () => { r = await printStickerBtRouted(buildTestBuyer(), "NT$", "Shop", DEF_SETTINGS); });
      expect(h.result.current.open).toBe(true);
      expect(r?.ok).toBe(false); // → the existing "Not printed" + Reprint path is fed as before
      expect(console.warn).not.toHaveBeenCalled(); // consumed (no more silent console.warn)
    });
  }

  it("a resolved {ok:false} with the Classic message also opens it", async () => {
    const h = hook();
    (window as unknown as { SellerFlowPrinter: unknown }).SellerFlowPrinter = { printStickerNative: vi.fn().mockResolvedValue({ ok: false, message: "Bluetooth print failed: Bluetooth is off" }) };
    await print();
    expect(h.result.current.open).toBe(true);
  });

  it("burst: 3 failed stickers in a row → ONE modal; OK mid-burst does not reopen; a later burst does", async () => {
    const h = hook();
    bridgeRejecting(IOS);
    await print(); clock += 2000; await print(); clock += 2000; await print();
    expect(h.result.current.open).toBe(true);
    act(() => h.result.current.close());
    clock += 3000; await print(); // same burst (within 15s of the last failure)
    expect(h.result.current.open).toBe(false);
    clock += BT_OFF_BURST_MS + 1; await print(); // a new burst
    expect(h.result.current.open).toBe(true);
  });

  it("non-Bluetooth failures → NO modal and the legacy path is unchanged (not consumed)", async () => {
    const h = hook();
    for (const v of NON_BT) {
      bridgeRejecting(v);
      await print();
      expect(h.result.current.open, v.code).toBe(false);
    }
    expect(console.warn).toHaveBeenCalled(); // unconsumed → legacy console.warn as before
  });
});

describe("BtOffModal", () => {
  it("Filipino: title + one line + ONE button (OK) that closes; Bluetooth-off icon", () => {
    const onClose = vi.fn();
    render(<TProvider lang="fil"><BtOffModal onClose={onClose} /></TProvider>);
    const m = screen.getByTestId("bt-off-modal");
    expect(m.textContent).toContain("Naka-off ang Bluetooth");
    expect(m.textContent).toContain("Patay ang Bluetooth ng phone mo. I-on mo muna para makapag-print.");
    expect(m.querySelectorAll("button").length).toBe(1);
    expect(m.querySelector("svg")).toBeTruthy();
    fireEvent.click(screen.getByTestId("bt-off-ok"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("wiring + 'Saved' label", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("the ONE native failure handler checks Bluetooth-off FIRST (before the no-printer modal), on every screen", () => {
    const i = app.indexOf("if (reportBtOff(code, message)) return true;");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(app.indexOf("if (!isPrinterNotSetup(code, message)) return false;"));
    expect(app).toContain("{btOff.open && <BtOffModal onClose={btOff.close} />}");
  });
  it("display-only: the Bluetooth-off code never touches orders/DB", () => {
    const src = readFileSync("src/redesign/adapters/btOff.ts", "utf8");
    expect(src).not.toMatch(/supabase|createOrder|saveOrder|db"|printSlip|printSticker/);
  });
  it("Settings shows 'Saved' (never 'Connected') for a saved Bluetooth printer; LAN keeps its ping status", () => {
    const gs = readFileSync("src/redesign/screens/GeneralSettings.tsx", "utf8");
    expect(gs).toContain('s === "saved" ? t.rd_ps_bt_saved_state');
    const st = readFileSync("src/redesign/adapters/usePrinterStatus.ts", "utf8");
    expect(st).toContain('return hasBridge && !!savedPrinter ? "saved" : "disconnected";');
    expect(st).toContain('return hasBridge && !!host && pingOk ? "connected" : "disconnected";');
  });
});
