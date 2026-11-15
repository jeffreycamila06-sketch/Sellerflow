// Niimbot B1 Pro — ADD-ONLY (Jeff 2026-11-15): it scans as "B1 Pro-I616030055" (the "B1-" prefix never
// matched it) and is printed EXACTLY like the B1: same Niimbot driver, same 50 mm limit / sizes, same image.
// Part 2 proves NOTHING CHANGED for every printer that already worked: each answer is computed with
// today's printerModels.ts AND with the frozen origin/main copy (fixtures/printerModels.main.ts) and compared.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as now from "../printerModels";
import * as main from "./fixtures/printerModels.main";
import { oneStickerLimitFor, oneStickerSizesFor } from "../oneStickerPrint";
import { printerLimitFor } from "../oneSticker";
import { printSlip, DEF_SETTINGS, type Settings } from "../printing";
import { buildTestBuyer, type BluetoothPrinterDevice } from "../printerBridge";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import PrinterSettings from "../../screens/PrinterSettings";
import { TProvider } from "../../i18n";

vi.mock("../cjkAtlasLoader", () => ({ loadCjkAtlas: vi.fn(async () => ({})), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
vi.mock("../propAtlasLoader", () => ({ loadPropAtlas: vi.fn(async () => { throw new Error("no font C in this test"); }), loadCjkRegAtlas: vi.fn(async () => { throw new Error("no font C in this test"); }) }));

type W = { SellerFlowPrinter?: unknown };
afterEach(() => { delete (window as W).SellerFlowPrinter; __resetSavedPrinter(); });

const PRO = "B1 Pro-I616030055";
const B1 = "B1-I603042141";

// Everything the app decides from a scanned / saved printer name.
type Mods = Pick<typeof now, "matchesPrinterName" | "isNiimbotName" | "knownPrinterInfo" | "isPrinterOnlyRow" | "brandOf" | "knownPrinterLang" | "knownTsplJob" | "knownGapAfterMs" | "isKnownPrinter">;
function answers(m: Mods, name: string, model: "D520BT" | "generic" = "generic") {
  const niimbot = m.brandOf({ name }) === "niimbot";
  return {
    printerName: m.matchesPrinterName(name),
    niimbotName: m.isNiimbotName(name),
    listed: m.knownPrinterInfo({ name, model }) !== null,
    info: m.knownPrinterInfo({ name, model }),
    printerRow: m.isPrinterOnlyRow({ name, model, likely: false }),
    brand: m.brandOf({ name }),
    lang: m.knownPrinterLang(name),
    job: m.knownTsplJob(name),
    gapAfterMs: m.knownGapAfterMs(name),
    known: m.isKnownPrinter({ name, model }),
    limit: printerLimitFor(name),
    oneLimit: oneStickerLimitFor(name, niimbot),
    sizes: oneStickerSizesFor(name, niimbot),
  };
}

describe("B1 Pro = the B1", () => {
  it("listed for sellers as Niimbot · B1 Pro, Niimbot driver, 50 mm, same sizes as the B1", () => {
    const pro = answers(now, PRO), b1 = answers(now, B1);
    expect(pro.info).toEqual({ brand: "Niimbot", model: "B1 Pro" });
    expect(pro.listed).toBe(true);
    expect(pro.brand).toBe("niimbot");
    expect(pro.niimbotName).toBe(true);
    expect(pro.printerRow).toBe(true);
    expect(pro.limit?.maxLabelMm).toBe(50);
    expect(pro.oneLimit?.maxLabelMm).toBe(50);
    expect(pro.sizes).toEqual(b1.sizes);
    // every other answer is the B1's (only the model name on the row differs)
    expect({ ...pro, info: null }).toEqual({ ...b1, info: null });
  });
  it("case-insensitive, and the first match is the B1 Pro row (not the B1 row)", () => {
    for (const n of ["b1 pro-I616030055", "B1 PRO-X", "  B1 Pro-I616030055 "]) {
      expect(now.knownPrinterInfo({ name: n }), n).toEqual({ brand: "Niimbot", model: "B1 Pro" });
      expect(now.brandOf({ name: n }), n).toBe("niimbot");
    }
    expect(now.knownPrinterInfo({ name: B1 })).toEqual({ brand: "Niimbot", model: "B1" });
  });
  it("on origin/main it was not listed and got no driver (the bug)", () => {
    expect(main.knownPrinterInfo({ name: PRO })).toBeNull();
    expect(main.brandOf({ name: PRO })).toBeNull();
    expect(main.matchesPrinterName(PRO)).toBe(false);
  });
});

describe("save + print", () => {
  const DEV: BluetoothPrinterDevice = { id: "bluetooth:PP", address: "PP:PP", name: PRO, transport: "ble", model: "generic", likely: false };
  function bridge() {
    const b: Record<string, ReturnType<typeof vi.fn>> = {
      scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [DEV] })),
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

  it("a seller (not admin) sees it in the scan list as 'Niimbot B1 Pro'; tapping it saves transport niimbot", async () => {
    const b = bridge();
    render(
      <TProvider lang="en">
        <PrinterSettings onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}} psSize="60x40mm" psSizeOpen={false}
          onTogglePsSize={() => {}} onPickPsSize={() => {}} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} flowV2 isAdmin={false} />
      </TProvider>,
    );
    const scanBtn = () => screen.getByTestId("ps-scan") as HTMLButtonElement;
    await waitFor(() => expect(scanBtn().disabled).toBe(false));
    fireEvent.click(scanBtn());
    await screen.findByText(PRO);
    expect(screen.getByTestId("ps-row-model").textContent).toBe("Niimbot B1 Pro");
    expect(screen.getByTestId("ps-row-brand").textContent).toBe("Niimbot");
    fireEvent.click(screen.getByText(PRO));
    await waitFor(() => expect(b.setBluetoothLabelPrinter).toHaveBeenCalledWith({ address: "PP:PP", name: PRO, transport: "niimbot", model: "generic" }));
    await waitFor(() => expect(b.printStickerImage).toHaveBeenCalledTimes(1));
  });

  it("the sticker image for the same order is byte-equal to the B1's", async () => {
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
    const cfg: Settings = { ...DEF_SETTINGS, printerType: "bluetooth", stickerSize: "60x40" };
    const buyer = buildTestBuyer();
    const imageFor = async (name: string) => {
      __resetSavedPrinter();
      const b = bridge();
      rememberSavedPrinter({ address: "NN:NN", name, model: "generic", transport: "niimbot" });
      printSlip(buyer, "NT$", "Store", cfg);
      await flush();
      await waitFor(() => expect(b.printStickerImage).toHaveBeenCalledTimes(1));
      return (b.printStickerImage.mock.calls[0][0] as { image: unknown }).image;
    };
    const b1 = await imageFor(B1);
    const pro = await imageFor(PRO);
    expect(pro).toEqual(b1);
    expect((pro as { data: string }).data).toBe((b1 as { data: string }).data);
  });
});

describe("NOTHING CHANGED — every printer that already worked gives the same answers as on origin/main", () => {
  const NAMES: [string, "D520BT" | "generic"][] = [
    ["D520BT-Z", "D520BT"], ["D520BT-Z", "generic"], ["D520", "generic"], ["Y41BT-0FC4_LE", "generic"],
    ["XP-420B", "generic"], ["XP-420B-ABCD", "generic"], ["XP-P323B", "generic"],
    ["B1-I603042141", "generic"], ["b1-lower", "generic"], ["B21-ABC", "generic"], ["B203-77", "generic"], ["B3S-01", "generic"],
    ["Printer_8A2F", "generic"], ["GP-1324D", "generic"], ["M110-C9", "generic"], ["HPRT N41", "generic"],
    ["D11-1234", "generic"], ["B18-1", "generic"], ["B1", "generic"], ["B1Pro", "generic"],
    ["LabelThing-9", "generic"], ["Jeff MacBook Pro", "generic"], ["", "generic"],
  ];
  for (const [name, model] of NAMES) {
    it(`${JSON.stringify(name)} (${model})`, () => {
      expect(answers(now, name, model)).toEqual(answers(main, name, model));
    });
  }
  it("the lists only GAINED \"B1 Pro-\" (nothing removed or reordered)", () => {
    expect(now.PRINTER_NAME_PREFIXES.filter((p) => p !== "B1 Pro-")).toEqual([...main.PRINTER_NAME_PREFIXES]);
    expect(now.NIIMBOT_NAME_PREFIXES.filter((p) => p !== "B1 Pro-")).toEqual([...main.NIIMBOT_NAME_PREFIXES]);
    expect(now.WHITELIST.filter((w) => w.prefix !== "B1 Pro-")).toEqual([...main.WHITELIST]);
  });
});
