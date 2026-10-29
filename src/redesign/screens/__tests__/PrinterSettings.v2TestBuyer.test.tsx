// Printer setup v2 — WHICH test buyer each route prints:
//   D520BT (AIMO)             → buildTestBuyer()   "Test Print" / "PRICE"   — byte-for-byte today's stream
//   listed generic (Flash)    → buildTestBuyerV2() "測試 Test Print" / "好 COMMENT / PRICE"
//   Niimbot (image)           → buildTestBuyerV2()
// The Chinese test buyer exists so a seller sees on paper whether CJK prints on a generic or
// Niimbot printer; the D520BT test sticker must never change (its TSPL goldens pin it).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";
import { __resetSavedPrinter } from "../../adapters/savedPrinter";
import { buildTestBuyer, buildTestBuyerV2, TEST_NAME_V2, TEST_COMMENT_V2, type BluetoothPrinterDevice } from "../../adapters/printerBridge";

const routed = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true, code: "", message: "" })));
const generic = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => new Uint8Array([1, 2, 3])));
const niimbot = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ w: 384, h: 240, rowBytes: 48, data: "", labelWidthMm: 50, labelHeightMm: 30 })));
vi.mock("../../adapters/printing", async (orig) => ({ ...(await orig() as object), printStickerBtRouted: routed, buildGenericStickerBytes: generic, buildNiimbotImage: niimbot }));
vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: async () => ({}), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
import PrinterSettings from "../PrinterSettings";

const noop = () => {};
const D520: BluetoothPrinterDevice = { id: "bluetooth:AA", address: "AA:AA", name: "D520BT-Z", transport: "ble", model: "D520BT", likely: true };
const Y41: BluetoothPrinterDevice = { id: "bluetooth:BB", address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", likely: true };
const NIIMBOT: BluetoothPrinterDevice = { id: "bluetooth:NN", address: "NN:NN", name: "B1-I603042141", transport: "ble", model: "generic", likely: false };

function installBridge() {
  const b = {
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [D520, Y41, NIIMBOT] })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    clearBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async (p: BluetoothPrinterDevice) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    testGenericPrinter: vi.fn(async () => { throw new Error("never called"); }), // marks a build new enough for v2
    printStickerImage: vi.fn(async () => ({ ok: true, confirmed: true })),
  };
  (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = b;
  return b;
}
afterEach(() => { delete (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter; __resetSavedPrinter(); routed.mockClear(); generic.mockClear(); niimbot.mockClear(); });

const renderBT = () => render(
  <TProvider lang="en">
    <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={false}
      onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} flowV2 />
  </TProvider>,
);
const scan = async () => { await waitFor(() => expect((screen.getByTestId("ps-scan") as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByTestId("ps-scan")); await screen.findByText(/D520BT-Z/); };
type Buyer = { num: number; name: string; handle: string; orders: { item: string }[] };

describe("v2 test buyer per route", () => {
  it("the two builders: D520BT's is unchanged; v2 carries Chinese FIRST in the name and the comment", () => {
    const d = buildTestBuyer(), v = buildTestBuyerV2();
    expect([d.num, d.name, d.handle, d.orders[0].item, d.orders[0].price]).toEqual([88, "Test Print", "sellerflow", "PRICE", 350]);
    expect([v.num, v.name, v.handle, v.orders[0].item, v.orders[0].price]).toEqual([88, TEST_NAME_V2, "sellerflow", TEST_COMMENT_V2, 350]);
    expect(TEST_NAME_V2.startsWith("測試")).toBe(true);     // Chinese first → still visible after "…" next to the QR
    expect(TEST_COMMENT_V2.startsWith("好")).toBe(true);
    expect(v.orders[0].name).toBe(TEST_NAME_V2);
  });
  it("D520BT (known): today's test buyer through the routed D520 path — never the Chinese one", async () => {
    installBridge(); renderBT(); await scan();
    fireEvent.click(screen.getByText("D520BT-Z"));
    await waitFor(() => expect(routed).toHaveBeenCalledTimes(1));
    const b = routed.mock.calls[0][0] as Buyer;
    expect([b.name, b.orders[0].item]).toEqual(["Test Print", "PRICE"]);
    expect(generic).not.toHaveBeenCalled(); expect(niimbot).not.toHaveBeenCalled();
  });
  it("listed generic model (known): the Chinese test buyer through the routed generic path", async () => {
    installBridge(); renderBT(); await scan();
    fireEvent.click(screen.getByText("Y41BT-0FC4_LE"));
    await waitFor(() => expect(routed).toHaveBeenCalledTimes(1));
    const b = routed.mock.calls[0][0] as Buyer;
    expect([b.name, b.orders[0].item]).toEqual([TEST_NAME_V2, TEST_COMMENT_V2]);
  });
  it("Niimbot: the Chinese test buyer through the routed path (the saved Niimbot driver)", async () => {
    installBridge(); renderBT(); await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    await waitFor(() => expect(routed).toHaveBeenCalledTimes(1));
    const b = routed.mock.calls[0][0] as Buyer;
    expect([b.name, b.orders[0].item]).toEqual([TEST_NAME_V2, TEST_COMMENT_V2]);
    expect(generic).not.toHaveBeenCalled(); expect(niimbot).not.toHaveBeenCalled(); // the route owns the image build
  });
});
