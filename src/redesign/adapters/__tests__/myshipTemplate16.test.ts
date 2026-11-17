// 7-11 賣貨便 import template 1.6 (2026-11-17): bundled byte for byte under a new name, and the REAL
// export code (both callers: Parcel Scan and the old shipping export) patches only the 訂單匯入 sheet —
// every other zip entry stays byte-identical to 7-11's file, and sheet1 differs only by our rows and
// the <dimension>; 7-11's <sheetProtection> is kept exactly as shipped.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));

import { buildXlsmFromTemplate, entryToXlsRow, fetchShipTemplate, SHIP_TEMPLATE_URL } from "../shippingExport";
import { scanToXlsRow, type ParcelScanRow } from "../parcelScan";
import { parseZip, readEntryRaw, readEntryText } from "../shippingXlsmPatch";
import type { ShippingEntry } from "../shipping";

const FILE = "public/templates/myship-import-template-1.6.xlsm";
const SHA_16 = "91bec9db31a6971b4058b1c9a619735506956af17eb3cdcba5b2fd2ada8ff5a9";
const template = new Uint8Array(readFileSync(FILE));

const scan = (o: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "陳小美", phone: "0912345678", storeId: "982063",
  amount: 550, notes: "buyer_one", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-11-17T02:00:00Z", ...o,
});
const entry = (o: Partial<ShippingEntry> = {}): ShippingEntry => ({
  id: "e1", sessionKey: "2026-11-17", buyerNumber: 5, bagNumber: 1, includedOrderIds: [1], recipientName: "王小明",
  phone: "0987654321", storeId: "123456", tempLayer: "冷凍", productDesc: "#5 商品x2", orderAmount: 1200, shippingFee: 38,
  buyerUsername: "kuyajohn_", status: "encoded", exportBatchId: null, exportedAt: null, shippedAt: null, ...o,
});

const CALLERS: [string, string[][]][] = [
  ["Parcel Scan (scanToXlsRow, ParcelScan.tsx)", [scanToXlsRow(scan(), { storeName: "Budgetukay", fee: 38 }), scanToXlsRow(scan({ id: "r2", customerName: "林大同", storeId: "266402" }), { storeName: "Budgetukay", fee: 38 })]],
  ["old shipping export (entryToXlsRow, Shipping.tsx)", [entryToXlsRow(entry()), entryToXlsRow(entry({ id: "e2", recipientName: "陳大文", tempLayer: "常溫" }))]],
];

describe("the bundled file", () => {
  it("is 7-11's 1.6 file byte for byte (30,316 bytes, sha256 pinned — never re-save it)", () => {
    expect(template.length).toBe(30_316);
    expect(createHash("sha256").update(template).digest("hex")).toBe(SHA_16);
  });
  it("is served under the NEW name; the 1.5 file is gone so no cached copy can be used", async () => {
    expect(SHIP_TEMPLATE_URL).toBe("/templates/myship-import-template-1.6.xlsm");
    expect(existsSync(`public${SHIP_TEMPLATE_URL}`)).toBe(true);
    expect(readdirSync("public/templates").filter((f) => f.endsWith(".xlsm"))).toEqual(["myship-import-template-1.6.xlsm"]);
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => template.buffer }));
    vi.stubGlobal("fetch", fetchMock);
    try { await fetchShipTemplate(); } finally { vi.unstubAllGlobals(); }
    expect(fetchMock).toHaveBeenCalledWith("/templates/myship-import-template-1.6.xlsm");
  });
});

for (const [name, rows] of CALLERS) {
  describe(`a real export from the 1.6 template — ${name}`, () => {
    it("every zip entry except xl/worksheets/sheet1.xml is byte-identical to 7-11's file (same order, data, crc, method)", async () => {
      const out = await buildXlsmFromTemplate(template, rows);
      const before = parseZip(template), after = parseZip(out);
      expect(after.map((e) => e.name)).toEqual(before.map((e) => e.name));
      let same = 0;
      for (const b of before) {
        const a = after.find((e) => e.name === b.name)!;
        if (b.name === "xl/worksheets/sheet1.xml") continue;
        expect(a.crc, b.name).toBe(b.crc);
        expect(a.method, b.name).toBe(b.method);
        expect(Buffer.from(readEntryRaw(out, a)).equals(Buffer.from(readEntryRaw(template, b))), b.name).toBe(true);
        same++;
      }
      expect(same).toBe(before.length - 1); // 16 of 17 entries untouched (VBA, styles, 填寫說明, sharedStrings, …)
    });
    it("sheet1 differs ONLY by our rows (inside sheetData, row 7+) and the dimension; sheetProtection kept exactly", async () => {
      const out = await buildXlsmFromTemplate(template, rows);
      const sheetOf = (bytes: Uint8Array) => readEntryText(bytes, parseZip(bytes).find((e) => e.name === "xl/worksheets/sheet1.xml")!);
      const orig = await sheetOf(template), mine = await sheetOf(out);
      // the protection element: present, byte-identical, still right after </sheetData>
      const prot = /<sheetProtection [^>]*\/>/.exec(orig)![0];
      expect(prot).toContain('sheet="1"');
      expect(mine).toContain(prot);
      expect(mine.indexOf(prot)).toBe(mine.indexOf("</sheetData>") + "</sheetData>".length);
      // our rows: 7 and 8, inside sheetData, before the protection
      expect(mine.indexOf('<row r="7"')).toBeGreaterThan(mine.indexOf("<sheetData>"));
      expect(mine.indexOf('<row r="8"')).toBeLessThan(mine.indexOf("</sheetData>"));
      expect(mine).toContain('<dimension ref="A1:K8"/>');
      for (const r of rows) for (const v of r) if (v) expect(mine).toContain(`<t xml:space="preserve">${v}</t>`);
      // remove our rows + put the dimension back → exactly 7-11's sheet
      const restored = mine.replace(/<row r="(?:[7-9]|\d{2,})"[^>]*>.*?<\/row>/gs, "").replace('<dimension ref="A1:K8"/>', '<dimension ref="A1:K6"/>');
      expect(restored).toBe(orig);
    });
    it("the workbook reads back: 填寫說明 B1 = 1.6, headers in row 6, our data from A7 as text", async () => {
      const out = await buildXlsmFromTemplate(template, rows);
      const XLSX = await import("xlsx");
      const wb = XLSX.read(out, { type: "array", bookVBA: true });
      expect(wb.SheetNames).toEqual(["訂單匯入", "填寫說明"]);
      expect(String(wb.Sheets["填寫說明"]["B1"].v)).toBe("1.6");
      expect(wb.Sheets["訂單匯入"]["A6"].v).toBe("＊取件人姓名");
      expect(wb.Sheets["訂單匯入"]["A7"]).toMatchObject({ t: "s", v: rows[0][0] });
      expect(wb.Sheets["訂單匯入"]["B7"]).toMatchObject({ t: "s", v: rows[0][1] }); // leading 0 kept
      expect(wb.Sheets["訂單匯入"]["!ref"]).toBe("A1:K8");
    });
  });
}
