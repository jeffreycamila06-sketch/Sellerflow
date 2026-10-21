// Printer setup v2 ("no switch, fewer taps") — the Printer settings screen:
//   gate OFF (or an app without the generic method) = today's screen, byte-for-byte behaviour;
//   gate ON = printers only, ✓ Works with SFL / New pills, known → save + auto test sticker,
//   new → test (TSPL) → ask → retry (ESC/POS) → ask → not supported + Contact Admin.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PrinterSettings from "../PrinterSettings";
import { TProvider, buildT } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";
import { __resetSavedPrinter } from "../../adapters/savedPrinter";
import { FEATURE_KEYS } from "../../adapters/featureAccess";
import { FEATURE_SWITCH_KEYS } from "../../adapters/featureSwitches";
import { TELEGRAM_URL } from "../../../lib/telegram";
import type { BluetoothPrinterDevice } from "../../adapters/printerBridge";

vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: async () => ({}), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));

const t = buildT("en") as unknown as Record<string, string>;
const noop = () => {};
const D520: BluetoothPrinterDevice = { id: "bluetooth:AA", address: "AA:AA", name: "D520BT-Z", transport: "ble", model: "D520BT", likely: true };
const Y41: BluetoothPrinterDevice = { id: "bluetooth:BB", address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", likely: true };
const NEW: BluetoothPrinterDevice = { id: "bluetooth:DD", address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", likely: true };
const WATCH: BluetoothPrinterDevice = { id: "bluetooth:CC", address: "CC:CC", name: "Some Watch", transport: "ble", model: "generic", likely: false, paired: true };

type Bridge = Record<string, ReturnType<typeof vi.fn>>;
function installBridge(opts: { generic?: boolean; test?: (a: unknown) => Promise<unknown> } = {}): Bridge {
  const b: Bridge = {
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [D520, Y41, NEW, WATCH] })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async (p: BluetoothPrinterDevice) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    printStickerNative: vi.fn(async () => ({ ok: true, confirmed: false })),
  };
  if (opts.generic !== false) b.testGenericPrinter = vi.fn(opts.test ?? (async () => ({ ok: true, confirmed: false, statusHex: "0107", service: "FF00", characteristic: "FF02" })));
  (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = b;
  return b;
}
afterEach(() => { delete (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter; __resetSavedPrinter(); });

const renderBT = (props: { flowV2?: boolean; isAdmin?: boolean; showClassicToggle?: boolean } = {}) =>
  render(
    <TProvider lang="en">
      <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={false}
        onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} {...props} />
    </TProvider>,
  );
const scan = async () => { fireEvent.click(screen.getByText(new RegExp(t.rd_ps_scan))); await screen.findByText(/D520BT-Z/); };

describe("gate", () => {
  it("keys exist: feature list + app_settings switch", () => {
    expect(FEATURE_KEYS).toContain("test_printers");
    expect(FEATURE_SWITCH_KEYS.printerFlowV2).toBe("printer_flow_v2");
  });
  it("OFF: today's screen — plain scan, no pills, rows save at once, Simple print card stays", async () => {
    const b = installBridge();
    renderBT({ showClassicToggle: true });
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith();
    expect(screen.queryByTestId("ps-v2-list")).toBeNull();
    expect(screen.queryByTestId("ps-v2-known")).toBeNull();
    expect(screen.getByText(t.rd_ps_classic_text)).toBeTruthy();
    expect(screen.getByText(/Some Watch/)).toBeTruthy(); // today's list shows every row the native side returned
    fireEvent.click(screen.getByText("D520BT-Z"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "AA:AA", name: "D520BT-Z", transport: "ble" }));
    expect(b.printStickerNative).not.toHaveBeenCalled(); // no auto test sticker on today's screen
  });
  it("ON but an old app (no generic method) → today's screen too", async () => {
    const b = installBridge({ generic: false });
    renderBT({ flowV2: true, isAdmin: true, showClassicToggle: true });
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith();
    expect(screen.queryByTestId("ps-v2-list")).toBeNull();
    expect(screen.getByText(t.rd_ps_classic_text)).toBeTruthy();
  });
});

describe("v2 scan list", () => {
  it("printers only, with pills; no (Test) tag, no show-all, no Simple print card", async () => {
    const b = installBridge();
    renderBT({ flowV2: true, showClassicToggle: true });
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith({ includeGenericPrinters: true, showAllDevices: false });
    expect(screen.getAllByTestId("ps-v2-row")).toHaveLength(3);
    expect(screen.queryByText(/Some Watch/)).toBeNull(); // paired, but not a printer
    expect(screen.getAllByTestId("ps-v2-known")).toHaveLength(2); // D520BT + Y41BT
    expect(screen.getAllByTestId("ps-v2-new")).toHaveLength(1);
    expect(screen.getByTestId("ps-v2-new").textContent).toBe(t.rd_ps_v2_new);
    expect(screen.getAllByTestId("ps-v2-known")[0].textContent).toBe(t.rd_ps_v2_works);
    expect(screen.queryByText(/\(Test\)/)).toBeNull();
    expect(screen.queryByText(/Show all Bluetooth/)).toBeNull();
    expect(screen.queryByText(t.rd_ps_classic_text)).toBeNull();
  });
  it("nothing found → a plain note", async () => {
    const b = installBridge();
    b.scanBluetoothLabelPrinters.mockResolvedValue({ ok: true, printers: [WATCH] });
    renderBT({ flowV2: true });
    fireEvent.click(screen.getByText(new RegExp(t.rd_ps_scan)));
    expect(await screen.findByText(t.rd_ps_v2_none)).toBeTruthy();
  });
});

describe("v2 known printer", () => {
  it("D520BT: saved at once (same call as today) + one test sticker, no question", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("D520BT-Z"));
    expect(await screen.findByText(t.rd_ps_v2_saved_testing)).toBeTruthy();
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "AA:AA", name: "D520BT-Z", transport: "ble" }));
    await waitFor(() => expect(b.printStickerNative).toHaveBeenCalledTimes(1));
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
    expect(await screen.findByText(t.rd_ps_test_sent)).toBeTruthy();
    expect(screen.queryByTestId("ps-v2-ask")).toBeNull();
  });
  it("Y41BT: saved as generic/tspl + one test sticker through the real-order route", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("Y41BT-0FC4_LE"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", lang: "tspl" }));
    await waitFor(() => expect(b.printStickerNative).toHaveBeenCalledTimes(1)); // generic + tspl = the TEXT sticker
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ps-v2-ask")).toBeNull();
  });
});

describe("v2 new printer", () => {
  it("test (TSPL) → ask → Yes saves generic/tspl; nothing saved before", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(1);
    expect(b.testGenericPrinter).toHaveBeenCalledWith(expect.objectContaining({ address: "DD:DD", payload: expect.objectContaining({ labelWidthMm: 60, labelHeightMm: 40 }) }));
    expect((b.testGenericPrinter.mock.calls[0][0] as { data?: string }).data).toBeUndefined();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    expect(screen.getByTestId("pp-exact-preview")).toBeTruthy(); // the picture of the correct sticker
    expect(screen.queryByTestId("ps-v2-debug")).toBeNull(); // not admin
    fireEvent.click(screen.getByTestId("ps-v2-yes"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", lang: "tspl" }));
    expect(await screen.findByText(t.rd_ps_bt_saved)).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(1); // never re-sent
  });

  it("No → retries once in ESC/POS (raw bytes) → ask → Yes saves generic/escpos", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    await waitFor(() => expect(b.testGenericPrinter).toHaveBeenCalledTimes(2));
    const second = b.testGenericPrinter.mock.calls[1][0] as { address: string; data?: string; payload?: unknown };
    expect(second.address).toBe("DD:DD");
    expect(second.payload).toBeUndefined();
    const bytes = Buffer.from(second.data || "", "base64");
    expect(Array.from(bytes.subarray(0, 6))).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00]); // ESC @ + GS v 0
    expect(bytes.includes(Buffer.from("SIZE "))).toBe(false);
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ps-v2-yes"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", lang: "escpos" }));
  });

  it("No twice → not supported yet + Contact Admin (a real Telegram anchor); nothing saved", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    expect(await screen.findByText(t.rd_ps_gen_unsupported)).toBeTruthy();
    const a = screen.getByTestId("ps-v2-contact") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(2); // TSPL, ESC/POS — and no more
  });

  it("a printer with nothing to write to (BT_NOT_SUPPORTED) skips the question and ends unsupported", async () => {
    const b = installBridge({ test: async () => { throw Object.assign(new Error("not supported"), { code: "BT_NOT_SUPPORTED" }); } });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    expect(await screen.findByText(t.rd_ps_gen_unsupported)).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("ps-v2-ask")).toBeNull();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("admin sees the debug line after a test print", async () => {
    installBridge();
    renderBT({ flowV2: true, isAdmin: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    expect((await screen.findByTestId("ps-v2-debug")).textContent).toBe("confirmed: no · via FF00/FF02 · status: 0107");
  });
});
