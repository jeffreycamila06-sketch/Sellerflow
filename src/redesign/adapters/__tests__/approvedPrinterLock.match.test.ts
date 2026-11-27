// sql/229 changes NOTHING a seller's phone matches: for every one of today's 11 active approved prefixes
// (+ the unit names that scan) and the 5 built-in printers, the language / TSPL job / lane wait / layout
// (shift + flip) / brand-model / known flag are identical whether the rows carry `locked` or not — and the
// seller read still selects exactly today's columns (the new column is never read on a phone).
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseApprovedRows } from "../printerTesters";
import {
  setApprovedPrinters, knownPrinterLang, knownTsplJob, knownGapAfterMs, approvedPrinterFor, approvedLayoutFor, knownPrinterInfo, isKnownPrinter,
} from "../printerModels";

const FIX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/approvedPrinters.live.json"), "utf8")).rows as Record<string, unknown>[];
const before = FIX;                                                                            // the rows today (no locked key)
const after = FIX.map((r, i) => ({ id: `a${i}`, ...r, locked: r.active === true }));             // the same rows after sql/229

// every active prefix as it scans (the prefix itself + a real unit name), and the built-in 5
const NAMES = [
  ...FIX.filter((r) => r.active).map((r) => String(r.prefix)),
  "CT221B-D4F8", "D520-1A2B", "PT210L_30EF", "XP-470B", "SK45_5430L", "XP-460B-Z", "VOZY U9 01", "AE241-BT_B57A-LE", "AE241-BT_C11D-LE",
  "BlueTooth Printer", "4B-2054N-7", "Printer_5E93_BLE",
  "D520BT-Z", "Y41BT-0FC4_LE", "XP-420B", "B1-I603042141", "B1 Pro-I616030055",
];
const BUILT_IN_DEVICES = [{ name: "D520BT-Z", model: "D520BT" }, { name: "Y41BT-0FC4_LE" }, { name: "XP-420B" }, { name: "B1-I603042141", brand: "niimbot" }, { name: "B1 Pro-I616030055", brand: "niimbot" }];
const matched = (rows: Record<string, unknown>[]) => {
  setApprovedPrinters(parseApprovedRows(rows));
  const out: Record<string, unknown> = {};
  for (const n of NAMES) out[n] = { lang: knownPrinterLang(n), job: knownTsplJob(n), gap: knownGapAfterMs(n), approved: approvedPrinterFor(n), layout: approvedLayoutFor(n), info: knownPrinterInfo({ name: n, model: undefined, brand: undefined } as never), known: isKnownPrinter({ name: n, model: undefined } as never) };
  for (const d of BUILT_IN_DEVICES) out[`device:${d.name}`] = { info: knownPrinterInfo(d as never), known: isKnownPrinter(d as never) };
  return out;
};
afterEach(() => setApprovedPrinters(null));

describe("sql/229 — the matched settings before and after are identical", () => {
  it("11 active prefixes + unit names + the 5 built-in printers", () => {
    expect(FIX.filter((r) => r.active)).toHaveLength(11);
    expect(matched(after)).toEqual(matched(before));
  });
  it("not a vacuous comparison: the values are today's real ones", () => {
    const m = matched(after) as Record<string, { lang: string | null; layout: { flip: boolean; shiftDots: number }; info: { brand: string; model: string } | null; approved: unknown }>;
    expect(m["CT221B-D4F8"].layout).toEqual({ flip: true, shiftDots: 16 });
    expect(m["PT210L_30EF"].lang).toBe("escpos");
    expect(m["AE241-BT_B57A-LE"].info).toEqual({ brand: "Aiyin", model: "AE241-BT_B57A-LE", approved: true });
    expect(m["AE241-BT_C11D-LE"].info).toEqual({ brand: "Aiyin", model: "AE241-BT_B57A-LE", approved: true });
    expect(m["XP-470B"].info).toEqual({ brand: "Other", model: "XP-470B", approved: true });       // the active row (the removed duplicate is never read)
    expect(m["D520BT-Z"].approved).toBeNull();                                                      // built-in wins over the "D520" row
    expect(m["D520BT-Z"].info).toEqual({ brand: "AIMO", model: "D520BT" });
    expect(m["Y41BT-0FC4_LE"].lang).toBe("tspl");
    expect(m["B1 Pro-I616030055"].info).toEqual({ brand: "Niimbot", model: "B1 Pro" });
  });
  it("the seller read selects today's columns only — never `locked`", () => {
    const src = readFileSync(resolve(__dirname, "../printerTesters.ts"), "utf8");
    const selects = [...src.matchAll(/from\("approved_printers"\)\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(selects).toEqual(["prefix,brand,model,lang,active,shift_mm,flip", "prefix,brand,model,lang,active"]);
    expect(parseApprovedRows(after)).toEqual(parseApprovedRows(before));
  });
});
