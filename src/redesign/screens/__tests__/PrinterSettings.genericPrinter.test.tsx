// Generic BLE label printers (Phase 1, test-gated): the picker shows generic printers,
// "(Test)" and "show all Bluetooth" ONLY for admin / the test_printers list on an app build
// with the native testGenericPrinter method; a generic printer is saved only after a test
// print the seller confirms. Normal sellers see exactly today's picker.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PrinterSettings from "../PrinterSettings";
import { TProvider, buildT } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";
import { testPrintersEnabled, genericDebugLine, isGenericRow, isPrinterRow, type BluetoothPrinterDevice } from "../../adapters/printerBridge";
import { FEATURE_KEYS } from "../../adapters/featureAccess";

const t = buildT("en") as unknown as Record<string, string>;
const noop = () => {};
const D520: BluetoothPrinterDevice = { id: "bluetooth:AA", address: "AA:AA", name: "D520BT-Z", transport: "ble", model: "D520BT", likely: true };
const Y41: BluetoothPrinterDevice = { id: "bluetooth:BB", address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", likely: true };
const PHONE: BluetoothPrinterDevice = { id: "bluetooth:CC", address: "CC:CC", name: "Some Watch", transport: "ble", model: "generic", likely: false };

type Bridge = Record<string, ReturnType<typeof vi.fn>>;
function installBridge(opts: { generic?: boolean; test?: () => Promise<unknown> } = {}): Bridge {
  const b: Bridge = {
    scanBluetoothLabelPrinters: vi.fn(async (o?: { showAllDevices?: boolean }) => ({ ok: true, printers: o?.showAllDevices ? [D520, Y41, PHONE] : [D520, Y41] })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async (p: BluetoothPrinterDevice) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
    getPrinter: vi.fn(async () => ({ ok: false })),
  };
  if (opts.generic !== false) b.testGenericPrinter = vi.fn(opts.test ?? (async () => ({ ok: true, confirmed: true, statusHex: "5353", service: "FF00", characteristic: "FF02" })));
  (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = b;
  return b;
}
afterEach(() => { delete (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter; });

const renderBT = (props: { testPrinters?: boolean; isAdmin?: boolean } = {}) =>
  render(
    <TProvider lang="en">
      <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={false}
        onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} {...props} />
    </TProvider>,
  );
const scan = async () => { fireEvent.click(screen.getByText(new RegExp(t.rd_ps_scan))); await screen.findByText(/D520BT-Z/); };

describe("gate flag", () => {
  it("false for a normal seller; true for admin or the test_printers list", () => {
    expect(testPrintersEnabled(false, false)).toBe(false);
    expect(testPrintersEnabled(true, false)).toBe(true);
    expect(testPrintersEnabled(false, true)).toBe(true);
    expect(FEATURE_KEYS).toContain("test_printers");
  });
  it("row helpers", () => {
    expect(isGenericRow(Y41)).toBe(true);
    expect(isGenericRow(D520)).toBe(false);
    expect(isGenericRow({ ...Y41, transport: "spp" })).toBe(false);
    expect(isPrinterRow(Y41)).toBe(true);
    expect(isPrinterRow(PHONE)).toBe(false);
    expect(isPrinterRow({ ...PHONE, paired: true })).toBe(true);
  });
  it("debug line = printer data only", () => {
    expect(genericDebugLine({ confirmed: false, service: "FF00", characteristic: "FF02", statusHex: "" })).toBe("confirmed: no · via FF00/FF02 · status: none");
  });
});

describe("normal seller: today's picker", () => {
  it("scans without options, no (Test), no show-all", async () => {
    const b = installBridge();
    renderBT();
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith();
    expect(screen.queryByText(new RegExp(`\\${t.rd_ps_gen_tag.slice(0, -1)}`))).toBeNull();
    expect(screen.queryByTestId("ps-gen-show-all")).toBeNull();
    expect(screen.queryByText(t.rd_ps_gen_section)).toBeNull();
  });
  it("gated account on an old app (no testGenericPrinter) also gets today's picker", async () => {
    const b = installBridge({ generic: false });
    renderBT({ testPrinters: true, isAdmin: true });
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith();
    expect(screen.queryByTestId("ps-gen-show-all")).toBeNull();
  });
});

describe("gated (admin / test_printers)", () => {
  it("asks for generic printers, labels them (Test), and 'show all' rescans with showAllDevices", async () => {
    const b = installBridge();
    renderBT({ testPrinters: true });
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith({ includeGenericPrinters: true, showAllDevices: false });
    expect(screen.getByText(t.rd_ps_gen_section)).toBeTruthy();
    expect(screen.getByText(`Y41BT-0FC4_LE ${t.rd_ps_gen_tag}`)).toBeTruthy();
    expect(screen.getByText("D520BT-Z")).toBeTruthy(); // D520BT row unchanged — no tag
    expect(screen.queryByText(/Some Watch/)).toBeNull();
    fireEvent.click(screen.getByTestId("ps-gen-show-all"));
    await screen.findByText(/Some Watch/);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenLastCalledWith({ includeGenericPrinters: true, showAllDevices: true });
  });

  it("D520BT row still saves at once (unchanged)", async () => {
    const b = installBridge();
    renderBT({ testPrinters: true });
    await scan();
    fireEvent.click(screen.getByText("D520BT-Z"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "AA:AA", name: "D520BT-Z", transport: "ble" }));
  });

  it("generic: test print → Yes saves it as generic", async () => {
    const b = installBridge();
    renderBT({ testPrinters: true });
    await scan();
    fireEvent.click(screen.getByText(`Y41BT-0FC4_LE ${t.rd_ps_gen_tag}`));
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ps-gen-test"));
    await screen.findByText(t.rd_ps_gen_ask);
    expect(b.testGenericPrinter).toHaveBeenCalledWith(expect.objectContaining({ address: "BB:BB", payload: expect.objectContaining({ labelWidthMm: 60, labelHeightMm: 40 }) }));
    expect(screen.queryByTestId("ps-gen-debug")).toBeNull(); // not admin
    fireEvent.click(screen.getByTestId("ps-gen-yes"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic" }));
  });

  it("generic: No → not saved + 'not compatible'", async () => {
    const b = installBridge();
    renderBT({ testPrinters: true });
    await scan();
    fireEvent.click(screen.getByText(`Y41BT-0FC4_LE ${t.rd_ps_gen_tag}`));
    fireEvent.click(screen.getByTestId("ps-gen-test"));
    fireEvent.click(await screen.findByTestId("ps-gen-no"));
    expect(await screen.findByText(t.rd_ps_gen_incompatible)).toBeTruthy();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("BT_NOT_SUPPORTED → 'not supported yet', nothing saved", async () => {
    const b = installBridge({ test: async () => { throw Object.assign(new Error("This printer is not supported yet."), { code: "BT_NOT_SUPPORTED" }); } });
    renderBT({ testPrinters: true });
    await scan();
    fireEvent.click(screen.getByText(`Y41BT-0FC4_LE ${t.rd_ps_gen_tag}`));
    fireEvent.click(screen.getByTestId("ps-gen-test"));
    expect(await screen.findByText(t.rd_ps_gen_unsupported)).toBeTruthy();
    expect(screen.queryByTestId("ps-gen-yes")).toBeNull();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("admin sees the debug line after a generic print", async () => {
    installBridge();
    renderBT({ testPrinters: true, isAdmin: true });
    await scan();
    fireEvent.click(screen.getByText(`Y41BT-0FC4_LE ${t.rd_ps_gen_tag}`));
    fireEvent.click(screen.getByTestId("ps-gen-test"));
    expect((await screen.findByTestId("ps-gen-debug")).textContent).toBe("confirmed: yes · via FF00/FF02 · status: 5353");
  });
});
