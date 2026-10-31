// Printer setup v2 — pure helpers: printer-only scan filter, known-model lookup (Part-1
// built-in list, swappable source for Part 2), the WHITELIST (what the scan list shows), the gate.
import { describe, it, expect, afterEach } from "vitest";
import { knownPrinterLang, knownTsplJob, isKnownPrinter, isPrinterOnlyRow, knownPrinterInfo, WHITELIST, printerFlowV2Enabled, __setKnownSource } from "../printerModels";
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
  it("Y41BT* / XP-420B → TSPL (case-insensitive prefix); unknown names → null", () => {
    expect(knownPrinterLang("Y41BT-0FC4_LE")).toBe("tspl");
    expect(knownPrinterLang("y41bt_12")).toBe("tspl");
    expect(knownPrinterLang("XP-420B")).toBe("tspl");
    expect(knownPrinterLang("xp-420b_1F")).toBe("tspl");
    expect(knownPrinterLang("XP-365B")).toBeNull(); // exact model only — no "XP-" family
    expect(knownPrinterLang("LabelThing-9")).toBeNull();
    expect(knownPrinterLang("")).toBeNull();
    expect(knownPrinterLang(undefined)).toBeNull();
  });
  it("known printer = D520BT (by model) or a listed name; everything else is not", () => {
    expect(isKnownPrinter(D520)).toBe(true);
    expect(isKnownPrinter(Y41)).toBe(true);
    expect(isKnownPrinter(UNKNOWN)).toBe(false);
  });
  it("per-model TSPL job header: XP-420B = DENSITY 12 + SPEED 3; every other printer (D520BT, Y41BT, unknown, nothing saved) = {} → today's header", () => {
    expect(knownTsplJob("XP-420B")).toEqual({ density: 12, speed: 3 });
    for (const n of ["Y41BT-0FC4_LE", "D520BT-Z", "LabelThing-9", "XP-365B", "", undefined, null]) expect(knownTsplJob(n), String(n)).toEqual({});
  });
  it("Part 2 only swaps the source — callers see the new list at once", () => {
    __setKnownSource(() => [{ prefix: "LabelThing", lang: "escpos" }]);
    expect(knownPrinterLang("LabelThing-9")).toBe("escpos");
    expect(knownPrinterLang("Y41BT-0FC4_LE")).toBeNull();
    expect(isKnownPrinter(D520)).toBe(true); // the D520BT is known by model, not by the list
  });
});

describe("whitelist (the scan list shows ONLY these)", () => {
  it("AIMO D520BT by native tag or by name, Flash Y41BT by name, Niimbot B-series by name — with brand + model", () => {
    expect(knownPrinterInfo(D520)).toEqual({ brand: "AIMO", model: "D520BT" });
    expect(knownPrinterInfo({ name: "d520bt-z", model: "generic" })).toEqual({ brand: "AIMO", model: "D520BT" }); // an old app build tags nothing
    expect(knownPrinterInfo(Y41)).toEqual({ brand: "Flash", model: "Y41BT" });
    expect(knownPrinterInfo({ name: "B1-I603042141" })).toEqual({ brand: "Niimbot", model: "B1" });
    expect(knownPrinterInfo({ name: "B21-ABC" })).toEqual({ brand: "Niimbot", model: "B21" });
    expect(knownPrinterInfo({ name: "Some label", brand: "niimbot" })).toEqual({ brand: "Niimbot", model: "" }); // native said Niimbot
  });
  it("anything else is NOT listed: an unknown label printer, a watch, a paired laptop, no name", () => {
    for (const p of [UNKNOWN, WATCH, BONDED_LAPTOP, { name: "", model: "generic" as const }, { name: "XP-P323B", model: "generic" as const }, { name: "XP-365B", model: "generic" as const }]) expect(knownPrinterInfo(p), p.name).toBeNull();
    expect(knownPrinterInfo({ name: "XP-420B", model: "generic" })).toEqual({ brand: "Xprinter", model: "XP-420B" });
  });
  it("the list itself: exactly the tested models, each with a brand pill word", () => {
    expect(WHITELIST.map((w) => `${w.brand} ${w.model}`)).toEqual(["AIMO D520BT", "Flash Y41BT", "Niimbot B1", "Niimbot B21", "Niimbot B203", "Niimbot B3S", "Xprinter XP-420B"]);
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
