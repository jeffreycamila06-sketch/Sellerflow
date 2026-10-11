import { describe, it, expect } from "vitest";
import { parseZip, readEntryText } from "../shippingXlsmPatch";
import { rowsOf } from "../parcelExportRead";
import {
  buildFmXlsx, fmScanCells, splitForExport, validateFmScan, fmExportFilename, inputToDb,
  FM_SCAN_HEADERS, FM_SCAN_MAX_PER_FILE, type FmScanInput,
} from "../fmScan";

const TODAY = "2026-10-11";
const ok: FmScanInput = { recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: "500", shippingFee: "39", orderDate: "2026-10-11", buyerUsername: "@budgetukay.official_live2026" };
const parcel = { recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-10-11", buyerUsername: "@budgetukay.official_live2026" };

async function sheetOf(bytes: Uint8Array) {
  const entries = parseZip(bytes);
  const by = new Map(entries.map((e) => [e.name, e]));
  const wb = await readEntryText(bytes, by.get("xl/workbook.xml")!);
  const xml = await readEntryText(bytes, by.get("xl/worksheets/sheet1.xml")!);
  return { wb, xml, rows: rowsOf(xml, []), names: entries.map((e) => e.name) };
}

describe("buildFmXlsx — 好賣+ 大量匯單 layout", () => {
  it("one sheet 大量匯單, instructions on top, headers on row 19, data from row 20, all text cells", async () => {
    const { wb, xml, rows, names } = await sheetOf(buildFmXlsx([parcel, { ...parcel, phone: "0912345678", buyerUsername: "" }]));
    expect(names).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]));
    expect(wb.match(/<sheet /g)).toHaveLength(1);
    expect(wb).toContain('name="大量匯單"');
    const r = (n: number) => rows.find((x) => x.rn === n)?.cells ?? {};
    expect(r(1).A).toBe("好賣+ 大量匯單");
    expect(r(17).A).toBe("資料驗證成功，請存檔案並回賣場匯入");
    expect(Object.values(r(19))).toEqual(FM_SCAN_HEADERS);
    expect(r(20)).toEqual({ A: "Jeffrey", B: "0958704782", C: "022131", D: "500", E: "39", F: "2026/10/11", G: "@budgetukay.official_live2026" });
    expect(r(21).G).toBe("商品"); // no @username → 商品
    // every cell is a text (inline string) cell — never a number, so leading zeros survive
    const cells = xml.match(/<c [^>]*>/g)!;
    expect(cells.every((c) => c.includes('t="inlineStr"'))).toBe(true);
    expect(xml).not.toMatch(/<c [^>]*><v>/);
    expect(xml).toContain('<dimension ref="A1:G21"/>');
  });
  it("cells: dashes/spaces stripped from phone + store, date as YYYY/MM/DD", () => {
    expect(fmScanCells({ ...parcel, phone: "0958-704-782", storeId: " 022131 ", orderDate: "2026-09-02" }))
      .toEqual(["Jeffrey", "0958704782", "022131", "500", "39", "2026/09/02", "@budgetukay.official_live2026"]);
  });
});

describe("splitForExport — 500 per file", () => {
  it("501 rows → 2 files (500 + 1), 500 → 1", () => {
    const many = Array.from({ length: 501 }, (_, i) => i);
    expect(splitForExport(many).map((c) => c.length)).toEqual([500, 1]);
    expect(splitForExport(many.slice(0, FM_SCAN_MAX_PER_FILE))).toHaveLength(1);
  });
  it("numbered file names only when there is more than one file", () => {
    const now = Date.parse("2026-10-11T09:05:00Z"); // 17:05 Taipei
    expect(fmExportFilename(now, 1, 1)).toBe("familymart_20261011_1705.xlsx");
    expect(fmExportFilename(now, 2, 2)).toBe("familymart_20261011_1705_2.xlsx");
  });
});

describe("validateFmScan — FamilyMart rules", () => {
  it("a good parcel passes", () => { expect(validateFmScan(ok, TODAY)).toEqual({}); });
  it.each([
    [{ recipientName: " " }, "recipientName", "name_required"],
    [{ recipientName: "x".repeat(51) }, "recipientName", "name_long"],
    [{ phone: "0958-704-782" }, "phone", undefined],
    [{ phone: "958704782" }, "phone", "phone"],
    [{ phone: "0858704782" }, "phone", "phone"],
    [{ phone: "09587047821" }, "phone", "phone"],
    [{ storeId: "22131" }, "storeId", "store"],
    [{ storeId: "02213a" }, "storeId", "store"],
    [{ amount: "9" }, "amount", "amount"],
    [{ amount: "20001" }, "amount", "amount"],
    [{ amount: "" }, "amount", "amount"],
    [{ shippingFee: "201" }, "shippingFee", "fee"],
    [{ shippingFee: "-1" }, "shippingFee", "fee"],
    [{ amount: "10", shippingFee: "49" }, "total", "total"],
    [{ amount: "10", shippingFee: "50" }, "total", undefined],
    [{ amount: "19900", shippingFee: "101" }, "total", "total"],
    [{ orderDate: "2026-08-12" }, "orderDate", undefined],
    [{ orderDate: "2026-08-11" }, "orderDate", "date"],
    [{ orderDate: "2026-10-12" }, "orderDate", "date"],
    [{ orderDate: "" }, "orderDate", "date"],
    [{ buyerUsername: "x".repeat(101) }, "buyerUsername", "username_long"],
  ] as [Partial<FmScanInput>, string, string | undefined][])("%j → %s %s", (patch, field, want) => {
    expect((validateFmScan({ ...ok, ...patch }, TODAY) as Record<string, string>)[field]).toBe(want);
  });
  it("saved row is normalized (no dashes, @username kept, blank → null)", () => {
    expect(inputToDb({ ...ok, phone: "0958 704 782", buyerUsername: " " })).toMatchObject({ phone: "0958704782", store_id: "022131", amount: 500, shipping_fee: 39, buyer_username: null });
  });
});
