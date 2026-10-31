// Printer setup v2 — the Printer settings screen, approved flow (Oct 30):
//   gate OFF (or an app without the generic method) = today's screen, byte-for-byte behaviour;
//   gate ON = Bluetooth checked the moment the screen opens (before any Scan) — OFF → red card +
//   Scan greyed, NOT ALLOWED → amber card, unclear → one silent retry then the red "isn't ready"
//   card, ready after a fix → green note + Scan active; Scan lists ONLY the whitelist (AIMO D520BT,
//   Flash Y41BT, Niimbot B-series) with a brand pill + "Printer not listed? Contact Admin" (admin
//   keeps "Show all"); tap → saved at once + one test sticker → green "Printer saved" card with
//   Test print — no "Did it look like this?" question, no language tries.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import PrinterSettings from "../PrinterSettings";
import { TProvider, buildT } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";
import { __resetSavedPrinter } from "../../adapters/savedPrinter";
import { FEATURE_KEYS } from "../../adapters/featureAccess";
import { FEATURE_SWITCH_KEYS } from "../../adapters/featureSwitches";
import { BT_RECHECK_MS, BT_RETRY_MS } from "../../adapters/btState";
import { TELEGRAM_URL } from "../../../lib/telegram";
import type { BluetoothPrinterDevice } from "../../adapters/printerBridge";

vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: async () => ({}), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
// The font-C atlases are real (slow) dynamic imports; a failed load = the fixed-cell layout — these are ROUTE tests.
vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: async () => { throw new Error("no font C in this test"); }, loadCjkRegAtlas: async () => { throw new Error("no font C in this test"); } }));

const t = buildT("en") as unknown as Record<string, string>;
const noop = () => {};
const D520: BluetoothPrinterDevice = { id: "bluetooth:AA", address: "AA:AA", name: "D520BT-Z", transport: "ble", model: "D520BT", likely: true };
const Y41: BluetoothPrinterDevice = { id: "bluetooth:BB", address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", likely: true };
const NEW: BluetoothPrinterDevice = { id: "bluetooth:DD", address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", likely: true }; // a label printer we never tested
const WATCH: BluetoothPrinterDevice = { id: "bluetooth:CC", address: "CC:CC", name: "Some Watch", transport: "ble", model: "generic", likely: false, paired: true };
const NIIMBOT: BluetoothPrinterDevice = { id: "bluetooth:NN", address: "NN:NN", name: "B1-I603042141", transport: "ble", model: "generic", likely: false }; // advertises no printer service
const CLASSIC: BluetoothPrinterDevice = { id: "bluetooth:EE", address: "EE:EE", name: "XP-P323B", transport: "spp", model: "generic", likely: false, paired: true }; // Android paired receipt printer
const XP420: BluetoothPrinterDevice = { id: "bluetooth:FF", address: "FF:FF", name: "XP-420B", transport: "ble", model: "generic", likely: true }; // Xprinter XP-420B (Oct 31)
const XP365: BluetoothPrinterDevice = { id: "bluetooth:GG", address: "GG:GG", name: "XP-365B", transport: "ble", model: "generic", likely: true }; // another Xprinter — NOT tested, stays hidden
const ALL = [D520, Y41, NEW, WATCH, NIIMBOT, CLASSIC, XP420, XP365];

const OFF = Object.assign(new Error("Bluetooth is off. Turn it on in Android Settings then try again."), { code: "BT_DISABLED" });
const PERM = Object.assign(new Error("Bluetooth permission needed. Allow it in the system prompt and tap Scan again."), { code: "BT_PERMISSION" });
const UNCLEAR = Object.assign(new Error("Bluetooth did not become ready."), { code: "BT_UNAVAILABLE" });

type Bridge = Record<string, ReturnType<typeof vi.fn>>;
function installBridge(opts: { generic?: boolean; niimbot?: boolean; osTooOld?: boolean; scan?: () => Promise<unknown> } = {}): Bridge {
  const b: Bridge = {
    scanBluetoothLabelPrinters: vi.fn(opts.scan ?? (async () => ({ ok: true, printers: ALL }))),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    clearBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async (p: BluetoothPrinterDevice) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    printStickerNative: vi.fn(async () => ({ ok: true, confirmed: false })),
    printStickerBitmap: vi.fn(async () => ({ ok: true })),
    printRawTspl: vi.fn(async () => ({ ok: true, confirmed: false })),
  };
  if (opts.generic !== false) b.testGenericPrinter = vi.fn(async () => { throw new Error("the web never calls this any more"); }); // = a build new enough for v2
  if (opts.niimbot) b.printStickerImage = vi.fn(async () => ({ ok: true, confirmed: true })); // the app build has the Niimbot driver
  if (opts.osTooOld) (b as unknown as Record<string, unknown>).niimbotOsTooOld = true; // iOS < 17.2: the shell flags it
  (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter = b;
  return b;
}
afterEach(() => { delete (window as unknown as { SellerFlowPrinter?: unknown }).SellerFlowPrinter; __resetSavedPrinter(); vi.useRealTimers(); });

const renderBT = (props: { flowV2?: boolean; isAdmin?: boolean; showClassicToggle?: boolean } = {}) =>
  render(
    <TProvider lang="en">
      <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={false}
        onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} {...props} />
    </TProvider>,
  );
const scanBtn = () => screen.getByTestId("ps-scan") as HTMLButtonElement;
const ready = () => waitFor(() => expect(scanBtn().disabled).toBe(false));
const scan = async () => { await ready(); fireEvent.click(scanBtn()); await screen.findByText(/D520BT-Z/); };
const dataOf = (call: unknown) => Buffer.from((call as { data?: string }).data || "", "base64");
// fake-timer helpers (RTL's waitFor can't see vitest's fake clock)
const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); for (let i = 0; i < 12; i++) await Promise.resolve(); });

describe("gate", () => {
  it("keys exist: feature list + app_settings switch", () => {
    expect(FEATURE_KEYS).toContain("test_printers");
    expect(FEATURE_SWITCH_KEYS.printerFlowV2).toBe("printer_flow_v2");
  });
  it("OFF: today's screen — no Bluetooth check on open, plain scan, every row, rows save at once, Simple print card stays", async () => {
    const b = installBridge();
    renderBT({ showClassicToggle: true });
    await flush();
    expect(b.scanBluetoothLabelPrinters).not.toHaveBeenCalled(); // no probe for the old screen
    expect(scanBtn().disabled).toBe(false);
    fireEvent.click(scanBtn());
    await screen.findByText(/D520BT-Z/);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith();
    expect(screen.queryByTestId("ps-v2-list")).toBeNull();
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
    fireEvent.click(scanBtn());
    await screen.findByText(/D520BT-Z/);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith();
    expect(screen.queryByTestId("ps-v2-list")).toBeNull();
    expect(screen.getByText(t.rd_ps_classic_text)).toBeTruthy();
  });
});

describe("Bluetooth check on open", () => {
  it("runs the moment the screen opens — BEFORE any Scan tap; Scan is greyed until the answer; a ready phone = Scan active, no green note", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledTimes(1);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledWith({ includeGenericPrinters: true });
    expect(scanBtn().disabled).toBe(true);
    expect(screen.getByTestId("ps-bt-checking")).toBeTruthy();
    await ready();
    expect(screen.queryByTestId("ps-bt-checking")).toBeNull();
    expect(screen.queryByTestId("ps-bt-ready")).toBeNull();
    expect(screen.queryByTestId("ps-v2-list")).toBeNull(); // the probe's printers are not a list — Scan is
    expect(screen.getByTestId("ps-status-dot").getAttribute("data-tone")).toBe("amber"); // ready, no printer yet
    expect(screen.getByText(t.rd_bts_st_none)).toBeTruthy();
  });

  it("Bluetooth OFF → red alert card with the iPhone + Android steps, Scan disabled, status dot red; turned on → green note + Scan active", async () => {
    vi.useFakeTimers();
    const b = installBridge({ scan: async () => { throw OFF; } });
    renderBT({ flowV2: true });
    await flush();
    const card = screen.getByTestId("ps-bt-off");
    expect(card.getAttribute("role")).toBe("alert");
    expect(card.textContent).toContain(t.rd_bts_off_title);
    expect(card.textContent).toContain(t.rd_bts_off_line);
    expect(card.textContent).toContain(t.rd_bts_off_ios);
    expect(card.textContent).toContain(t.rd_bts_off_android);
    expect(card.textContent).toContain(t.rd_bts_auto);
    expect(card.textContent).not.toMatch(/BT_DISABLED|Android Settings/); // never the raw native text
    expect(scanBtn().disabled).toBe(true);
    expect(screen.getByTestId("ps-status-dot").getAttribute("data-tone")).toBe("red");
    expect(screen.getByText(t.rd_bts_st_attention)).toBeTruthy();
    // re-checked by itself every 3 s
    await advance(BT_RECHECK_MS);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("ps-bt-off")).toBeTruthy();
    b.scanBluetoothLabelPrinters.mockImplementation(async () => ({ ok: true, printers: ALL }));
    await advance(BT_RECHECK_MS);
    expect(screen.queryByTestId("ps-bt-off")).toBeNull();
    expect(screen.getByTestId("ps-bt-ready").textContent).toBe(t.rd_bts_ready);
    expect(scanBtn().disabled).toBe(false);
    expect(screen.getByTestId("ps-status-dot").getAttribute("data-tone")).toBe("amber");
  });

  it("Bluetooth NOT ALLOWED → amber card with the Settings paths, Scan disabled; NO 3 s re-check (it would re-ask the permission); allowed + back to the app → green note", async () => {
    vi.useFakeTimers();
    const b = installBridge({ scan: async () => { throw PERM; } });
    renderBT({ flowV2: true });
    await flush();
    const card = screen.getByTestId("ps-bt-perm");
    expect(card.getAttribute("role")).toBe("alert");
    expect(card.textContent).toContain(t.rd_bts_perm_title);
    expect(card.textContent).toContain(t.rd_bts_perm_line);
    expect(card.textContent).toContain(t.rd_bts_perm_ios);
    expect(card.textContent).toContain(t.rd_bts_perm_android);
    expect(card.textContent).toContain(t.rd_bts_perm_auto);
    expect(card.textContent).not.toMatch(/BT_PERMISSION|system prompt/);
    expect(scanBtn().disabled).toBe(true);
    expect(screen.queryByTestId("ps-bt-off")).toBeNull();
    b.scanBluetoothLabelPrinters.mockImplementation(async () => ({ ok: true, printers: ALL }));
    await advance(10_000);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledTimes(1); // no timer while not allowed
    expect(screen.getByTestId("ps-bt-perm")).toBeTruthy();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledTimes(2); // one check on foreground return
    expect(screen.queryByTestId("ps-bt-perm")).toBeNull();
    expect(screen.getByTestId("ps-bt-ready")).toBeTruthy();
    expect(scanBtn().disabled).toBe(false);
  });

  it("iOS shape (resolves ok:false with a message, no code) → the same cards", async () => {
    installBridge({ scan: async () => ({ ok: false, printers: [], savedPrinter: null, message: "Bluetooth permission denied. Allow Bluetooth for SellerFlowLive in iPhone Settings." }) });
    renderBT({ flowV2: true });
    expect(await screen.findByTestId("ps-bt-perm")).toBeTruthy();
    expect(scanBtn().disabled).toBe(true);
  });

  it("unclear answer → retried ONCE after 2 s silently (no card yet) → still failing → red 'isn't ready' card", async () => {
    vi.useFakeTimers();
    const b = installBridge({ scan: async () => { throw UNCLEAR; } });
    renderBT({ flowV2: true });
    await flush();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("ps-bt-notready")).toBeNull();
    expect(screen.getByTestId("ps-bt-checking")).toBeTruthy();
    await advance(BT_RETRY_MS);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenCalledTimes(2);
    const card = screen.getByTestId("ps-bt-notready");
    expect(card.getAttribute("role")).toBe("alert");
    expect(card.textContent).toContain(t.rd_bts_notready);
    expect(card.textContent).not.toMatch(/BT_UNAVAILABLE|did not become/);
    expect(scanBtn().disabled).toBe(true);
    expect(screen.getByTestId("ps-status-dot").getAttribute("data-tone")).toBe("red");
  });

  it("a Scan that fails with Bluetooth off brings the red card back (ready → off)", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await ready();
    b.scanBluetoothLabelPrinters.mockImplementation(async () => { throw OFF; });
    fireEvent.click(scanBtn());
    expect(await screen.findByTestId("ps-bt-off")).toBeTruthy();
    expect(scanBtn().disabled).toBe(true);
    expect(screen.queryByTestId("ps-bt-msg")).toBeNull(); // the card says it — no second line
  });
});

describe("scan list = the whitelist", () => {
  it("only Jeff's tested printers: AIMO D520BT, Flash Y41BT, Niimbot, Xprinter XP-420B — name + model line + brand pill; unknown printers never appear", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    expect(b.scanBluetoothLabelPrinters).toHaveBeenLastCalledWith({ includeGenericPrinters: true, showAllDevices: false });
    const rows = screen.getAllByTestId("ps-row");
    expect(rows.map((r) => r.querySelector("span > span")?.textContent)).toEqual(["D520BT-Z", "Y41BT-0FC4_LE", "B1-I603042141", "XP-420B"]);
    expect(screen.getAllByTestId("ps-row-model").map((m) => m.textContent)).toEqual(["AIMO D520BT", "Flash Y41BT", "Niimbot B1", "Xprinter XP-420B"]);
    expect(screen.getAllByTestId("ps-row-brand").map((p) => p.textContent)).toEqual(["AIMO", "Flash", "Niimbot", "Xprinter"]);
    expect(screen.queryByText("LabelThing-9")).toBeNull(); // an untested label printer
    expect(screen.queryByText("XP-P323B")).toBeNull();     // an untested paired receipt printer
    expect(screen.queryByText("XP-365B")).toBeNull();      // another Xprinter model — exact "XP-420B" only, no "XP-" family match
    expect(screen.queryByText(/Some Watch/)).toBeNull();
    expect(screen.queryByText(/Works with SFL|^New$|\(Test\)/)).toBeNull();
    expect(screen.queryByText(t.rd_ps_classic_text)).toBeNull(); // v2 hides the Simple print card
  });
  it("seller: 'Printer not listed? Contact Admin.' is a real Telegram anchor under the list; no 'Show all'", async () => {
    installBridge();
    renderBT({ flowV2: true });
    await scan();
    const line = screen.getByTestId("ps-v2-not-listed") as HTMLAnchorElement;
    expect(line.tagName).toBe("A");
    expect(line.textContent).toBe(t.rd_ps_v2_not_listed);
    expect(line.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(line.getAttribute("target")).toBe("_blank");
    expect(screen.queryByTestId("ps-v2-show-all")).toBeNull();
  });
  it("admin: 'Show all Bluetooth devices' rescans with showAllDevices and lists every named device (unknown ones too)", async () => {
    const b = installBridge();
    renderBT({ flowV2: true, isAdmin: true });
    await scan();
    expect(screen.queryByTestId("ps-v2-not-listed")).toBeNull();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    await screen.findByText(/Some Watch/);
    expect(b.scanBluetoothLabelPrinters).toHaveBeenLastCalledWith({ includeGenericPrinters: true, showAllDevices: true });
    expect(screen.getAllByTestId("ps-row")).toHaveLength(8);
    expect(screen.getAllByTestId("ps-row-brand")).toHaveLength(4); // only the whitelisted rows carry a pill
    expect(screen.queryByTestId("ps-v2-show-all")).toBeNull();
  });
  it("nothing listed → a plain note", async () => {
    installBridge({ scan: async () => ({ ok: true, printers: [WATCH, NEW] }) });
    renderBT({ flowV2: true });
    await ready();
    fireEvent.click(scanBtn());
    expect(await screen.findByText(t.rd_ps_v2_none)).toBeTruthy();
  });
});

describe("tap a printer → saved + one test sticker → green card (no question)", () => {
  it("D520BT: 'Printing a test sticker on…' → saved with the unchanged D520 call → one D520 test sticker → green 'Printer saved' card with name · size + Test print", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("D520BT-Z"));
    expect((await screen.findByTestId("ps-printing")).textContent).toContain("D520BT-Z");
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "AA:AA", name: "D520BT-Z", transport: "ble" }));
    await waitFor(() => expect(b.printStickerBitmap).toHaveBeenCalledTimes(1)); // D520 SDK image stream, as always
    const card = await screen.findByTestId("ps-saved");
    expect(card.getAttribute("role")).toBe("status");
    expect(card.textContent).toContain(t.rd_bts_saved_title);
    expect(card.textContent).toContain("D520BT-Z · sticker 60x40mm");
    expect(card.textContent).toContain(t.rd_bts_saved_line);
    expect(screen.getByTestId("ps-saved-test").textContent).toBe(t.rd_ps_test_print);
    expect(screen.queryByTestId("ps-saved-warn")).toBeNull(); // green = the test sticker really printed (printed.ok)
    expect(screen.queryByText(/Did it look like this/)).toBeNull();
    expect(screen.queryByTestId("pp-exact-preview")).toBeNull(); // no preview picture
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
    expect(b.printRawTspl).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ps-v2-list")).toBeNull(); // the list makes way for the card
    expect(screen.getByTestId("ps-status-dot").getAttribute("data-tone")).toBe("green");
    expect(screen.getByText("Connected: D520BT-Z")).toBeTruthy();
    // Test print on the card = the saved printer's test sticker
    fireEvent.click(screen.getByTestId("ps-saved-test"));
    await waitFor(() => expect(b.printStickerBitmap).toHaveBeenCalledTimes(2));
  });
  it("Y41BT (Flash): saved as generic/tspl + one TSPL BITMAP test sticker (never the text sticker) with the darker header SPEED 2 + DENSITY 15, no question", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("Y41BT-0FC4_LE"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", lang: "tspl" }));
    await waitFor(() => expect(b.printRawTspl).toHaveBeenCalledTimes(1));
    const bytes = dataOf(b.printRawTspl.mock.calls[0][0]);
    expect(bytes.includes(Buffer.from("BITMAP 0,"))).toBe(true);
    expect(bytes.includes(Buffer.from("TEXT "))).toBe(false);
    // the Y41BT prints light at DENSITY 8 (Oct 31, side by side with the AIMO) → its own header
    expect(bytes.subarray(0, bytes.indexOf(Buffer.from("CLS\r\n"))).toString("ascii")).toBe("SIZE 60 mm, 40 mm\r\nGAP 2 mm, 0\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nSPEED 2\r\nDENSITY 15\r\n");
    expect(b.printStickerNative).not.toHaveBeenCalled();
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
    expect((await screen.findByTestId("ps-saved")).textContent).toContain("Y41BT-0FC4_LE");
    expect(screen.queryByText(/Did it look like this/)).toBeNull();
  });
  it("XP-420B (Xprinter): saved as generic/tspl + one TSPL BITMAP test sticker whose job header is SPEED 2 + DENSITY 15 (still light at 12/3 on Oct 31)", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("XP-420B"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "FF:FF", name: "XP-420B", transport: "ble", model: "generic", lang: "tspl" }));
    await waitFor(() => expect(b.printRawTspl).toHaveBeenCalledTimes(1));
    const bytes = dataOf(b.printRawTspl.mock.calls[0][0]);
    expect(bytes.subarray(0, bytes.indexOf(Buffer.from("CLS\r\n"))).toString("ascii")).toBe("SIZE 60 mm, 40 mm\r\nGAP 2 mm, 0\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nSPEED 2\r\nDENSITY 15\r\n");
    expect(bytes.includes(Buffer.from("BITMAP 0,"))).toBe(true);
    expect(bytes.includes(Buffer.from("TEXT "))).toBe(false);
    expect((await screen.findByTestId("ps-saved")).textContent).toContain("XP-420B");
  });
  it("Niimbot with the driver: saved as transport niimbot at once → one label through the SDK → the same green card (no question)", async () => {
    const b = installBridge({ niimbot: true });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "NN:NN", name: "B1-I603042141", transport: "niimbot", model: "generic" }));
    await waitFor(() => expect(b.printStickerImage).toHaveBeenCalledTimes(1));
    expect((await screen.findByTestId("ps-saved")).textContent).toContain("B1-I603042141");
    expect(screen.queryByText(/Did it look like this/)).toBeNull();
    expect(b.testGenericPrinter).not.toHaveBeenCalled();
  });
  it("Niimbot on an app WITHOUT the driver: 'not supported yet' + Contact Admin, nothing saved", async () => {
    const b = installBridge();
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    expect(await screen.findByText(t.rd_ps_v2_brand_soon)).toBeTruthy();
    expect(screen.getByTestId("ps-v2-contact").getAttribute("href")).toBe(TELEGRAM_URL);
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });
  it("Niimbot on iOS < 17.2: the 'needs iOS 17' message + Contact Admin, nothing saved", async () => {
    const b = installBridge({ niimbot: true, osTooOld: true });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("B1-I603042141"));
    expect(await screen.findByText(t.rd_nb_os_too_old)).toBeTruthy();
    expect(b.printStickerImage).not.toHaveBeenCalled();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });
  it("the test sticker fails for another reason → the printer stays saved, AMBER 'saved, but the test sticker didn't print' card + Test print (never green, never the raw text); a later Test print that works turns it green", async () => {
    const b = installBridge();
    const fail = vi.fn(async () => { throw Object.assign(new Error("read failed, socket might closed"), { code: "BT_NOT_FOUND" }); });
    b.printStickerBitmap = fail; b.printStickerNative = fail;
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("D520BT-Z"));
    const card = await screen.findByTestId("ps-saved-warn");
    expect(b.setBluetoothLabelPrinter).toHaveBeenCalledTimes(1); // saved anyway
    expect(card.getAttribute("role")).toBe("alert");
    expect(card.textContent).toContain(t.rd_bts_saved_warn_title);
    expect(card.textContent).toContain(t.rd_bts_saved_warn_line);
    expect(card.textContent).toContain("D520BT-Z · sticker 60x40mm");
    expect(card.textContent).not.toContain(t.rd_bts_saved_title);
    expect(screen.queryByTestId("ps-saved")).toBeNull();
    expect(screen.queryByTestId("ps-bt-msg")).toBeNull(); // the card says it — no second line
    expect(screen.queryByText(/socket|BT_NOT_FOUND/)).toBeNull();
    expect(screen.getByTestId("ps-status-dot").getAttribute("data-tone")).toBe("green"); // a printer IS saved
    expect(screen.getByTestId("ps-saved-test").textContent).toBe(t.rd_ps_test_print);
    b.printStickerBitmap = vi.fn(async () => ({ ok: true }));
    fireEvent.click(screen.getByTestId("ps-saved-test"));
    expect(await screen.findByTestId("ps-saved")).toBeTruthy();
    expect(screen.queryByTestId("ps-saved-warn")).toBeNull();
  });
  it("the test sticker fails because Bluetooth went OFF → the red card returns (the printer stays saved)", async () => {
    const b = installBridge();
    b.printStickerBitmap = vi.fn(async () => { throw Object.assign(new Error("Bluetooth is off"), { code: "BT_OFF" }); });
    renderBT({ flowV2: true });
    await scan();
    fireEvent.click(screen.getByText("D520BT-Z"));
    expect(await screen.findByTestId("ps-bt-off")).toBeTruthy();
    expect(b.setBluetoothLabelPrinter).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ps-status-dot").getAttribute("data-tone")).toBe("red");
  });
  it("admin 'Show all': an unknown device is saved as a generic TSPL printer + one test sticker (Jeff's testing path)", async () => {
    const b = installBridge();
    renderBT({ flowV2: true, isAdmin: true });
    await scan();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    await screen.findByText(/Some Watch/);
    fireEvent.click(screen.getByText("XP-P323B"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "EE:EE", name: "XP-P323B", transport: "spp", model: "generic", lang: "tspl" }));
    await waitFor(() => expect(b.printRawTspl).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("ps-saved")).toBeTruthy();
  });
});
