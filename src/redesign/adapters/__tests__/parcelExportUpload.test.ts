// Seller-side 匯出報表 upload reader (parcelExportRead) — the no-extension path that
// feeds F-code↔handle into parcel_tracking. Behavioural: builds a REAL .xlsx (STORED zip
// via the shippingXlsmPatch primitives) and asserts the 訂單匯入 column targeting, then
// pins the upsert payload shape (only the 3 handle-link keys — poller columns never sent).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { crc32, buildZip } from "../shippingXlsmPatch";

// ── supabase mock (captures the upsert payload; session = a signed-in seller) ──
const { upsert, getSession } = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "SELLER-UID" } } } })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession }, from: () => ({ upsert }) },
}));

import { extractImportHandles, parseExportBytes, syncFromExport } from "../parcelExportRead";

// ── xlsx fixture builder (STORED entries; parseZip/readEntryText read them) ──
const te = new TextEncoder();
function xlsx(entries: Record<string, string>): Uint8Array {
  return buildZip(Object.entries(entries).map(([name, text]) => {
    const data = te.encode(text);
    return { name, flags: 0, method: 0, time: 0, date: 0, crc: crc32(data), csize: data.length, usize: data.length, data };
  }));
}

const SHARED =
  `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<si><t>配送單編號</t></si>` +                              // 0
  `<si><t>商品名稱&#10;(品名/規格)</t></si>` +                 // 1 — the decoy (shop name lives here)
  `<si><t>其它資訊&#10;(FB/LINE/IG帳號)</t></si>` +             // 2 — the handle header (其它, 它 not 他)
  `<si><t>收件人姓名</t></si></sst>`;                          // 3
const WORKBOOK =
  `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="非訂單匯入" sheetId="1" r:id="rId1"></sheet>` +
  `<sheet name="訂單匯入" sheetId="2" r:id="rId2"></sheet></sheets></workbook>`;
const WB_RELS =
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Target="worksheets/sheet1.xml" />` +
  `<Relationship Id="rId2" Target="worksheets/sheet2.xml" />` +
  `<Relationship Id="rId5" Target="sharedStrings.xml" /></Relationships>`;
const SHEET1 = `<?xml version="1.0"?><worksheet><sheetData><row r="3"><c r="H3" t="s"><v>3</v></c></row></sheetData></worksheet>`;
// 訂單匯入: banner row 1, header row 3 (F-code col H, product col L, handle col V), data rows 4–6.
const SHEET2_HEADER =
  `<row r="1"><c r="A1" t="inlineStr"><is><t>訂購日期：2026/07/20~2026/09/20</t></is></c></row>` +
  `<row r="3"><c r="G3" t="s"><v>3</v></c><c r="H3" t="s"><v>0</v></c><c r="L3" t="s"><v>1</v></c><c r="V3" t="s"><v>2</v></c></row>`;
const SHEET2_DATA =
  `<row r="4"><c r="G4" t="inlineStr"><is><t>J*o</t></is></c><c r="H4" t="inlineStr"><is><t>F836749464</t></is></c><c r="L4" t="inlineStr"><is><t>budgetukay</t></is></c><c r="V4" t="inlineStr"><is><t>Ashley102031</t></is></c></row>` +
  `<row r="5"><c r="H5" t="inlineStr"><is><t>F836749265</t></is></c><c r="V5" t="inlineStr"><is><t>18ingaryg(IG)</t></is></c></row>` +
  `<row r="6"><c r="H6" t="inlineStr"><is><t>F836748584</t></is></c></row>`; // blank handle
const sheet2 = (body: string) => `<?xml version="1.0"?><worksheet><dimension ref="A1:AML3"/><sheetData>${body}</sheetData></worksheet>`;

const fullFile = () => xlsx({
  "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": WB_RELS, "xl/sharedStrings.xml": SHARED,
  "xl/worksheets/sheet1.xml": SHEET1, "xl/worksheets/sheet2.xml": sheet2(SHEET2_HEADER + SHEET2_DATA),
});

beforeEach(() => { upsert.mockClear(); upsert.mockResolvedValue({ error: null }); getSession.mockResolvedValue({ data: { session: { user: { id: "SELLER-UID" } } } }); });

describe("extractImportHandles — 訂單匯入 header-text columns (pure)", () => {
  it("picks 配送單編號=H + 其它資訊=V, ignores 商品名稱=L; verbatim (IG); blank → null", () => {
    const { rows, cols } = extractImportHandles(sheet2(SHEET2_HEADER + SHEET2_DATA), SHARED);
    expect(cols).toEqual({ fcodeCol: "H", handleCol: "V" });
    expect(rows).toEqual([
      { tracking_no: "F836749464", buyer_username: "Ashley102031" },
      { tracking_no: "F836749265", buyer_username: "18ingaryg(IG)" }, // verbatim tag kept
      { tracking_no: "F836748584", buyer_username: null },            // blank handle
    ]);
    expect(rows.some((r) => r.buyer_username === "budgetukay")).toBe(false); // product column never leaks
  });
  it("header-only 訂單匯入 (no data rows) → 0 rows", () => {
    expect(extractImportHandles(sheet2(SHEET2_HEADER), SHARED).rows).toEqual([]);
  });
});

describe("parseExportBytes — full zip round-trip + error handling", () => {
  it("reads a real .xlsx and returns the 訂單匯入 handle rows", async () => {
    const res = await parseExportBytes(fullFile());
    expect(res.ok).toBe(true);
    expect(res.rows.map((r) => r.tracking_no)).toEqual(["F836749464", "F836749265", "F836748584"]);
  });
  it("a non-zip / non-xlsx file → ok:false (no write)", async () => {
    const res = await parseExportBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not_xlsx");
  });
  it("valid file but 訂單匯入 has no data → ok:true, 0 rows", async () => {
    const res = await parseExportBytes(xlsx({
      "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": WB_RELS, "xl/sharedStrings.xml": SHARED,
      "xl/worksheets/sheet1.xml": SHEET1, "xl/worksheets/sheet2.xml": sheet2(SHEET2_HEADER),
    }));
    expect(res).toEqual({ ok: true, rows: [] });
  });
});

describe("syncFromExport — upsert payload shape (no-clobber contract)", () => {
  it("upserts ONLY {user_id, tracking_no, buyer_username} for handle rows; drops blanks", async () => {
    const res = await syncFromExport(fullFile());
    expect(res).toMatchObject({ ok: true, synced: 2, totalRows: 3, without: 1 }); // 2 with handle, 1 blank
    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = upsert.mock.calls[0] as [Array<Record<string, unknown>>, { onConflict: string }];
    expect(opts).toEqual({ onConflict: "user_id,tracking_no" });
    expect(payload).toEqual([
      { user_id: "SELLER-UID", tracking_no: "F836749464", buyer_username: "Ashley102031" },
      { user_id: "SELLER-UID", tracking_no: "F836749265", buyer_username: "18ingaryg(IG)" },
    ]);
    // poller-owned columns must NEVER be part of the write
    for (const row of payload) {
      for (const k of ["status", "terminal", "pickup_deadline", "rec_store", "last_polled_at", "recipient_name", "store_id", "order_amount", "cm_order_no"]) {
        expect(row).not.toHaveProperty(k);
      }
    }
  });
  it("no 訂單匯入 rows → empty result, NO upsert", async () => {
    const res = await syncFromExport(xlsx({
      "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": WB_RELS, "xl/sharedStrings.xml": SHARED,
      "xl/worksheets/sheet1.xml": SHEET1, "xl/worksheets/sheet2.xml": sheet2(SHEET2_HEADER),
    }));
    expect(res).toMatchObject({ ok: true, empty: true, synced: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });
  it("non-xlsx → ok:false, NO upsert", async () => {
    const res = await syncFromExport(new Uint8Array([0, 1, 2, 3]));
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("not signed in → ok:false, NO upsert", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } } as unknown as Awaited<ReturnType<typeof getSession>>);
    const res = await syncFromExport(fullFile());
    expect(res).toMatchObject({ ok: false, error: "not_signed_in" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
