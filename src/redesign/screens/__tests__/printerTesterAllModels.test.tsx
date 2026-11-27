// Printer testers, every model: a tester (feature printer_tester, not admin) gets the Printer test card for ANY
// printer that is not built-in — Admin-approved (listed) or not. The built-in five (AIMO D520BT, Flash Y41BT,
// Xprinter XP-420B, Niimbot) keep today's save + test-print path. After a CLEAN report, "Use this printer"
// saves the printer on this device with the language that printed clean, and the next print uses it.
// A non-tester's screen and bridge calls = main 5e5689b0 (fixtures/printerSettings.nonTester.main.json,
// taken on a 5e5689b0 worktree with SFL_PS_DUMP=<file>).
import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as models from "../../adapters/printerModels";
import { printSlip, DEF_SETTINGS, type Settings } from "../../adapters/printing";
import { buildTestBuyer, type BluetoothPrinterDevice } from "../../adapters/printerBridge";
import { __resetSavedPrinter, savedGenericLang } from "../../adapters/savedPrinter";
import PrinterSettings from "../PrinterSettings";
import { TProvider, buildT } from "../../i18n";

vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: vi.fn(async () => ({})), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: vi.fn(async () => { throw new Error("no font C"); }), loadCjkRegAtlas: vi.fn(async () => { throw new Error("no font C"); }) }));
const submitSpy = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }) as { ok: true } | { ok: false; reason: "save_failed" });
vi.mock("../../adapters/printerTesters", async (orig) => {
  const real = await orig<typeof import("../../adapters/printerTesters")>();
  return { ...real, submitPrinterTestReport: (...a: unknown[]) => submitSpy(...a), resizeTestPhoto: async (f: Blob) => new Blob([await f.arrayBuffer()], { type: "image/jpeg" }) };
});

const t = buildT("en") as unknown as Record<string, string>;
type W = { SellerFlowPrinter?: unknown };
afterEach(() => { cleanup(); delete (window as W).SellerFlowPrinter; __resetSavedPrinter(); models.setApprovedPrinters(null); submitSpy.mockClear(); });

const dev = (name: string, extra: Partial<BluetoothPrinterDevice> = {}): BluetoothPrinterDevice => ({ id: `bluetooth:${name}`, address: `${name}-addr`, name, transport: "ble", model: "generic", likely: false, ...extra });
// Admin-approved rows (locked in production: AE241-BT TSPL, PT210L ESC/POS — the tester may still pick another language)
const APPROVED: models.ApprovedPrinter[] = [
  { prefix: "AE241-BT", brand: "Aiyin", model: "AE241-BT", lang: "tspl" },
  { prefix: "PT210L", brand: "Other", model: "PT210L", lang: "escpos", shiftMm: 2, flip: true },
];
const AE241 = dev("AE241-BT_B57A-LE");
const PT210 = dev("PT210L-77");
const D520 = dev("D520BT-Z", { model: "D520BT", likely: true });
const Y41 = dev("Y41BT-0FC4_LE", { likely: true });
const XP420 = dev("XP-420B", { likely: true });
const B1PRO = dev("B1 Pro-I616030055");
const NIIM = dev("Niim-Thing", { brand: "niimbot" });
const UNKNOWN = dev("LabelThing-9", { likely: true });
const ALL = [D520, Y41, XP420, B1PRO, NIIM, AE241, PT210, UNKNOWN];

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
const renderPS = (props: { tester?: boolean; isAdmin?: boolean } = {}) => render(
  <TProvider lang="en">
    <PrinterSettings onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}} psSize="60x40mm" psSizeOpen={false}
      onTogglePsSize={() => {}} onPickPsSize={() => {}} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} flowV2 {...props} />
  </TProvider>,
);
const scanBtn = () => screen.getByTestId("ps-scan") as HTMLButtonElement;
async function scan() { await waitFor(() => expect(scanBtn().disabled).toBe(false)); fireEvent.click(scanBtn()); await screen.findByTestId("ps-v2-list"); }
const savedCard = () => screen.queryByTestId("ps-saved") ?? screen.queryByTestId("ps-saved-warn");
const tap = (name: string) => fireEvent.click(screen.getByText(name).closest("button")!);
async function cleanReport(lang: models.PrinterLang) {
  fireEvent.click(screen.getByTestId(`ps-tester-lang-${lang}`));
  fireEvent.click(screen.getByTestId("ps-tester-print"));
  await screen.findByTestId("ps-tester-question");
  fireEvent.click(screen.getByTestId("ps-tester-yes"));
  fireEvent.change(screen.getByTestId("ps-tester-photo-input"), { target: { files: [new File([new Uint8Array([1, 2, 3])], "s.jpg", { type: "image/jpeg" })] } });
  await screen.findByTestId("ps-tester-photo-ok");
  fireEvent.click(screen.getByTestId("ps-tester-send"));
  await screen.findByTestId("ps-tester-sent");
}

describe("a tester + a listed (Admin-approved) printer → the Printer test card", () => {
  for (const p of [AE241, PT210]) {
    it(`${p.name}: card shown, nothing saved, no test print through the save path`, async () => {
      models.setApprovedPrinters(APPROVED);
      const b = bridge();
      renderPS({ tester: true });
      await scan();
      expect(screen.getByText(p.name).closest("button")!.querySelector("[data-testid=ps-row-brand]")).toBeTruthy(); // it IS on the list
      tap(p.name);
      await screen.findByTestId("ps-tester-card");
      expect(screen.getByTestId("ps-tester-card").textContent).toContain(p.name);
      expect(screen.getByTestId("ps-tester-no-save").textContent).toBe(t.rd_prt_try_note);
      expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
      expect(b.printRawTspl).not.toHaveBeenCalled();
      expect(screen.queryByTestId("ps-printing")).toBeNull();
    });
  }
  it("an unlisted printer (Show all) still gets the card", async () => {
    const b = bridge();
    renderPS({ tester: true });
    await scan();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    fireEvent.click(await screen.findByText(UNKNOWN.name));
    await screen.findByTestId("ps-tester-card");
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });
});

describe("a tester + a built-in printer → today's path (no card)", () => {
  const SAVE: Record<string, unknown> = {
    [D520.name]: { address: D520.address, name: D520.name, transport: "ble" },
    [Y41.name]: { address: Y41.address, name: Y41.name, transport: "ble", model: "generic", lang: "tspl" },
    [XP420.name]: { address: XP420.address, name: XP420.name, transport: "ble", model: "generic", lang: "tspl" },
  };
  for (const p of [D520, Y41, XP420]) {
    it(`${p.name}: saved at once + one test print, no card (approved rows loaded)`, async () => {
      models.setApprovedPrinters(APPROVED);
      const b = bridge();
      renderPS({ tester: true });
      await scan();
      tap(p.name);
      await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith(SAVE[p.name]));
      await waitFor(() => expect(savedCard()).toBeTruthy());
      expect(screen.queryByTestId("ps-tester-card")).toBeNull();
    });
  }
  for (const p of [B1PRO, NIIM]) {
    it(`${p.name} (Niimbot): today's Niimbot path, no card`, async () => {
      bridge();
      renderPS({ tester: true });
      await scan();
      tap(p.name);
      await waitFor(() => expect(screen.queryByTestId("ps-printing") ?? screen.queryByTestId("ps-v2-panel") ?? savedCard()).toBeTruthy());
      expect(screen.queryByTestId("ps-tester-card")).toBeNull();
    });
  }
  it("an admin who is also a tester: a listed printer is saved straight away (today's admin path)", async () => {
    models.setApprovedPrinters(APPROVED);
    const b = bridge();
    renderPS({ tester: true, isAdmin: true });
    await scan();
    tap(PT210.name);
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: PT210.address, name: PT210.name, transport: "ble", model: "generic", lang: "escpos" }));
    expect(screen.queryByTestId("ps-tester-card")).toBeNull();
  });
});

describe("after a CLEAN report → \"Use this printer\"", () => {
  it("saves the printer with the language that printed clean; the next print uses that language", async () => {
    models.setApprovedPrinters(APPROVED);
    const b = bridge();
    renderPS({ tester: true });
    await scan();
    tap(PT210.name); // approved as ESC/POS — the tester finds CPCL prints clean
    await screen.findByTestId("ps-tester-card");
    expect(screen.queryByTestId("ps-tester-use")).toBeNull(); // not before a clean report
    await cleanReport("cpcl");
    expect(screen.getByTestId("ps-tester-sent").textContent).toBe("Report sent to Admin. CPCL printed clean — you can use this printer now.");
    fireEvent.click(screen.getByTestId("ps-tester-use"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: PT210.address, name: PT210.name, transport: "ble", model: "generic", lang: "cpcl" }));
    expect(b.setBluetoothLabelPrinter).toHaveBeenCalledTimes(1);
    await screen.findByTestId("ps-saved");
    expect(screen.queryByTestId("ps-tester-card")).toBeNull();
    expect(savedGenericLang()).toBe("cpcl");
    const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "60x40" };
    printSlip(buildTestBuyer(), "NT$", "Store", cfg);
    await waitFor(() => expect(b.printRawTspl).toHaveBeenCalledTimes(1));
    const bytes = Buffer.from((b.printRawTspl.mock.calls[0][0] as { data: string }).data, "base64");
    expect(bytes.toString("latin1").startsWith("! 0 200 200 ")).toBe(true); // CPCL, not the row's ESC/POS
  });
  it("a listed printer keeps its locked shift / flip after Use (printing reads them by name)", async () => {
    models.setApprovedPrinters(APPROVED);
    bridge();
    renderPS({ tester: true });
    await scan();
    tap(PT210.name);
    await screen.findByTestId("ps-tester-card");
    await cleanReport("tspl");
    fireEvent.click(screen.getByTestId("ps-tester-use"));
    await screen.findByTestId("ps-saved");
    expect(models.approvedLayoutFor(PT210.name)).toEqual({ flip: true, shiftDots: 16 });
  });
  it("an unlisted printer: Use saves it in the clean language too", async () => {
    const b = bridge();
    renderPS({ tester: true });
    await scan();
    fireEvent.click(screen.getByTestId("ps-v2-show-all"));
    fireEvent.click(await screen.findByText(UNKNOWN.name));
    await screen.findByTestId("ps-tester-card");
    await cleanReport("escpos");
    fireEvent.click(screen.getByTestId("ps-tester-use"));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: UNKNOWN.address, name: UNKNOWN.name, transport: "ble", model: "generic", lang: "escpos" }));
  });
  it("a \"No\" report → no Use button; a failed report → no Use button", async () => {
    models.setApprovedPrinters(APPROVED);
    const b = bridge();
    renderPS({ tester: true });
    await scan();
    tap(AE241.name);
    await screen.findByTestId("ps-tester-card");
    fireEvent.click(screen.getByTestId("ps-tester-lang-tspl"));
    fireEvent.click(screen.getByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    fireEvent.click(screen.getByTestId("ps-tester-no"));
    await screen.findByTestId("ps-tester-sent");
    expect(screen.getByTestId("ps-tester-sent").textContent).toBe(t.rd_prt_sent_try);
    expect(screen.queryByTestId("ps-tester-use")).toBeNull();
    fireEvent.click(screen.getByTestId("ps-tester-close"));
    submitSpy.mockResolvedValueOnce({ ok: false, reason: "save_failed" });
    tap(AE241.name);
    await screen.findByTestId("ps-tester-card");
    fireEvent.click(screen.getByTestId("ps-tester-lang-tspl"));
    fireEvent.click(screen.getByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    fireEvent.click(screen.getByTestId("ps-tester-yes"));
    fireEvent.change(screen.getByTestId("ps-tester-photo-input"), { target: { files: [new File([new Uint8Array([1])], "s.jpg", { type: "image/jpeg" })] } });
    await screen.findByTestId("ps-tester-photo-ok");
    fireEvent.click(screen.getByTestId("ps-tester-send"));
    await screen.findByTestId("ps-tester-error");
    expect(screen.queryByTestId("ps-tester-use")).toBeNull();
    expect(b.setBluetoothLabelPrinter).not.toHaveBeenCalled();
  });
});

// ── a non-tester: the screen and every bridge call = main 5e5689b0 ─────────────────────────────
const FIX = resolve(__dirname, "fixtures/printerSettings.nonTester.main.json");
const DUMP = process.env.SFL_PS_DUMP || "";
const want: Record<string, unknown> = !DUMP && existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")).cases : {};
const got: Record<string, unknown> = {};
afterAll(() => { if (DUMP) writeFileSync(DUMP, JSON.stringify({ _note: "non-tester Printer settings: DOM + bridge calls, taken on main 5e5689b0. printerTesterAllModels.test.tsx", cases: got }, null, 1) + "\n"); });
const calls = (b: ReturnType<typeof bridge>) => Object.fromEntries(Object.entries(b).map(([k, f]) => [k, f.mock.calls.map((c) => {
  const a = c[0] as Record<string, unknown> | undefined;
  return a && typeof a.data === "string" ? { ...a, data: `len:${(a.data as string).length}` } : a ?? null;
})]).filter(([, v]) => (v as unknown[]).length));
describe("a non-tester: same screen + same bridge calls as main", () => {
  // the test sticker prints the day and time → pin the clock (a fingerprint must never depend on the day)
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.UTC(2026, 10, 27, 6, 5))); });
  afterAll(() => { vi.useRealTimers(); });
  for (const name of [AE241.name, PT210.name, D520.name, Y41.name, XP420.name]) {
    it(`scan + tap ${name}`, async () => {
      models.setApprovedPrinters(APPROVED);
      const b = bridge();
      const { container } = renderPS();
      await scan();
      const listHtml = screen.getByTestId("ps-v2-list").outerHTML;
      tap(name);
      await waitFor(() => expect(savedCard()).toBeTruthy());
      const r = { listHtml, afterHtml: container.innerHTML, calls: calls(b) };
      got[name] = r;
      if (!DUMP) expect(r).toEqual(want[name]);
    });
  }
  it("the fixture covers every case", () => { if (!DUMP) expect(Object.keys(want).sort()).toEqual([AE241.name, PT210.name, D520.name, Y41.name, XP420.name].sort()); });
});
