// Printer setup v2 ("no switch, fewer taps") — the Printer settings screen:
//   gate OFF (or an app without the generic method) = today's screen, byte-for-byte behaviour;
//   gate ON = printers only (service OR name list), ✓ Works with SFL / New pills, known →
//   save + auto test sticker, new → one sticker per language (TSPL → ESC/POS → CPCL, each
//   "Did it look like this?") → not supported + Contact Admin; "Show all Bluetooth devices";
//   Niimbot by name → the vendor-SDK driver when the app has it (one test label, the 50×30 image,
//   "Did it look like this?", saved as transport niimbot; seller-level errors in plain words), else
//   not supported yet; classic (paired) rows on Android.
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
const NIIMBOT: BluetoothPrinterDevice = { id: "bluetooth:NN", address: "NN:NN", name: "B1-I603042141", transport: "ble", model: "generic", likely: false }; // advertises no printer service
const CLASSIC: BluetoothPrinterDevice = { id: "bluetooth:EE", address: "EE:EE", name: "XP-P323B", transport: "spp", model: "generic", likely: false, paired: true }; // Android paired receipt printer

type Bridge = Record<string, ReturnType<typeof vi.fn>>;
function installBridge(opts: { generic?: boolean; niimbot?: boolean; test?: (a: unknown) => Promise<unknown> } = {}): Bridge {
  const b: Bridge = {
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [D520, Y41, NEW, WATCH, NIIMBOT, CLASSIC] })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async (p: BluetoothPrinterDevice) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    printStickerNative: vi.fn(async () => ({ ok: true, confirmed: false })),
    printStickerBitmap: vi.fn(async () => ({ ok: true })),
    printRawTspl: vi.fn(async () => ({ ok: true, confirmed: false })),
  };
  if (opts.generic !== false) b.testGenericPrinter = vi.fn(opts.test ?? (async () => ({ ok: true, confirmed: false, statusHex: "0107", service: "FF00", characteristic: "FF02" })));
  if (opts.niimbot) b.printStickerImage = vi.fn(async () => ({ ok: true, confirmed: true })); // the app build has the Niimbot driver
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
const dataOf = (call: unknown) => Buffer.from((call as { data?: string }).data || "", "base64");

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
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.printStickerBitmap).not.toHaveBeenCalled();
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
  it("printers only — by service OR by name — with pills; no (Test) tag, no Simple print card", async () => {
    const b = installBridge();
    renderBT({ flowV2: true, showClassicToggle: true });
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith({ includeGenericPrinters: true, showAllDevices: false });
    expect(screen.getAllByTestId("ps-v2-row")).toHaveLength(5); // D520, Y41, NEW, Niimbot (by name), classic XP (by name)
    expect(screen.queryByText(/Some Watch/)).toBeNull(); // paired, but not a printer
    expect(screen.getByText("B1-I603042141")).toBeTruthy();
    expect(screen.getByText("XP-P323B")).toBeTruthy();
    expect(screen.getByTestId("ps-v2-classic").textContent).toContain(t.rd_ps_v2_classic); // Android paired = classic tag
    expect(screen.getAllByTestId("ps-v2-known")).toHaveLength(2); // D520BT + Y41BT
    expect(screen.getAllByTestId("ps-v2-new")).toHaveLength(3);
    expect(screen.queryByText(/\(Test\)/)).toBeNull();
    expect(screen.queryByText(t.rd_ps_classic_text)).toBeNull();
  });
  it("'Show all Bluetooth devices' rescans with showAllDevices and lists every named device", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    await screen.findByText(/Some Watch/);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenLastCalledWith({ includeGenericPrinters: true, showAllDevices: true });
    expect(screen.getAllByTestId("ps-v2-row")).toHaveLength(6);
    expect(screen.queryByTestId("ps-v2-show-all")).toBeNull();
    // a device from "show all" runs the same new-printer flow
    fireEvent.click(screen.getByText("Some Watch"));
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledWith(expect.objectContaining({ address: "CC:CC" }));
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
  it("D520BT: saved at once (same call as today) + one test sticker through the unchanged D520 route, no question", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("D520BT-Z"));
    expect(await screen.findByText(t.rd_ps_v2_saved_testing)).toBeTruthy();
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "AA:AA", name: "D520BT-Z", transport: "ble" }));
    await waitFor(() => expect(b.printStickerBitmap).toHaveBeenCalledTimes(1)); // D520 SDK image stream, as always
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(await screen.findByText(t.rd_ps_test_sent)).toBeTruthy();
    expect(screen.queryByTestId("ps-v2-ask")).toBeNull();
  });
  it("Y41BT: saved as generic/tspl + one test sticker as a TSPL BITMAP image (never the text sticker)", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("Y41BT-0FC4_LE"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", lang: "tspl" }));
    await waitFor(() => expect(b.printRawTspl).toHaveBeenCalledTimes(1));
    const bytes = dataOf(b.printRawTspl.mock.calls[0][0]);
    expect(bytes.includes(Buffer.from("BITMAP 0,"))).toBe(true);
    expect(bytes.includes(Buffer.from("TEXT "))).toBe(false);
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ps-v2-ask")).toBeNull();
  });
});

describe("v2 new printer", () => {
  it("test (TSPL image) → ask → Yes saves generic/tspl; nothing saved before", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(1);
    const first = b.testGenericPrinter.mock.calls[0][0] as { address: string; data?: string; payload?: unknown; transport?: string };
    expect(first.address).toBe("DD:DD");
    expect(first.payload).toBeUndefined();
    expect(first.transport).toBeUndefined();
    const bytes = dataOf(first);
    expect(bytes.subarray(0, 16).toString("ascii")).toBe("SIZE 60 mm, 40 m");
    expect(bytes.includes(Buffer.from("BITMAP 0,"))).toBe(true);
    expect(bytes.includes(Buffer.from("TEXT "))).toBe(false);
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    expect(screen.getByTestId("pp-exact-preview")).toBeTruthy(); // the picture of the correct sticker
    expect(screen.queryByTestId("ps-v2-debug")).toBeNull(); // not admin
    fireEvent.click(screen.getByTestId("ps-v2-yes"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", lang: "tspl" }));
    expect(await screen.findByText(t.rd_ps_bt_saved)).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(1); // never re-sent
  });

  it("No → ESC/POS → No → CPCL → Yes saves generic/cpcl (one sticker + one question per language)", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    await waitFor(() => expect(b.testGenericPrinter).toHaveBeenCalledTimes(2));
    const second = dataOf(b.testGenericPrinter.mock.calls[1][0]);
    expect(Array.from(second.subarray(0, 6))).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00]); // ESC @ + GS v 0
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ps-v2-no"));
    await waitFor(() => expect(b.testGenericPrinter).toHaveBeenCalledTimes(3));
    const third = dataOf(b.testGenericPrinter.mock.calls[2][0]).toString("ascii");
    expect(third.startsWith("! 0 200 200 320 1\r\n")).toBe(true); // CPCL
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ps-v2-yes"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", lang: "cpcl" }));
  });

  it("No three times → not supported yet + Contact Admin (a real Telegram anchor); nothing saved", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    expect(await screen.findByText(t.rd_ps_gen_unsupported)).toBeTruthy();
    const a = screen.getByTestId("ps-v2-contact") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(3); // TSPL, ESC/POS, CPCL — and no more
  });

  it("a printer with nothing to write to (BT_NOT_SUPPORTED) skips the questions and ends unsupported after the 3 tries", async () => {
    const b = installBridge({ test: async () => { throw Object.assign(new Error("not supported"), { code: "BT_NOT_SUPPORTED" }); } });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    expect(await screen.findByText(t.rd_ps_gen_unsupported)).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("ps-v2-ask")).toBeNull();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("classic (paired, Android): the test goes over spp and the save keeps transport spp", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("XP-P323B"));
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledWith(expect.objectContaining({ address: "EE:EE", transport: "spp" }));
    fireEvent.click(screen.getByTestId("ps-v2-yes"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "EE:EE", name: "XP-P323B", transport: "spp", model: "generic", lang: "tspl" }));
  });

  it("Niimbot (by name) on an app WITHOUT the driver: no test print, 'not supported yet' + Contact Admin, nothing saved", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    expect(await screen.findByText(t.rd_ps_v2_brand_soon)).toBeTruthy();
    expect(screen.getByTestId("ps-v2-contact").getAttribute("href")).toBe(TELEGRAM_URL);
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("Niimbot with the driver: one test label through the SDK (the 50×30 image), 'Did it look like this?', Yes → saved as transport niimbot", async () => {
    const b = installBridge({ niimbot: true });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    expect(await screen.findByTestId("ps-v2-ask")).toBeTruthy();
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(1);
    const job = b.testGenericPrinter.mock.calls[0][0] as { address: string; transport: string; name: string; data?: string; image: { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number } };
    expect([job.address, job.transport, job.name, job.data]).toEqual(["NN:NN", "niimbot", "B1-I603042141", undefined]);
    expect([job.image.w, job.image.h, job.image.rowBytes, job.image.labelWidthMm, job.image.labelHeightMm]).toEqual([384, 240, 48, 50, 30]); // 50×30, not the seller's 60×40
    expect(Buffer.from(job.image.data, "base64")).toHaveLength(48 * 240);
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(b.printStickerImage).not.toHaveBeenCalled(); // the test goes through testGenericPrinter (no save yet)
    fireEvent.click(screen.getByTestId("ps-v2-yes"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "NN:NN", name: "B1-I603042141", transport: "niimbot", model: "generic" }));
    expect(screen.queryByTestId("ps-v2-panel")).toBeNull();
  });

  it("Niimbot with the driver: 'No' → not supported yet + Contact Admin (no language loop), nothing saved", async () => {
    const b = installBridge({ niimbot: true });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    fireEvent.click(await screen.findByTestId("ps-v2-no"));
    expect(await screen.findByText(t.rd_ps_v2_brand_soon)).toBeTruthy();
    expect(screen.getByTestId("ps-v2-contact").getAttribute("href")).toBe(TELEGRAM_URL);
    expect(b.testGenericPrinter).toHaveBeenCalledTimes(1); // no ESC/POS / CPCL tries for a Niimbot
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });

  it("Niimbot with the driver: a seller-level failure shows plain words + Contact Admin; another code = the usual wording", async () => {
    const b = installBridge({ niimbot: true, test: async () => { throw { code: "NIIMBOT_NO_PAPER", message: "Printer error 2" }; } });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    expect(await screen.findByText(t.rd_nb_no_paper)).toBeTruthy();
    expect(screen.getByTestId("ps-v2-contact")).toBeTruthy();
    expect(screen.queryByText(/NIIMBOT_NO_PAPER|Printer error 2/)).toBeNull(); // never a code
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    b.testGenericPrinter.mockImplementation(async () => { throw { code: "BT_NOT_FOUND", message: "Could not connect" }; });
    fireEvent.click(screen.getByText(new RegExp(t.rd_ps_scan)));
    await screen.findByText(/D520BT-Z/);
    fireEvent.click(screen.getByText("B1-I603042141"));
    expect(await screen.findByText(t.rd_ps_test_failed)).toBeTruthy();
  });

  it("admin sees the debug line after a test print", async () => {
    installBridge();
    renderBT({ flowV2: true, isAdmin: true });
    await scan();
    fireEvent.click(screen.getByText("LabelThing-9"));
    expect((await screen.findByTestId("ps-v2-debug")).textContent).toBe("confirmed: no · via FF00/FF02 · status: 0107");
  });
});
