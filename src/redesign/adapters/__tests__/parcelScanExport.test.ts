// Parcel Scan → 賣貨便 訂單匯入 export: the pure row-mapper (with all 4 gap-column
// defaults), the READY/NEEDS-ATTENTION gate (reusing the shipping validators +
// store_check_status), and a smoke build proving the parcel_scans rows flow
// through the EXISTING, 賣貨便-accepted xlsm builder unchanged.
import { describe, it, expect } from "vitest";
import { scanToXlsRow, splitScansForExport, scanOrderDate, type ParcelScanRow } from "../parcelScan";
import { buildXlsmFromTemplate, entryToXlsRow } from "../shippingExport";
import type { ShippingEntry } from "../shipping"; // sanity: same column arity
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const row = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "陳小美", phone: "0912345678", storeId: "982063",
  amount: 550, notes: "", status: "confirmed", storeCheckStatus: "valid",
  createdAt: "2026-09-08T02:00:00Z", ...over,
});

describe("scanToXlsRow — A–J mapping + the 4 gap-column defaults", () => {
  it("maps fields and applies 常溫 / shop-name / fee / blanks", () => {
    const r = scanToXlsRow(row(), { storeName: "Budgetukay", fee: 38 });
    expect(r).toEqual([
      "陳小美",      // A 取件人姓名
      "0912345678", // B 取件人手機 (leading 0 kept)
      "982063",     // C 取件門市
      "常溫",        // D 溫層 (hard default — clothing is ambient)
      "Budgetukay", // E 商品 = shop name
      "550",        // F 訂單金額
      "38",         // G 運費金額 = default_fee
      "2026/9/8",   // H 買家下訂日期 (Taipei, no leading zeros)
      "",           // I 商品備註
      "",           // J 其他資訊
    ]);
  });
  it("produces exactly 10 columns, same arity as the shipping entryToXlsRow", () => {
    const scanCols = scanToXlsRow(row(), { storeName: "S", fee: 38 }).length;
    const ship = { recipientName: "A", phone: "0912345678", storeId: "982063", tempLayer: "常溫", productDesc: "x", orderAmount: 550, shippingFee: 38, buyerUsername: "", sessionKey: "2026-09-08" } as unknown as ShippingEntry;
    expect(scanCols).toBe(10);
    expect(scanCols).toBe(entryToXlsRow(ship).length);
  });
  it("null amount → blank F (the gate excludes it anyway; the mapper must not crash)", () => {
    expect(scanToXlsRow(row({ amount: null }), { storeName: "S", fee: 38 })[5]).toBe("");
  });
  it("tempLayer override is honored (frozen), else 常溫", () => {
    expect(scanToXlsRow(row(), { storeName: "S", fee: 38, tempLayer: "冷凍" })[3]).toBe("冷凍");
  });
});

describe("scanOrderDate — created_at → Taipei YYYY/M/D, no leading zeros", () => {
  it("formats a UTC ISO into the Taipei day", () => {
    expect(scanOrderDate("2026-09-08T02:00:00Z")).toBe("2026/9/8");
  });
  it("a late-UTC time still lands on the correct Taipei day (UTC+8 roll-forward)", () => {
    expect(scanOrderDate("2026-09-08T20:00:00Z")).toBe("2026/9/9");
  });
  it("garbage → empty (optional column)", () => {
    expect(scanOrderDate("not-a-date")).toBe("");
  });
});

describe("splitScansForExport — READY vs NEEDS-ATTENTION gate", () => {
  it("a clean valid row → READY", () => {
    const s = splitScansForExport([row()], 38);
    expect(s.ready).toHaveLength(1);
    expect(s.attention).toHaveLength(0);
  });
  it("store_check_status not_found → EXCLUDED as wrong_store (even if all fields valid)", () => {
    const s = splitScansForExport([row({ storeCheckStatus: "not_found" })], 38);
    expect(s.ready).toHaveLength(0);
    expect(s.attention[0].reason).toBe("wrong_store");
  });
  it("store_check_status unknown / null → INCLUDED (soft-warn only, never excluded)", () => {
    expect(splitScansForExport([row({ storeCheckStatus: "unknown" })], 38).ready).toHaveLength(1);
    expect(splitScansForExport([row({ storeCheckStatus: null })], 38).ready).toHaveLength(1);
  });
  it("null amount → EXCLUDED as bad_amount", () => {
    const s = splitScansForExport([row({ amount: null })], 38);
    expect(s.ready).toHaveLength(0);
    expect(s.attention[0].reason).toBe("bad_amount");
  });
  it("amount below the 55 min (with fee) → EXCLUDED as bad_amount", () => {
    const s = splitScansForExport([row({ amount: 10 })], 0);
    expect(s.attention[0].reason).toBe("bad_amount");
  });
  it("invalid name / phone / store → EXCLUDED with the matching reason", () => {
    expect(splitScansForExport([row({ customerName: "王小明123" })], 38).attention[0].reason).toBe("bad_name"); // digits forbidden
    expect(splitScansForExport([row({ phone: "12345" })], 38).attention[0].reason).toBe("bad_phone");
    expect(splitScansForExport([row({ storeId: "12" })], 38).attention[0].reason).toBe("bad_store");
  });
  it("already-exported rows are skipped (neither bucket)", () => {
    const s = splitScansForExport([row({ status: "exported" })], 38);
    expect(s.ready).toHaveLength(0);
    expect(s.attention).toHaveLength(0);
  });
  it("reason priority: wrong_store wins over field errors", () => {
    const s = splitScansForExport([row({ storeCheckStatus: "not_found", phone: "bad" })], 38);
    expect(s.attention[0].reason).toBe("wrong_store");
  });
});

describe("build-from-parcel_scans smoke — the EXISTING builder eats the mapped rows", () => {
  it("produces a valid .xlsm from parcel_scans rows through buildXlsmFromTemplate", async () => {
    const template = readFileSync(resolve(__dirname, "../../../../public/templates/myship-import-template.xlsm"));
    const tmplBytes = new Uint8Array(template.buffer, template.byteOffset, template.byteLength);
    const rows = splitScansForExport([row(), row({ id: "r2", customerName: "林大同", storeId: "266402" })], 38)
      .ready.map((r) => scanToXlsRow(r, { storeName: "Budgetukay", fee: 38 }));
    const bytes = await buildXlsmFromTemplate(tmplBytes, rows);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000); // real patched workbook, not empty
    expect(bytes[0]).toBe(0x50); // 'P' — a ZIP (xlsm) container
    expect(bytes[1]).toBe(0x4b); // 'K'
  });
});
