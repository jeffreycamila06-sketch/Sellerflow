// Printer testers + web-side scan filter + Admin-approved printers (sql/160) — ADD-ONLY.
//  A. printer_scan_web_filter OFF = origin/main's scan call + list; ON = the phone lists every device,
//     the web keeps only the whitelist (B1 Pro found by the normal Scan).
//  B. testers: "Show all", ANY named device opens the Printer test card (language →
//     the existing generic path, nothing saved), Yes needs a photo, no Save; a non-tester sees none of it.
//  C. approved printers: listed, saved + printed with their language; built-in prefix wins; inactive /
//     failed read = built-in only. Every built-in printer gives origin/main's answers (frozen copy).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as now from "../printerModels";
import * as main from "./fixtures/printerModels.main1115";
import { oneStickerLimitFor, oneStickerSizesFor } from "../oneStickerPrint";
import { printerLimitFor } from "../oneSticker";
import { printSlip, DEF_SETTINGS, type Settings } from "../printing";
import { buildTestBuyer, type BluetoothPrinterDevice } from "../printerBridge";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { defaultPrefix, parseApprovedRows, bleFactsOf } from "../printerTesters";
import PrinterSettings from "../../screens/PrinterSettings";
import { TProvider, buildT } from "../../i18n";
import { FEATURE_KEYS } from "../featureAccess";
import { FEATURE_SWITCH_KEYS, parseSwitches } from "../featureSwitches";

vi.mock("../cjkAtlasLoader", () => ({ loadCjkAtlas: vi.fn(async () => ({})), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
vi.mock("../propAtlasLoader", () => ({ loadPropAtlas: vi.fn(async () => { throw new Error("no font C"); }), loadCjkRegAtlas: vi.fn(async () => { throw new Error("no font C"); }) }));
const submitSpy = vi.fn(async () => ({ ok: true as const }));
const resizeSpy = vi.fn(async (f: Blob) => new Blob([await f.arrayBuffer()], { type: "image/jpeg" }));
vi.mock("../printerTesters", async (orig) => {
  const real = await orig<typeof import("../printerTesters")>();
  return { ...real, submitPrinterTestReport: (...a: unknown[]) => (submitSpy as unknown as (...x: unknown[]) => unknown)(...a), resizeTestPhoto: (f: Blob) => resizeSpy(f) };
});

const t = buildT("en") as unknown as Record<string, string>;
type W = { SellerFlowPrinter?: unknown };
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetSavedPrinter(); now.setApprovedPrinters(null); submitSpy.mockClear(); resizeSpy.mockClear(); });

const dev = (name: string, extra: Partial<BluetoothPrinterDevice> = {}): BluetoothPrinterDevice => ({ id: `bluetooth:${name}`, address: `${name}-addr`, name, transport: "ble", model: "generic", likely: false, ...extra });
const D520 = dev("D520BT-Z", { model: "D520BT", likely: true });
const D520_OTHER = dev("Phomemo-X", { model: "D520BT", likely: true }); // the phone marked it as the D520BT target
const LISTED = [D520, D520_OTHER, dev("Y41BT-0FC4_LE", { likely: true }), dev("XP-420B", { likely: true }), dev("B1-I603042141"), dev("B1 Pro-I616030055"), dev("B21-ABC"), dev("B203-77"), dev("B3S-01")];
const MACBOOK = dev("Jeff MacBook Pro", { paired: true });
const AIRPODS = dev("AirPods Pro");
const UNKNOWN = dev("LabelThing-9", { likely: true }); // a label printer nobody tested
const CT221B = dev("CT221B-D4F8"); // CLABEL CT221B: a real label printer with no known name and no printer service (Jeff 2026-11-15)
const ALL = [...LISTED, MACBOOK, AIRPODS, UNKNOWN, CT221B];

function bridge(printers = ALL) {
  const b: Record<string, ReturnType<typeof vi.fn>> = {
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    clearBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async (p: BluetoothPrinterDevice) => ({ ok: true, savedPrinter: { ...p, paired: true } })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    printStickerNative: vi.fn(async () => ({ ok: true, confirmed: false })),
    printStickerBitmap: vi.fn(async () => ({ ok: true })),
    printRawTspl: vi.fn(async () => ({ ok: true, confirmed: false })),
    testGenericPrinter: vi.fn(async () => ({ ok: true })),
    printStickerImage: vi.fn(async () => ({ ok: true, confirmed: true })),
  };
  (window as W).SellerFlowPrinter = b;
  return b;
}
const renderPS = (props: { scanWebFilter?: boolean; tester?: boolean; isAdmin?: boolean } = {}) => render(
  <TProvider lang="en">
    <PrinterSettings onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}} psSize="60x40mm" psSizeOpen={false}
      onTogglePsSize={() => {}} onPickPsSize={() => {}} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} flowV2 {...props} />
  </TProvider>,
);
const scanBtn = () => screen.getByTestId("ps-scan") as HTMLButtonElement;
async function scan() { await waitFor(() => expect(scanBtn().disabled).toBe(false)); fireEvent.click(scanBtn()); await screen.findByTestId("ps-v2-list"); }
const listedNames = () => screen.queryAllByTestId("ps-row").map((r) => r.querySelector("span span")?.textContent);
const lastScanArg = (b: ReturnType<typeof bridge>) => b.scanBluetoothLabelPrinters.mock.calls.at(-1)?.[0];

describe("keys", () => {
  it("feature key + switch key exist; the switch starts off and reads only an exact 'true'", () => {
    expect(FEATURE_KEYS).toContain("printer_tester");
    expect(FEATURE_SWITCH_KEYS.printerScanWebFilter).toBe("printer_scan_web_filter");
    expect(parseSwitches([]).printerScanWebFilter).toBe(false);
    expect(parseSwitches([{ key: "printer_scan_web_filter", value: "TRUE" }]).printerScanWebFilter).toBe(false);
    expect(parseSwitches([{ key: "printer_scan_web_filter", value: "true" }]).printerScanWebFilter).toBe(true);
  });
});

describe("A. scan filter", () => {
  it("switch OFF: the scan call and the list are origin/main's", async () => {
    const b = bridge();
    renderPS();
    await scan();
    expect(lastScanArg(b)).toEqual({ includeGenericPrinters: true, showAllDevices: false }); // = origin/main
    const mainList = ALL.filter((p) => main.knownPrinterInfo(p) !== null).map((p) => p.name);
    expect(listedNames()).toEqual(mainList);
  });
  it("switch ON: the phone is asked for every device; every whitelisted printer is listed, nothing else", async () => {
    const b = bridge();
    renderPS({ scanWebFilter: true });
    await scan();
    expect(lastScanArg(b)).toEqual({ includeGenericPrinters: true, showAllDevices: true });
    expect(listedNames()).toEqual(LISTED.map((p) => p.name));
    for (const n of ["Jeff MacBook Pro", "AirPods Pro", "LabelThing-9", "CT221B-D4F8"]) expect(screen.queryByText(n)).toBeNull();
    // a seller still gets the Contact Admin link, never "Show all"
    expect(screen.getByTestId("ps-v2-not-listed")).toBeTruthy();
    expect(screen.queryByTestId("ps-v2-show-all")).toBeNull();
  });
  it("switch ON: the admin's Show all is unchanged (named devices, showAllDevices true)", async () => {
    const b = bridge();
    renderPS({ scanWebFilter: true, isAdmin: true });
    await scan();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    await waitFor(() => expect(listedNames()).toContain("AirPods Pro"));
    expect(lastScanArg(b)).toEqual({ includeGenericPrinters: true, showAllDevices: true });
    expect(screen.queryAllByTestId("ps-row-not-printer")).toHaveLength(0);
  });
  it("admin Show all is unchanged: tapping an unknown device saves it as generic TSPL (no test card)", async () => {
    const b = bridge();
    renderPS({ isAdmin: true, tester: true });
    await scan();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    fireEvent.click(await screen.findByText("AirPods Pro"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "AirPods Pro-addr", name: "AirPods Pro", transport: "ble", model: "generic", lang: "tspl" }));
    expect(screen.queryByTestId("ps-tester-card")).toBeNull();
  });
});

// Everything the app decides from a printer name (same as niimbotB1Pro.test.tsx).
type Mods = Pick<typeof now, "matchesPrinterName" | "isNiimbotName" | "knownPrinterInfo" | "isPrinterOnlyRow" | "brandOf" | "knownPrinterLang" | "knownTsplJob" | "knownGapAfterMs" | "isKnownPrinter">;
function answers(m: Mods, name: string, model: "D520BT" | "generic" = "generic") {
  const niimbot = m.brandOf({ name }) === "niimbot";
  return {
    printerName: m.matchesPrinterName(name), niimbotName: m.isNiimbotName(name),
    info: m.knownPrinterInfo({ name, model }), printerRow: m.isPrinterOnlyRow({ name, model, likely: false }),
    brand: m.brandOf({ name }), lang: m.knownPrinterLang(name), job: m.knownTsplJob(name), gapAfterMs: m.knownGapAfterMs(name),
    known: m.isKnownPrinter({ name, model }), limit: printerLimitFor(name), oneLimit: oneStickerLimitFor(name, niimbot), sizes: oneStickerSizesFor(name, niimbot),
  };
}
// approved rows that TRY to shadow built-in printers — they must never win
const SHADOWS: now.ApprovedPrinter[] = [
  { prefix: "D520", brand: "Other", model: "X", lang: "escpos" }, { prefix: "Y41", brand: "Other", model: "X", lang: "cpcl" },
  { prefix: "XP-4", brand: "Other", model: "X", lang: "escpos" }, { prefix: "B1", brand: "Other", model: "X", lang: "escpos" },
  { prefix: "B2", brand: "Other", model: "X", lang: "cpcl" }, { prefix: "B3", brand: "Other", model: "X", lang: "cpcl" },
];
describe("C. every built-in printer = origin/main (with and without approved rows)", () => {
  const BUILTIN: [string, "D520BT" | "generic"][] = [
    ["D520BT-Z", "D520BT"], ["D520BT-Z", "generic"], ["Phomemo-X", "D520BT"], ["Y41BT-0FC4_LE", "generic"], ["XP-420B", "generic"],
    ["B1-I603042141", "generic"], ["B1 Pro-I616030055", "generic"], ["b1 pro-lower", "generic"], ["B21-ABC", "generic"], ["B203-77", "generic"], ["B3S-01", "generic"],
  ];
  for (const withApproved of [false, true]) {
    for (const [name, model] of BUILTIN) {
      it(`${withApproved ? "approved rows loaded" : "no approved rows"}: ${name} (${model})`, () => {
        now.setApprovedPrinters(withApproved ? SHADOWS : null);
        expect(answers(now, name, model)).toEqual(answers(main, name, model));
      });
    }
  }
  it("no approved rows: every other name is origin/main's too", () => {
    for (const name of ["XP-P323B", "Printer_8A2F", "GP-1324D", "M110-C9", "LabelThing-9", "Jeff MacBook Pro", "AirPods Pro", ""]) {
      expect(answers(now, name)).toEqual(answers(main, name));
    }
  });
  it("built-in printers: the same save call and test print as origin/main with approved rows loaded", async () => {
    now.setApprovedPrinters(SHADOWS);
    const b = bridge([dev("Y41BT-0FC4_LE", { likely: true })]);
    renderPS({ scanWebFilter: true });
    await scan();
    fireEvent.click(screen.getByText("Y41BT-0FC4_LE"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "Y41BT-0FC4_LE-addr", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", lang: "tspl" }));
  });
});

describe("C. approved printers", () => {
  const ROW: now.ApprovedPrinter = { prefix: "LabelThing-", brand: "Other", model: "LabelThing", lang: "escpos" };
  it("parse: inactive / bad rows dropped, brand defaults to Other", () => {
    expect(parseApprovedRows([{ prefix: "LabelThing-", brand: "", model: "LabelThing", lang: "escpos", active: true }, { prefix: "Gone-", brand: "X", model: "Gone", lang: "tspl", active: false }, { prefix: "Z", lang: "tspl" }, { prefix: "Bad-", lang: "zpl" }]))
      .toEqual([{ prefix: "LabelThing-", brand: "Other", model: "LabelThing", lang: "escpos" }]);
    expect(parseApprovedRows(null)).toEqual([]);
  });
  it("an approved row appears for a seller (brand pill) and is saved with its approved language", async () => {
    now.setApprovedPrinters([ROW]);
    const b = bridge();
    renderPS();
    await scan();
    expect(listedNames()).toContain("LabelThing-9");
    const row = screen.getByText("LabelThing-9").closest("button")!;
    expect(row.querySelector("[data-testid=ps-row-brand]")?.textContent).toBe("Other");
    fireEvent.click(row);
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "LabelThing-9-addr", name: "LabelThing-9", transport: "ble", model: "generic", lang: "escpos" }));
  });
  it("a saved approved printer prints through the existing generic path in its language (ESC/POS bytes)", async () => {
    now.setApprovedPrinters([ROW]);
    const b = bridge();
    rememberSavedPrinter({ address: "LabelThing-9-addr", name: "LabelThing-9", model: "generic", transport: "ble", lang: "escpos" });
    const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "60x40" };
    printSlip(buildTestBuyer(), "NT$", "Store", cfg);
    await waitFor(() => expect(b.printRawTspl).toHaveBeenCalledTimes(1));
    const bytes = Buffer.from((b.printRawTspl.mock.calls[0][0] as { data: string }).data, "base64");
    expect([...bytes.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30]); // ESC @ + GS v 0
  });
  it("built-in prefix wins over an approved row; an inactive row / no rows (failed read) = not listed", async () => {
    now.setApprovedPrinters([{ prefix: "Y41", brand: "Other", model: "Fake", lang: "escpos" }]);
    expect(now.knownPrinterInfo({ name: "Y41BT-0FC4_LE" })).toEqual({ brand: "Flash", model: "Y41BT" });
    expect(now.knownPrinterLang("Y41BT-0FC4_LE")).toBe("tspl");
    now.setApprovedPrinters(parseApprovedRows([{ ...ROW, active: false }]));
    expect(now.knownPrinterInfo({ name: "LabelThing-9" })).toBeNull();
    now.setApprovedPrinters(null);
    bridge();
    renderPS();
    await scan();
    expect(listedNames()).not.toContain("LabelThing-9");
  });
});

describe("B. printer testers", () => {
  beforeEach(() => { submitSpy.mockClear(); });
  it("a non-tester never sees Show all or the test card (whitelist only)", async () => {
    bridge();
    renderPS({ scanWebFilter: true });
    await scan();
    expect(screen.queryByTestId("ps-v2-show-all")).toBeNull();
    expect(screen.queryByTestId("ps-tester-card")).toBeNull();
    expect(listedNames()).toEqual(LISTED.map((p) => p.name));
  });
  for (const name of ["AirPods Pro", "Jeff MacBook Pro", "CT221B-D4F8"]) {
    it(`a tester can tap ${name} in Show all → the Printer test card (never saved, no "Not a printer")`, async () => {
      const b = bridge();
      renderPS({ tester: true });
      await scan();
      expect(screen.queryByTestId("ps-v2-not-listed")).toBeNull();
      fireEvent.click(screen.getByTestId("ps-v2-show-all"));
      const row = (await screen.findByText(name)).closest("button")!;
      expect(row.disabled).toBe(false);
      expect(screen.queryAllByTestId("ps-row-not-printer")).toHaveLength(0);
      fireEvent.click(row);
      await screen.findByTestId("ps-tester-card");
      expect(screen.getByTestId("ps-tester-card").textContent).toContain(name);
      fireEvent.click(screen.getByTestId("ps-tester-lang-tspl"));
      fireEvent.click(screen.getByTestId("ps-tester-print"));
      await waitFor(() => expect(b.testGenericPrinter).toHaveBeenCalledTimes(1));
      expect((b.testGenericPrinter.mock.calls[0][0] as { address: string }).address).toBe(`${name}-addr`);
      expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    });
  }
  async function openCard() {
    const b = bridge();
    renderPS({ tester: true });
    await scan();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    fireEvent.click(await screen.findByText("LabelThing-9"));
    await screen.findByTestId("ps-tester-card");
    return b;
  }
  it("an unlisted printer opens the Printer test card — never saved, no Save, the 'after Admin adds it' line", async () => {
    const b = await openCard();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
    expect(screen.getByTestId("ps-tester-no-save").textContent).toBe(t.rd_prt_no_save);
    expect(screen.queryByText(/^Save$/)).toBeNull();
    expect(screen.queryByTestId("ps-saved")).toBeNull();
  });
  for (const [lang, check] of [
    ["tspl", (b: Buffer) => b.toString("latin1").includes("BITMAP")],
    ["escpos", (b: Buffer) => b[0] === 0x1b && b[1] === 0x40 && b[2] === 0x1d && b[3] === 0x76],
    ["cpcl", (b: Buffer) => b.toString("latin1").startsWith("! 0 200 200 ")],
  ] as const) {
    it(`language ${lang} → the generic ${lang} bytes at the chosen size through testGenericPrinter (nothing saved)`, async () => {
      const b = await openCard();
      fireEvent.click(screen.getByTestId(`ps-tester-lang-${lang}`));
      fireEvent.click(screen.getByTestId("ps-tester-print"));
      await waitFor(() => expect(b.testGenericPrinter).toHaveBeenCalledTimes(1));
      const arg = b.testGenericPrinter.mock.calls[0][0] as { address: string; transport: string; data: string };
      expect(arg.address).toBe("LabelThing-9-addr");
      expect(arg.transport).toBe("ble");
      expect(check(Buffer.from(arg.data, "base64"))).toBe(true);
      expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
      expect(b.printRawTspl).not.toHaveBeenCalled();
      await screen.findByTestId("ps-tester-question");
    });
  }
  it("Yes, clean needs a photo before it sends; No sends without one", async () => {
    await openCard();
    fireEvent.click(screen.getByTestId("ps-tester-lang-cpcl"));
    fireEvent.click(screen.getByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    fireEvent.click(screen.getByTestId("ps-tester-yes"));
    const send = screen.getByTestId("ps-tester-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(submitSpy).not.toHaveBeenCalled();
    const file = new File([new Uint8Array([1, 2, 3])], "s.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("ps-tester-photo-input"), { target: { files: [file] } });
    await screen.findByTestId("ps-tester-photo-ok");
    expect((screen.getByTestId("ps-tester-send") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("ps-tester-send"));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    const r = (submitSpy.mock.calls[0] as unknown[])[0] as { clean: boolean; photo: Blob | null; lang: string; stickerSize: string; send: { ok: boolean } };
    expect(r.clean).toBe(true); expect(r.photo).toBeTruthy(); expect(r.lang).toBe("cpcl"); expect(r.stickerSize).toBe("60x40mm"); expect(r.send.ok).toBe(true);
    await screen.findByTestId("ps-tester-sent");
  });
  it("No sends at once, without a photo", async () => {
    await openCard();
    fireEvent.click(screen.getByTestId("ps-tester-lang-tspl"));
    fireEvent.click(screen.getByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    fireEvent.click(screen.getByTestId("ps-tester-no"));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    const r = (submitSpy.mock.calls[0] as unknown[])[0] as { clean: boolean; photo: Blob | null };
    expect(r.clean).toBe(false); expect(r.photo).toBeNull();
  });
  it("a tester picking a LISTED printer gets today's save flow", async () => {
    const b = bridge();
    renderPS({ tester: true });
    await scan();
    fireEvent.click(screen.getByText("XP-420B"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "XP-420B-addr", name: "XP-420B", transport: "ble", model: "generic", lang: "tspl" }));
    expect(screen.queryByTestId("ps-tester-card")).toBeNull();
  });
});

describe("helpers", () => {
  it("defaultPrefix: up to the first '-', else before the first digit run", () => {
    expect(defaultPrefix("LabelThing-9")).toBe("LabelThing-");
    expect(defaultPrefix("Q2-ABC123")).toBe("Q2-");
    expect(defaultPrefix("PRINTER123456")).toBe("PRINTER");
    expect(defaultPrefix("Zebra")).toBe("Zebra");
    expect(defaultPrefix("7ABC")).toBe("7ABC");
  });
  it("bleFactsOf: only printer facts (no buyer data)", () => {
    expect(bleFactsOf(dev("LabelThing-9", { likely: true, signal: -60 }))).toEqual({ transport: "ble", likely: true, model: "generic", brand: null, paired: null, signal: -60, services: null, write_char: null, notify_char: null });
  });
});
