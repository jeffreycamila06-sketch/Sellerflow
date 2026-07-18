// P5 pairing fix — the WEB half of "tap a discovered PM-241 must pair in-app,
// never silently": the tap on an UNPAIRED discovery row must call
// bondBluetoothDevice with the address, a failed/timed-out bond must show the
// native message PLUS the localized Settings fallback (never silence), and a
// successful bond must proceed to setBluetoothLabelPrinter (save). A PAIRED row
// keeps the original save-directly path (AIMO flow untouched).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import PrinterSettings from "../PrinterSettings";

type BridgeFns = Record<string, (...a: unknown[]) => Promise<unknown>>;

const NEARBY = { id: "bluetooth:AA", address: "AA:BB:CC:DD:EE:FF", name: "PM-241-9F21", paired: false };
const PAIRED = { id: "bluetooth:BB", address: "11:22:33:44:55:66", name: "PM-241-OLD", paired: true };

function installBridge(over: Partial<BridgeFns> = {}): BridgeFns {
  const bridge: BridgeFns = {
    // presence gates: hasNativePrinter / hasBtBridge / hasDiscoverBridge
    printSlip: vi.fn(async () => ({ ok: true })),
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [] })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, message: "saved", savedPrinter: NEARBY })),
    discoverBluetoothPrinters: vi.fn(async () => ({ ok: true, printers: [NEARBY, PAIRED], message: "" })),
    bondBluetoothDevice: vi.fn(async () => ({ ok: true, bonded: true, message: "Paired successfully." })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    ...over,
  };
  (window as unknown as { SellerFlowPrinter?: BridgeFns }).SellerFlowPrinter = bridge;
  return bridge;
}

const renderPs = () =>
  render(
    <TProvider lang="en">
      <PrinterSettings
        onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}}
        psSize="60x40mm" psSizeOpen={false} onTogglePsSize={() => {}} onPickPsSize={() => {}}
      />
    </TProvider>
  );

async function discoverAndGetRow(getByText: (t: string) => HTMLElement) {
  fireEvent.click(getByText(/Find nearby|nearby printers/i));
  await waitFor(() => getByText("PM-241-9F21"));
  return getByText("PM-241-9F21");
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => {
  cleanup();
  delete (window as unknown as { SellerFlowPrinter?: BridgeFns }).SellerFlowPrinter;
});

describe("P5 — tap a discovered (unpaired) printer pairs in-app", () => {
  it("tap -> bondBluetoothDevice(address) -> save on success", async () => {
    const bridge = installBridge();
    const { getByText } = renderPs();
    const row = await discoverAndGetRow(getByText as (t: string) => HTMLElement);
    fireEvent.click(row);
    await waitFor(() => expect(bridge.bondBluetoothDevice).toHaveBeenCalledWith({ address: NEARBY.address }));
    await waitFor(() => expect(bridge.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: NEARBY.address, name: NEARBY.name }));
  });

  it("failed bond is NEVER silent: native message + localized Settings fallback, no save", async () => {
    const bridge = installBridge({
      bondBluetoothDevice: vi.fn(async () => ({ ok: false, bonded: false, message: "No pairing window appeared (or it timed out)." })),
    });
    const { getByText, queryByText } = renderPs();
    const row = await discoverAndGetRow(getByText as (t: string) => HTMLElement);
    fireEvent.click(row);
    await waitFor(() => expect(queryByText(/No pairing window appeared/)).not.toBeNull());
    // the localized fallback instruction is APPENDED (rd_ps_pair_fallback en)
    expect(queryByText(/Android Settings/)).not.toBeNull();
    expect(bridge.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("bond reject (btCall catch shape) also surfaces its message + fallback", async () => {
    const bridge = installBridge({
      bondBluetoothDevice: vi.fn(async () => { throw Object.assign(new Error("Bluetooth permission needed. Allow it then tap Pair again."), { code: "BT_PERMISSION" }); }),
    });
    const { getByText, queryByText } = renderPs();
    const row = await discoverAndGetRow(getByText as (t: string) => HTMLElement);
    fireEvent.click(row);
    await waitFor(() => expect(queryByText(/Bluetooth permission needed/)).not.toBeNull());
    expect(bridge.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("a PAIRED row skips the bond entirely (AIMO save-directly flow untouched)", async () => {
    const bridge = installBridge();
    const { getByText } = renderPs();
    fireEvent.click(getByText(/Find nearby|nearby printers/i));
    await waitFor(() => getByText("PM-241-OLD"));
    fireEvent.click(getByText("PM-241-OLD"));
    await waitFor(() => expect(bridge.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: PAIRED.address, name: PAIRED.name }));
    expect(bridge.bondBluetoothDevice).not.toHaveBeenCalled();
  });
});
