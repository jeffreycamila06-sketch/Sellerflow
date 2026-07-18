// SINGLE-SCAN + P5 pairing — Jeff's UX verdict: ONE "Scan" button that (1)
// lists the BONDED printers first (the old AIMO flow, same native call), then
// (2) appends nearby-unpaired discovery to the SAME list (sticker-printer name
// filter so neighbours' phones/TVs never show). Tapping a BONDED row saves
// directly (unchanged); tapping a NEW row runs the in-app bond flow (dialog /
// notification -> bond -> auto-save), never silently. On an old binary / iOS
// (no discovery bridge) the button IS the old bonded-only Scan.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import PrinterSettings from "../PrinterSettings";
import { isLikelyStickerPrinter } from "../../adapters/printerBridge";

type BridgeFns = Record<string, (...a: unknown[]) => Promise<unknown>>;

const NEARBY = { id: "bluetooth:AA", address: "AA:BB:CC:DD:EE:FF", name: "PM-241-9F21", paired: false };
const PAIRED = { id: "bluetooth:BB", address: "11:22:33:44:55:66", name: "D520BT-AIMO", paired: true };
const JUNK_TV = { id: "bluetooth:CC", address: "77:88:99:AA:BB:CC", name: "Samsung TV 55", paired: false };

function installBridge(over: Partial<BridgeFns> = {}, opts: { noDiscover?: boolean } = {}): BridgeFns {
  const bridge: BridgeFns = {
    printSlip: vi.fn(async () => ({ ok: true })),
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [PAIRED], message: "Found 1 paired printer" })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, message: "saved", savedPrinter: NEARBY })),
    discoverBluetoothPrinters: vi.fn(async () => ({ ok: true, printers: [NEARBY, JUNK_TV], message: "Found 2 nearby devices. Tap yours to pair it." })),
    bondBluetoothDevice: vi.fn(async () => ({ ok: true, bonded: true, message: "Paired successfully." })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    ...over,
  };
  if (opts.noDiscover) { delete bridge.discoverBluetoothPrinters; delete bridge.bondBluetoothDevice; }
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

const scanButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Scan"))!;

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => {
  cleanup();
  delete (window as unknown as { SellerFlowPrinter?: BridgeFns }).SellerFlowPrinter;
});

describe("single Scan — bonded + nearby in one list", () => {
  it("one tap lists bonded AND nearby (filtered) with distinct labels; no separate Find-nearby button", async () => {
    installBridge();
    const { container, getByText, queryByText } = renderPs();
    expect(queryByText(/Find nearby/i)).toBeNull();   // the separate button is gone
    fireEvent.click(scanButton(container));
    await waitFor(() => getByText("D520BT-AIMO"));    // bonded (phase 1)
    await waitFor(() => getByText("PM-241-9F21"));    // nearby (phase 2, same list)
    expect(getByText("Paired")).toBeTruthy();         // visual distinction
    expect(getByText("Nearby")).toBeTruthy();
    expect(queryByText("Samsung TV 55")).toBeNull();  // non-printer noise filtered
  });

  it("old binary / iOS (no discovery bridge): Scan behaves exactly as before (bonded-only)", async () => {
    const bridge = installBridge({}, { noDiscover: true });
    const { container, getByText } = renderPs();
    fireEvent.click(scanButton(container));
    await waitFor(() => getByText("D520BT-AIMO"));
    expect(bridge.scanBluetoothLabelPrinters).toHaveBeenCalledTimes(1);
    expect(getByText(/Found 1 paired printer/)).toBeTruthy();
  });

  it("isLikelyStickerPrinter: PM-2xx/D520/AIMO/printer/label pass, phones/TVs/blank fail", () => {
    for (const ok of ["PM-241-9F21", "pm-220", "D520BT-Z", "AIMO printer", "Label Maker X1", "Thermal Printer 9"]) {
      expect(isLikelyStickerPrinter(ok)).toBe(true);
    }
    for (const no of ["Samsung TV 55", "Redmi Note 12", "JBL Flip 6", "AA:BB:CC:DD:EE:FF", "", undefined]) {
      expect(isLikelyStickerPrinter(no as string | undefined)).toBe(false);
    }
  });
});

describe("tap behavior per row kind (the P5 pairing flow intact)", () => {
  it("NEW row: tap -> bondBluetoothDevice(address) -> auto-save", async () => {
    const bridge = installBridge();
    const { container, getByText } = renderPs();
    fireEvent.click(scanButton(container));
    await waitFor(() => getByText("PM-241-9F21"));
    fireEvent.click(getByText("PM-241-9F21"));
    await waitFor(() => expect(bridge.bondBluetoothDevice).toHaveBeenCalledWith({ address: NEARBY.address }));
    await waitFor(() => expect(bridge.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: NEARBY.address, name: NEARBY.name }));
  });

  it("BONDED row: tap saves directly — bond is never called (AIMO flow unchanged)", async () => {
    const bridge = installBridge();
    const { container, getByText } = renderPs();
    fireEvent.click(scanButton(container));
    await waitFor(() => getByText("D520BT-AIMO"));
    fireEvent.click(getByText("D520BT-AIMO"));
    await waitFor(() => expect(bridge.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: PAIRED.address, name: PAIRED.name }));
    expect(bridge.bondBluetoothDevice).not.toHaveBeenCalled();
  });

  it("failed bond is NEVER silent: native message + localized Settings fallback, no save", async () => {
    const bridge = installBridge({
      bondBluetoothDevice: vi.fn(async () => ({ ok: false, bonded: false, message: "No pairing window appeared (or it timed out)." })),
    });
    const { container, getByText, queryByText } = renderPs();
    fireEvent.click(scanButton(container));
    await waitFor(() => getByText("PM-241-9F21"));
    fireEvent.click(getByText("PM-241-9F21"));
    await waitFor(() => expect(queryByText(/No pairing window appeared/)).not.toBeNull());
    expect(queryByText(/Android Settings/)).not.toBeNull();   // rd_ps_pair_fallback appended
    expect(bridge.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("bond reject (btCall catch shape) also surfaces its message", async () => {
    const bridge = installBridge({
      bondBluetoothDevice: vi.fn(async () => { throw Object.assign(new Error("Bluetooth permission needed. Allow it then tap Pair again."), { code: "BT_PERMISSION" }); }),
    });
    const { container, getByText, queryByText } = renderPs();
    fireEvent.click(scanButton(container));
    await waitFor(() => getByText("PM-241-9F21"));
    fireEvent.click(getByText("PM-241-9F21"));
    await waitFor(() => expect(queryByText(/Bluetooth permission needed/)).not.toBeNull());
    expect(bridge.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });
});
