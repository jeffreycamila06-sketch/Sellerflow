// Printer setup v2 — pure helpers: printer-only scan filter, known-model lookup (Part-1
// built-in list, swappable source for Part 2), language retry order, the gate.
import { describe, it, expect, afterEach } from "vitest";
import { knownPrinterLang, isKnownPrinter, isPrinterOnlyRow, nextLang, LANG_ORDER, printerFlowV2Enabled, __setKnownSource } from "../printerModels";
import type { BluetoothPrinterDevice } from "../printerBridge";

const D520: BluetoothPrinterDevice = { id: "bluetooth:AA", address: "AA:AA", name: "D520BT-Z", transport: "ble", model: "D520BT", likely: true };
const Y41: BluetoothPrinterDevice = { id: "bluetooth:BB", address: "BB:BB", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", likely: true };
const UNKNOWN: BluetoothPrinterDevice = { id: "bluetooth:DD", address: "DD:DD", name: "LabelThing-9", transport: "ble", model: "generic", likely: true };
const WATCH: BluetoothPrinterDevice = { id: "bluetooth:CC", address: "CC:CC", name: "Some Watch", transport: "ble", model: "generic", likely: false };
const BONDED_LAPTOP: BluetoothPrinterDevice = { id: "bluetooth:EE", address: "EE:EE", name: "Jeff MacBook", transport: "spp", model: "generic", likely: false, paired: true };

afterEach(() => __setKnownSource(null));

describe("printer-only filter", () => {
  it("keeps D520BTs and devices advertising a printer service; never a paired laptop or watch", () => {
    expect([D520, Y41, UNKNOWN, WATCH, BONDED_LAPTOP].filter(isPrinterOnlyRow)).toEqual([D520, Y41, UNKNOWN]);
  });
});

describe("known-model lookup", () => {
  it("Y41BT* → TSPL (case-insensitive prefix); unknown names → null", () => {
    expect(knownPrinterLang("Y41BT-0FC4_LE")).toBe("tspl");
    expect(knownPrinterLang("y41bt_12")).toBe("tspl");
    expect(knownPrinterLang("LabelThing-9")).toBeNull();
    expect(knownPrinterLang("")).toBeNull();
    expect(knownPrinterLang(undefined)).toBeNull();
  });
  it("✓ Works with SFL = D520BT (by model) or a listed name; everything else is New", () => {
    expect(isKnownPrinter(D520)).toBe(true);
    expect(isKnownPrinter(Y41)).toBe(true);
    expect(isKnownPrinter(UNKNOWN)).toBe(false);
  });
  it("Part 2 only swaps the source — callers see the new list at once", () => {
    __setKnownSource(() => [{ prefix: "LabelThing", lang: "escpos" }]);
    expect(knownPrinterLang("LabelThing-9")).toBe("escpos");
    expect(knownPrinterLang("Y41BT-0FC4_LE")).toBeNull();
    expect(isKnownPrinter(D520)).toBe(true); // the D520BT is known by model, not by the list
  });
});

describe("language retry order", () => {
  it("TSPL first, ESC/POS second, CPCL third, then nothing", () => {
    expect(LANG_ORDER).toEqual(["tspl", "escpos", "cpcl"]);
    expect(nextLang("tspl")).toBe("escpos");
    expect(nextLang("escpos")).toBe("cpcl");
    expect(nextLang("cpcl")).toBeNull();
  });
});

describe("gate", () => {
  it("switch OFF: only admin / the test_printers list; switch ON: everyone", () => {
    expect(printerFlowV2Enabled(false, false, false)).toBe(false);
    expect(printerFlowV2Enabled(true, false, false)).toBe(true);
    expect(printerFlowV2Enabled(false, true, false)).toBe(true);
    expect(printerFlowV2Enabled(false, false, true)).toBe(true);
  });
});
