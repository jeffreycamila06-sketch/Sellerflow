// Printer setup help (sql/230) — the seller's Printer test card in "tuning" mode on Printer Settings.
//  · shown ONLY when my_printer_tuning() says tester (RedesignApp passes `tuningHelp` only then), for a SAVED
//    printer that can be tuned (never the AIMO D520, a Niimbot or a built-in model);
//  · no language picker; one line "Admin is helping you set up this printer.";
//  · Test print = the real print route (the seller's own tuning applies to the bytes);
//  · Yes needs a photo; No sends the report — both carry the tuning version it printed with;
//  · not a tester any more → no card, and the saved tuning keeps printing.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEF_SETTINGS } from "../../adapters/printing";
import { __resetSavedPrinter } from "../../adapters/savedPrinter";
import { setMyPrinterTuning, __resetPrinterTuning, usePrinterTuning, parseMyTuning, loadMyPrinterTuning } from "../../adapters/printerTuning";
import { setApprovedPrinters } from "../../adapters/printerModels";
import type { BluetoothPrinterDevice } from "../../adapters/printerBridge";
import PrinterSettings from "../../screens/PrinterSettings";
import { TProvider, buildT } from "../../i18n";

vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: vi.fn(async () => ({})), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: vi.fn(async () => { throw new Error("no font C"); }), loadCjkRegAtlas: vi.fn(async () => { throw new Error("no font C"); }) }));
const submitSpy = vi.fn(async (_r: unknown) => ({ ok: true as const }));
vi.mock("../../adapters/printerTesters", async (orig) => {
  const real = await orig<typeof import("../../adapters/printerTesters")>();
  return { ...real, submitPrinterTestReport: (r: unknown) => submitSpy(r) };
});
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../supabase", async (orig) => {
  const real = await orig<typeof import("../../../supabase")>();
  return { ...real, isSupabaseConfigured: true, supabase: { rpc, from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }), auth: { getSession: async () => ({ data: { session: null } }) } } };
});

const t = buildT("en") as unknown as Record<string, string>;
type W = { SellerFlowPrinter?: unknown };
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetSavedPrinter(); __resetPrinterTuning(); setApprovedPrinters(null); submitSpy.mockClear(); rpc.mockReset(); });

const AE241: BluetoothPrinterDevice = { id: "b:AE", address: "AE-addr", name: "AE241-BT_C11D-LE", transport: "ble", model: "generic", lang: "tspl" };
function bridge(saved: BluetoothPrinterDevice | null) {
  const b: Record<string, ReturnType<typeof vi.fn>> = {
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [] })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: saved })),
    clearBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: null })),
    setBluetoothLabelPrinter: vi.fn(async (p: BluetoothPrinterDevice) => ({ ok: true, savedPrinter: p })),
    getPrinter: vi.fn(async () => ({ ok: false })),
    printStickerNative: vi.fn(async () => ({ ok: true })),
    printStickerBitmap: vi.fn(async () => ({ ok: true })),
    printRawTspl: vi.fn(async () => ({ ok: true })),
    printStickerImage: vi.fn(async () => ({ ok: true })),
  };
  (window as W).SellerFlowPrinter = b;
  return b;
}
const renderPS = (props: { tuningHelp?: { version: number | null } } = {}) => render(
  <TProvider lang="en">
    <PrinterSettings onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}} psSize="60x40mm" psSizeOpen={false}
      onTogglePsSize={() => {}} onPickPsSize={() => {}} settings={{ ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" }} flowV2 {...props} />
  </TProvider>,
);
const tsplOf = (b: ReturnType<typeof bridge>) => Buffer.from((b.printRawTspl.mock.calls[0][0] as { data: string }).data, "base64").toString("latin1");

describe("the card is shown only to testers, for a printer that can be tuned", () => {
  it("not a tester (no tuningHelp) → no card", async () => {
    bridge(AE241);
    renderPS();
    await waitFor(() => expect(screen.getAllByText("AE241-BT_C11D-LE").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("ps-tuning-card")).toBeNull();
  });
  it("tester + an approved printer saved → the card, no language picker, the Admin line", async () => {
    bridge(AE241);
    renderPS({ tuningHelp: { version: 3 } });
    const card = await screen.findByTestId("ps-tuning-card");
    expect(card.textContent).toContain(t.rd_ptt_help);
    expect(card.textContent).toContain("AE241-BT_C11D-LE");
    expect(screen.queryByTestId("ps-tester-lang-tspl")).toBeNull();
    expect(screen.queryByTestId("ps-tester-no-save")).toBeNull();
    expect(card.textContent).not.toMatch(/density|speed|gap|shift|flip|sensor|BLINE|DENSITY/i);  // never a setting name
  });
  for (const [label, p] of [
    ["AIMO D520", { ...AE241, name: "D520BT-Z", model: "D520BT" as const }],
    ["Niimbot", { ...AE241, name: "B21-C123", transport: "niimbot" as const }],
    ["built-in XP-420B", { ...AE241, name: "XP-420B" }],
    ["built-in Y41BT", { ...AE241, name: "Y41BT-0FC4_LE" }],
  ] as [string, BluetoothPrinterDevice][]) {
    it(`tester + ${label} saved → no card (can't be tuned)`, async () => {
      bridge(p);
      renderPS({ tuningHelp: { version: 3 } });
      await waitFor(() => expect(screen.getAllByText(p.name).length).toBeGreaterThan(0));
      expect(screen.queryByTestId("ps-tuning-card")).toBeNull();
    });
  }
  it("no printer saved → no card", async () => {
    bridge(null);
    renderPS({ tuningHelp: { version: null } });
    await waitFor(() => expect(screen.getByTestId("ps-scan")).toBeTruthy());
    expect(screen.queryByTestId("ps-tuning-card")).toBeNull();
  });
});

describe("Test print → clean? → report with the tuning version", () => {
  it("the test sticker goes the real route and carries the seller's tuning; No sends the report", async () => {
    setMyPrinterTuning({ enabled: false, tester: true, tuning: { sensor: "bline", gapMm: 3, density: 12 }, version: 3, printerName: "AE241-BT_C11D-LE" });
    const b = bridge(AE241);
    renderPS({ tuningHelp: { version: 3 } });
    fireEvent.click(await screen.findByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    expect(b.printRawTspl).toHaveBeenCalledTimes(1);
    expect(tsplOf(b)).toContain("BLINE 3 mm, 0");
    expect(tsplOf(b)).toContain("DENSITY 12");
    fireEvent.click(screen.getByTestId("ps-tester-no"));
    await screen.findByTestId("ps-tester-sent");
    expect(screen.getByTestId("ps-tester-sent").textContent).toBe(t.rd_ptt_sent);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0][0]).toMatchObject({ clean: false, lang: "tspl", tuningVersion: 3, photo: null });
    fireEvent.click(screen.getByTestId("ps-tuning-again"));
    expect(screen.getByTestId("ps-tester-print")).toBeTruthy();
  });
  it("Admin changes a setting between two taps → the next test prints the NEW setting and reports its version", async () => {
    rpc.mockResolvedValueOnce({ data: { enabled: false, tester: true, settings: { density: 9 }, version: 4, printer_name: "AE241-BT_C11D-LE" }, error: null });
    setMyPrinterTuning(await loadMyPrinterTuning("u-seller"));
    const b = bridge(AE241);
    renderPS({ tuningHelp: { version: 4 } });
    rpc.mockResolvedValueOnce({ data: { enabled: false, tester: true, settings: { density: 9 }, version: 4, printer_name: "AE241-BT_C11D-LE" }, error: null });
    fireEvent.click(await screen.findByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    expect(tsplOf(b)).toContain("DENSITY 9");
    // Admin saves version 5 (darkness 13) while the card is open
    rpc.mockResolvedValueOnce({ data: { enabled: false, tester: true, settings: { density: 13 }, version: 5, printer_name: "AE241-BT_C11D-LE" }, error: null });
    b.printRawTspl.mockClear();
    fireEvent.click(screen.getByTestId("ps-tester-print"));
    await waitFor(() => expect(b.printRawTspl).toHaveBeenCalledTimes(1));
    expect(tsplOf(b)).toContain("DENSITY 13");
    fireEvent.click(await screen.findByTestId("ps-tester-no"));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    expect(submitSpy.mock.calls[0][0]).toMatchObject({ tuningVersion: 5 });
    expect(rpc).toHaveBeenCalledTimes(3);                                      // one read per tap, no timer
  });
  it("the tuning was made for ANOTHER printer → the test prints as today and reports no tuning version", async () => {
    setMyPrinterTuning({ enabled: false, tester: true, tuning: { density: 12 }, version: 6, printerName: "CT221B-D4F8" });
    const b = bridge(AE241);
    renderPS({ tuningHelp: { version: 6 } });
    fireEvent.click(await screen.findByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    expect(tsplOf(b)).toContain("DENSITY 8");
    fireEvent.click(screen.getByTestId("ps-tester-no"));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    expect((submitSpy.mock.calls[0][0] as { tuningVersion?: unknown }).tuningVersion).toBeNull();
  });
  it("Yes needs a photo before Send; the report carries the tuning version", async () => {
    setMyPrinterTuning({ enabled: false, tester: true, tuning: { density: 10 }, version: 7, printerName: "AE241-BT_C11D-LE" });
    bridge(AE241);
    renderPS({ tuningHelp: { version: 7 } });
    fireEvent.click(await screen.findByTestId("ps-tester-print"));
    fireEvent.click(await screen.findByTestId("ps-tester-yes"));
    expect((screen.getByTestId("ps-tester-send") as HTMLButtonElement).disabled).toBe(true);
  });
  it("no tuning yet (version null) → the report has no tuning version", async () => {
    const b = bridge(AE241);
    renderPS({ tuningHelp: { version: null } });
    fireEvent.click(await screen.findByTestId("ps-tester-print"));
    await screen.findByTestId("ps-tester-question");
    expect(tsplOf(b)).toContain("GAP 2 mm, 0");                       // today's job
    fireEvent.click(screen.getByTestId("ps-tester-no"));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    expect((submitSpy.mock.calls[0][0] as { tuningVersion?: unknown }).tuningVersion).toBeNull();
  });
});

describe("the database decides tester; the app only passes it on", () => {
  it("usePrinterTuning: tester false → the card's prop is never passed; the saved tuning still prints", async () => {
    rpc.mockResolvedValue({ data: { enabled: false, tester: false, settings: { density: 11 }, version: 5, printer_name: "AE241-BT_C11D-LE" }, error: null });
    const { result } = renderHook(() => usePrinterTuning("u1"));
    await waitFor(() => expect(result.current.version).toBe(5));
    expect(result.current.tester).toBe(false);
    expect(result.current.tuning).toEqual({ density: 11 });          // removed from Testers: tuning keeps printing
  });
  it("another user signs in → the previous user's tuning is dropped at once (before the new read answers)", async () => {
    setMyPrinterTuning({ enabled: false, tester: true, tuning: { density: 3 }, version: 2, printerName: "AE241-BT_C11D-LE" });
    rpc.mockReturnValue(new Promise(() => {}));                               // the new user's read never answers
    renderHook(() => usePrinterTuning("u-other"));
    const { tuningFor } = await import("../../adapters/printerTuning");
    expect(tuningFor("AE241-BT_C11D-LE")).toBeNull();
  });
  it("signed out → nothing; a failed read → nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    const { result } = renderHook(() => usePrinterTuning("u2"));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(result.current).toEqual(parseMyTuning(null));
    const s = renderHook(() => usePrinterTuning(null));
    expect(s.result.current.tester).toBe(false);
  });
  it("RedesignApp passes tuningHelp ONLY when my_printer_tuning says tester", () => {
    const src = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
    expect(src).toContain("{...(printerTuning.tester ? { tuningHelp: { version: printerTuning.version } } : {})}");
    expect(src.match(/tuningHelp/g)?.length).toBe(1);
  });
});
