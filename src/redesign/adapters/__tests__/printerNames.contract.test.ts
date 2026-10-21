// Printer-name list — kept in ONE place per platform, pinned EQUAL across web / Android /
// iOS here (same entries, same order). Also the name match itself + the exclusions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRINTER_NAME_PREFIXES, NIIMBOT_NAME_PREFIXES, matchesPrinterName, isNiimbotName, isPrinterOnlyRow, brandOf } from "../printerModels";

const java = readFileSync("mobile/android/app/src/main/java/com/sellerflow/live/BleStickerLogic.java", "utf8");
const swift = readFileSync("mobile/ios/App/App/SellerFlowPrinterPlugin.swift", "utf8");
const strings = (block: string): string[] => Array.from(block.matchAll(/"([^"]+)"/g), (m) => m[1]);
const javaList = (name: string) => strings(java.slice(java.indexOf(`${name} = {`), java.indexOf("};", java.indexOf(`${name} = {`))));
const swiftList = (name: string) => { const open = swift.indexOf(`${name}: [String] = [`) + `${name}: [String] = [`.length; return strings(swift.slice(open, swift.indexOf("]", open))); };

describe("printer-name list parity", () => {
  it("Android == web", () => {
    expect(javaList("PRINTER_NAME_PREFIXES")).toEqual([...PRINTER_NAME_PREFIXES]);
    expect(javaList("NIIMBOT_NAME_PREFIXES")).toEqual([...NIIMBOT_NAME_PREFIXES]);
  });
  it("iOS == web", () => {
    expect(swiftList("printerNamePrefixes")).toEqual([...PRINTER_NAME_PREFIXES]);
    expect(swiftList("niimbotNamePrefixes")).toEqual([...NIIMBOT_NAME_PREFIXES]);
  });
  it("the Niimbot prefixes are a subset of the printer list", () => {
    for (const p of NIIMBOT_NAME_PREFIXES) expect(PRINTER_NAME_PREFIXES).toContain(p);
  });
});

describe("name match", () => {
  it("printers by name, case-insensitive", () => {
    for (const n of ["B1-I603042141", "b21-ABC", "D110-1234", "XP-P323B", "Xprinter_58", "Printer_8A2F", "PRT-200", "PT-210", "MPT-II", "GP-1324D", "HM-A300", "M110-C9", "M02S", "Q30_01", "T02-xx", "HPRT N41", "Munbyn ITPP941", "RPP02N", "Gprinter GP-3120", "Zjiang ZJ-5802"]) {
      expect(matchesPrinterName(n), n).toBe(true);
    }
  });
  it("never a heart-rate band, headphones, watch, laptop, phone", () => {
    for (const n of ["Polar H10 1234", "WH-1000XM4", "Galaxy Watch4", "Jeff MacBook Pro", "Pixel 8", "AirPods Pro", "Mi Band 7", "", undefined]) {
      expect(matchesPrinterName(n), String(n)).toBe(false);
    }
  });
  it("Niimbot by name → brand niimbot; others no brand", () => {
    expect(isNiimbotName("B1-I603042141")).toBe(true);
    expect(isNiimbotName("XP-P323B")).toBe(false);
    expect(brandOf({ name: "B1-I603042141" })).toBe("niimbot");
    expect(brandOf({ name: "XP-P323B", brand: "niimbot" })).toBe("niimbot"); // native tag wins
    expect(brandOf({ name: "Y41BT-0FC4_LE" })).toBeNull();
  });
  it("printer-only rows: service OR name OR brand; paired non-printers stay out", () => {
    expect(isPrinterOnlyRow({ model: "generic", likely: false, name: "B1-I603042141" })).toBe(true);   // Niimbot: no advertised service
    expect(isPrinterOnlyRow({ model: "generic", likely: false, name: "XP-P323B" })).toBe(true);        // classic paired receipt printer
    expect(isPrinterOnlyRow({ model: "generic", likely: true, name: "Y41BT-0FC4_LE" })).toBe(true);    // by service
    expect(isPrinterOnlyRow({ model: "D520BT", likely: true, name: "D520BT-Z" })).toBe(true);
    expect(isPrinterOnlyRow({ model: "generic", likely: false, name: "Jeff MacBook Pro" })).toBe(false);
    expect(isPrinterOnlyRow({ model: "generic", likely: false, name: "Polar H10 1234" })).toBe(false);
  });
});
