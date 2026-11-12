import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseZip, readEntryText } from "../shippingXlsmPatch";
import { rowsOf } from "../parcelExportRead";
import {
  buildFmXlsx, fmScanCells, splitForExport, validateFmScan, validateFmScanForSave, fmExportFilename, inputToDb, FM_ERROR_KEY,
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

// FamilyMart store # = 6 digits starting with 0 — asked when a parcel is SAVED (new, edit, Import).
describe("validateFmScanForSave — the store # starts with 0", () => {
  it.each([
    ["022131", undefined],
    ["0 2 2 1 3 1", undefined],
    ["122131", "store_zero"], // 6 digits, not starting with 0
    ["1", "store_zero"],      // told at the first digit
    ["0221", "store"],        // starts with 0, not 6 digits yet → the 6-digit message
    ["", "store"],
  ] as [string, string | undefined][])("store %j → %s", (storeId, want) => {
    expect(validateFmScanForSave({ ...ok, storeId }, TODAY).storeId).toBe(want);
  });
  it("every other rule is validateFmScan's", () => {
    expect(validateFmScanForSave(ok, TODAY)).toEqual({});
    const bad = { ...ok, phone: "0858", amount: "9", recipientName: " " };
    expect(validateFmScanForSave(bad, TODAY)).toEqual(validateFmScan(bad, TODAY));
  });
  it("parcels already saved are judged as before: validateFmScan has no starts-with-0 rule", () => {
    expect(validateFmScan({ ...ok, storeId: "122131" }, TODAY)).toEqual({});
  });
  it("the message exists in all 8 languages", async () => {
    const { buildT } = await import("../../i18n");
    expect(FM_ERROR_KEY.store_zero).toBe("rd_fms_e_store_zero");
    expect(buildT("en").rd_fms_e_store_zero).toBe("FamilyMart store # starts with 0 (6 digits).");
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const msg = buildT(lang).rd_fms_e_store_zero;
      expect(msg).toContain("0");
      expect(msg).toContain("6");
      if (lang !== "en") expect(msg).not.toBe(buildT("en").rd_fms_e_store_zero);
    }
  });
});

describe("help guide — FamilyMart store # (sql/152, one row)", () => {
  const OLD = "FamilyMart store # (6 digits — ", NEW = "FamilyMart store # (6 digits starting with 0 — ";
  it("the guide and the generated seed carry the new words", () => {
    for (const f of ["docs/support/sfl-guide.md", "sql/116b_guide_seed.sql"]) {
      const txt = readFileSync(f, "utf8");
      expect(txt).toContain(NEW);
      expect(txt).not.toContain(OLD);
    }
  });
  it("sql/152 replaces that phrase in the 'parcel-scan' row only; the rollback puts it back", () => {
    const sql = readFileSync("sql/152_guide_fm_store_zero.sql", "utf8");
    expect(sql).toContain(`replace(body, '${OLD}', '${NEW}')`);
    expect(sql).toContain("where id = 'parcel-scan'");
    expect(sql.match(/\bupdate\b/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(insert|delete|drop|alter|create)\b/i);
    const back = readFileSync("sql/152_guide_fm_store_zero_rollback.sql", "utf8");
    expect(back).toContain(`replace(body, '${NEW}', '${OLD}')`);
    expect(back).toContain("where id = 'parcel-scan'");
  });
});
