// C4 (audit) — unit tests for the xlsm zip-patcher's PURE helpers. The end-to-end
// real-template contract (byte-identical non-sheet entries, vbaProject exact,
// size window) already lives in shippingExport.test.ts; this file covers the
// primitives + error paths that end-to-end can't isolate: crc32 correctness,
// XML escaping, the empty-cell-omits-node rule, <dimension> update, sheet-path
// resolution failures, and a STORED-entry zip round-trip.
import { describe, it, expect } from "vitest";
import {
  crc32,
  escapeXml,
  rowsToSheetXml,
  patchSheetXml,
  resolveSheetPath,
  buildZip,
  parseZip,
  readEntryRaw,
  readEntryText,
} from "../shippingXlsmPatch";

const te = new TextEncoder();

describe("crc32", () => {
  it("matches the standard CRC-32 check vector ('123456789' → 0xCBF43926)", () => {
    expect(crc32(te.encode("123456789")) >>> 0).toBe(0xcbf43926);
  });
  it("empty input → 0", () => {
    expect(crc32(new Uint8Array(0)) >>> 0).toBe(0);
  });
});

describe("escapeXml", () => {
  it("escapes all five XML specials, leaves the rest verbatim", () => {
    expect(escapeXml(`a&b<c>d"e'f 中文 09`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f 中文 09");
  });
});

describe("rowsToSheetXml", () => {
  it("emits inlineStr cells with correct A..J refs from startRow", () => {
    const xml = rowsToSheetXml([["Maria", "0912345678"]], 7);
    expect(xml).toContain('<row r="7" spans="1:10">');
    expect(xml).toContain('<c r="A7" t="inlineStr">');
    expect(xml).toContain('<c r="B7" t="inlineStr">');
    expect(xml).toContain('<t xml:space="preserve">0912345678</t>'); // leading-0 phone survives as text
  });
  it("EMPTY value emits NO cell node (so the column Text @ style rules)", () => {
    const xml = rowsToSheetXml([["A", "", "C"]], 7);
    expect(xml).toContain('<c r="A7"');
    expect(xml).not.toContain('<c r="B7"'); // omitted, not an empty cell
    expect(xml).toContain('<c r="C7"');
  });
  it("second row lands on startRow+1", () => {
    const xml = rowsToSheetXml([["x"], ["y"]], 7);
    expect(xml).toContain('<row r="8"');
  });
});

describe("patchSheetXml", () => {
  const base = '<worksheet><dimension ref="A1:K6"/><sheetData><row r="1"/></sheetData></worksheet>';
  it("inserts rows before </sheetData> and updates <dimension> to the last row", () => {
    const out = patchSheetXml(base, [["a"], ["b"]], 7);
    expect(out).toContain('<dimension ref="A1:K8"/>'); // 7 + 2 rows − 1
    const insertAt = out.indexOf('<row r="7"');
    expect(insertAt).toBeGreaterThan(out.indexOf('<row r="1"/>'));
    expect(insertAt).toBeLessThan(out.indexOf("</sheetData>"));
  });
  it("throws when the sheet has no sheetData (corrupt template)", () => {
    expect(() => patchSheetXml("<worksheet/>", [["a"]], 7)).toThrow(/sheetData/);
  });
});

describe("resolveSheetPath", () => {
  const wb = '<workbook><sheets><sheet name="訂單匯入" sheetId="1" r:id="rId2"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId2" Type="x" Target="worksheets/sheet1.xml"/></Relationships>';
  it("resolves the named sheet through workbook.xml + rels", () => {
    expect(resolveSheetPath(wb, rels, "訂單匯入")).toBe("xl/worksheets/sheet1.xml");
  });
  it("strips a leading slash from the rel target", () => {
    const abs = rels.replace("worksheets/", "/worksheets/");
    expect(resolveSheetPath(wb, abs, "訂單匯入")).toBe("xl/worksheets/sheet1.xml");
  });
  it("throws when the sheet name is missing", () => {
    expect(() => resolveSheetPath(wb, rels, "wrong")).toThrow(/missing from template/);
  });
  it("throws when the relationship id is missing", () => {
    expect(() => resolveSheetPath(wb, "<Relationships/>", "訂單匯入")).toThrow(/relationship missing/);
  });
});

describe("buildZip → parseZip round-trip (STORED entries)", () => {
  it("a stored entry survives with correct name, crc, and readable text", async () => {
    const data = te.encode("<x>hello 訂單</x>");
    const entry = { name: "xl/test.xml", flags: 0, method: 0, time: 0, date: 0, crc: crc32(data), csize: data.length, usize: data.length, data };
    const zip = buildZip([entry]);
    const parsed = parseZip(zip);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("xl/test.xml");
    expect(parsed[0].method).toBe(0);
    expect(Array.from(readEntryRaw(zip, parsed[0]))).toEqual(Array.from(data)); // raw bytes verbatim
    expect(await readEntryText(zip, parsed[0])).toBe("<x>hello 訂單</x>");
  });
});
