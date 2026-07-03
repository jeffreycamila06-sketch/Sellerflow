// P2 export — pure: plan quotas (display mirror of the RPC), 賣貨便 A–J row
// mapping (all strings; username in col J never col A), session-start date,
// Taipei filename. RPC/browser delivery are thin wrappers over mocked bounds.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));

import { quotaForPlan, entryToXlsRow, orderDateFromSessionKey, exportFilename } from "../shippingExport";
import { draftEntryFor, buyerGroupsFrom } from "../shipping";
import type { Buyer } from "../../../lib/orderTypes";

const buyers: Buyer[] = [{
  handle: "kuyajohn_", name: "John", platform: "TikTok", num: 5, totalSpent: 2100, totalOrders: 2,
  orders: [
    { orderNum: 1751500000000, item: "A150", qty: 1, price: 1000, total: 1000, time: "20:00", handle: "kuyajohn_", name: "John", bNum: 5, platform: "TikTok", status: "New", date: "2026-07-02" },
    { orderNum: 1751500000001, item: "B200", qty: 1, price: 1100, total: 1100, time: "20:05", handle: "kuyajohn_", name: "John", bNum: 5, platform: "TikTok", status: "New", date: "2026-07-02" },
  ],
}];

describe("quotaForPlan — display mirror of the RPC CASE", () => {
  it("free 50 · basic 200 · pro 500 · master unlimited(null) · unknown→free", () => {
    expect(quotaForPlan("free")).toBe(50);
    expect(quotaForPlan("basic")).toBe(200);
    expect(quotaForPlan("pro")).toBe(500);
    expect(quotaForPlan("master")).toBeNull();
    expect(quotaForPlan(undefined)).toBe(50);
    expect(quotaForPlan("weird")).toBe(50);
  });
});

describe("orderDateFromSessionKey", () => {
  it("day key + window key → template slashed date (no zero-pad)", () => {
    expect(orderDateFromSessionKey("2026-07-03")).toBe("2026/7/3");
    expect(orderDateFromSessionKey("2026-07-02~3d")).toBe("2026/7/2");
    expect(orderDateFromSessionKey("2026-12-25")).toBe("2026/12/25");
    expect(orderDateFromSessionKey("garbage")).toBe("");
  });
});

describe("entryToXlsRow — cols A–J, ALL strings", () => {
  it("maps a filled entry; username lands in col J (index 9), NEVER col A", () => {
    const g = buyerGroupsFrom(buyers)[0];
    const e = { ...draftEntryFor(g, "2026-07-02~3d", "id"), recipientName: "王小明", phone: "0912345678", storeId: "123456" };
    const row = entryToXlsRow(e);
    expect(row).toEqual(["王小明", "0912345678", "123456", "常溫", "#5 商品x2", "2100", "38", "2026/7/2", "", "kuyajohn_"]);
    expect(row.every((c) => typeof c === "string")).toBe(true); // required cols are Text (@)
    expect(row[0]).not.toContain("kuyajohn_");
  });
  it("amounts serialize as plain number strings (leading-0 phone survives)", () => {
    const g = buyerGroupsFrom(buyers)[0];
    const e = { ...draftEntryFor(g, "2026-07-03", "id"), phone: "0900000001", shippingFee: 0 };
    const row = entryToXlsRow(e);
    expect(row[1]).toBe("0900000001");
    expect(row[6]).toBe("0"); // free shipping
  });
});

describe("exportFilename — Taipei clock", () => {
  it("sellerflow_711_YYYYMMDD_HHmm.xlsm", () => {
    // 2026-07-03 04:05 UTC = 12:05 Taipei
    expect(exportFilename(Date.UTC(2026, 6, 3, 4, 5, 0))).toBe("sellerflow_711_20260703_1205.xlsm");
    // 2026-07-03 17:30 UTC = 01:30 Taipei NEXT day
    expect(exportFilename(Date.UTC(2026, 6, 3, 17, 30, 0))).toBe("sellerflow_711_20260704_0130.xlsm");
  });
});

// ── Round-trip against the REAL bundled template (public/templates/…) ─────────
import { readFileSync } from "node:fs";
import { buildXlsmFromTemplate, SHIP_DATA_SHEET } from "../shippingExport";

describe("buildXlsmFromTemplate — 賣貨便 template round-trip (real file)", () => {
  const template = readFileSync("public/templates/myship-import-template.xlsm");
  const rows = [
    ["王小明", "0912345678", "123456", "常溫", "#1 商品x2", "560", "60", "2026/7/3", "", "testuser"],
    ["陳大文", "0987654321", "654321", "冷凍", "#2 商品x1", "1200", "0", "2026/7/3", "", "user2"],
  ];

  it("preserves both sheets, the VBA project, 填寫說明 B1=1.4, and the row-6 headers; writes rows at A7 as strings", async () => {
    const out = await buildXlsmFromTemplate(new Uint8Array(template), rows);
    const XLSX = await import("xlsx");
    const rt = XLSX.read(out, { type: "array", bookVBA: true });
    expect(rt.SheetNames).toEqual(["訂單匯入", "填寫說明"]);
    expect((rt as { vbaraw?: unknown }).vbaraw).toBeTruthy();           // 驗證 macro survives
    expect(rt.Sheets["填寫說明"]["B1"].v).toBe("1.4");                   // version cell untouched
    const ws = rt.Sheets[SHIP_DATA_SHEET];
    expect(ws["A6"].v).toBe("＊取件人姓名");                             // headers untouched
    expect(ws["A7"]).toMatchObject({ t: "s", v: "王小明" });             // data starts row 7
    expect(ws["B7"]).toMatchObject({ t: "s", v: "0912345678" });         // leading 0 survives (Text)
    expect(ws["F7"]).toMatchObject({ t: "s", v: "560" });                // number-as-string
    expect(ws["G8"]).toMatchObject({ t: "s", v: "0" });                  // free shipping row 2
    expect(ws["J7"].v).toBe("testuser");                                 // username in col J
    expect(ws["!ref"]).toBe("A1:K8");                                    // extended by 2 rows only
  });

  it("ZIP PATCH: output stays near the original size (no SheetJS rebuild bloat)", async () => {
    // The 73KB SheetJS rebuild was REJECTED by 賣貨便; the patch only adds the
    // stored sheet XML delta, so the output must stay well under 60KB.
    const out = await buildXlsmFromTemplate(new Uint8Array(template), rows);
    expect(out.length).toBeGreaterThan(30_000);
    expect(out.length).toBeLessThan(60_000);
  });

  it("ZIP PATCH: every entry EXCEPT the data sheet keeps byte-identical compressed data + crc (VBA exact)", async () => {
    const { parseZip, readEntryRaw, resolveSheetPath, readEntryText } = await import("../shippingXlsmPatch");
    const src = new Uint8Array(template);
    const out = await buildXlsmFromTemplate(src, rows);
    const before = parseZip(src);
    const after = parseZip(out);
    expect(after.map((e) => e.name)).toEqual(before.map((e) => e.name)); // same entries, same order
    const byName = new Map(before.map((e) => [e.name, e]));
    const sheetPath = resolveSheetPath(
      await readEntryText(src, byName.get("xl/workbook.xml")!),
      await readEntryText(src, byName.get("xl/_rels/workbook.xml.rels")!),
      "訂單匯入",
    );
    expect(sheetPath).toBe("xl/worksheets/sheet1.xml");
    for (const b of before) {
      const a = after.find((e) => e.name === b.name)!;
      if (b.name === sheetPath) {
        expect(a.method).toBe(0); // patched sheet is STORED
        continue;
      }
      expect(a.crc).toBe(b.crc);
      expect(a.method).toBe(b.method);
      expect(Buffer.from(readEntryRaw(out, a)).equals(Buffer.from(readEntryRaw(src, b)))).toBe(true);
    }
    // the macro payload specifically, byte-for-byte
    const vbaB = byName.get("xl/vbaProject.bin")!;
    const vbaA = after.find((e) => e.name === "xl/vbaProject.bin")!;
    expect(Buffer.from(readEntryRaw(out, vbaA)).equals(Buffer.from(readEntryRaw(src, vbaB)))).toBe(true);
  });

  it("throws when the data sheet is missing (corrupt/wrong template)", async () => {
    const XLSX = await import("xlsx");
    const wrong = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wrong, XLSX.utils.aoa_to_sheet([["x"]]), "Sheet1"); // no 訂單匯入
    const bytes = XLSX.write(wrong, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    await expect(buildXlsmFromTemplate(bytes, rows)).rejects.toThrow(/訂單匯入/);
  });
});
