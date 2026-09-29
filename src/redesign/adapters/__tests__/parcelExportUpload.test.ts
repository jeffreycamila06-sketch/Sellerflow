// Seller-side 匯出報表 upload reader (parcelExportRead) — the no-extension path that
// feeds F-code↔handle into parcel_tracking. Behavioural: builds a REAL .xlsx (STORED zip
// via the shippingXlsmPatch primitives) and asserts the 訂單匯入 column targeting, then
// pins the upsert payload shape (only the 3 handle-link keys — poller columns never sent).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { crc32, buildZip } from "../shippingXlsmPatch";

// ── supabase mock: session, the S3 overlap RPC, the own-row lookup, and upserts ──
const M = vi.hoisted(() => ({
  existing: [] as { tracking_no: string; buyer_username: string | null }[],
  foreign: 0,
  rpcError: null as null | { code?: string; message?: string },
  lookupError: null as null | { code?: string; message?: string },
  upsertErrors: [] as (null | { code?: string; message?: string })[], // per call, in order
}));
const { upsert, rpc, lookup, getSession } = vi.hoisted(() => ({
  upsert: vi.fn(),
  rpc: vi.fn(),
  lookup: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "SELLER-UID" } } } })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      upsert: (...a: unknown[]) => upsert(...a),
      select: () => ({ eq: (_c: string, uid: string) => ({ in: (_c2: string, codes: string[]) => lookup(uid, codes) }) }),
    }),
  },
}));

import { extractImportHandles, parseExportBytes, syncFromExport, dedupeByTrackingNo, planSync, classifyDbError } from "../parcelExportRead";

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

beforeEach(() => {
  M.existing = []; M.foreign = 0; M.rpcError = null; M.lookupError = null; M.upsertErrors = [];
  getSession.mockResolvedValue({ data: { session: { user: { id: "SELLER-UID" } } } });
  rpc.mockReset(); rpc.mockImplementation(async () => ({ data: M.foreign, error: M.rpcError }));
  lookup.mockReset(); lookup.mockImplementation(async (_uid: string, codes: string[]) => ({
    data: M.lookupError ? null : M.existing.filter((r) => codes.includes(r.tracking_no)), error: M.lookupError,
  }));
  upsert.mockReset(); upsert.mockImplementation(async () => ({ error: M.upsertErrors.length ? M.upsertErrors.shift() : null }));
});

const withSheet = (body: string) => xlsx({
  "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": WB_RELS, "xl/sharedStrings.xml": SHARED,
  "xl/worksheets/sheet1.xml": SHEET1, "xl/worksheets/sheet2.xml": sheet2(body),
});
const dataRow = (n: number, code: string, handle?: string) =>
  `<row r="${n}"><c r="H${n}" t="inlineStr"><is><t>${code}</t></is></c>${handle ? `<c r="V${n}" t="inlineStr"><is><t>${handle}</t></is></c>` : ""}<c r="G${n}" t="inlineStr"><is><t>J*o</t></is></c></row>`;

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
  it("header-only 訂單匯入 (no data rows) → 0 rows, 0 without a code", () => {
    expect(extractImportHandles(sheet2(SHEET2_HEADER), SHARED)).toMatchObject({ rows: [], noCode: 0 });
  });
  it("order rows with no 交貨便 code yet are COUNTED (noCode), not silently dropped", () => {
    const body = SHEET2_HEADER + `<row r="4"><c r="G4" t="inlineStr"><is><t>J*o</t></is></c></row><row r="5"><c r="G5" t="inlineStr"><is><t>M*y</t></is></c></row>`;
    expect(extractImportHandles(sheet2(body), SHARED)).toMatchObject({ rows: [], noCode: 2 });
  });
});

describe("parseExportBytes — full zip round-trip; anything else is 'not_export'", () => {
  it("reads a real .xlsx and returns the 訂單匯入 handle rows", async () => {
    const res = await parseExportBytes(fullFile());
    expect(res.ok).toBe(true);
    expect(res.rows.map((r) => r.tracking_no)).toEqual(["F836749464", "F836749265", "F836748584"]);
  });
  it("a non-zip file, a workbook with no 訂單匯入 tab, or no 配送單編號 column → not_export", async () => {
    expect(await parseExportBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toMatchObject({ ok: false, error: "not_export" });
    const noImportTab = xlsx({
      "xl/workbook.xml": WORKBOOK.replace('name="訂單匯入"', 'name="其他報表"'), "xl/_rels/workbook.xml.rels": WB_RELS, "xl/sharedStrings.xml": SHARED,
      "xl/worksheets/sheet1.xml": SHEET1, "xl/worksheets/sheet2.xml": sheet2(SHEET2_HEADER + SHEET2_DATA),
    });
    expect(await parseExportBytes(noImportTab)).toMatchObject({ ok: false, error: "not_export" });
    const noCodeColumn = withSheet(`<row r="3"><c r="V3" t="s"><v>2</v></c></row>` + dataRow(4, "F1"));
    expect(await parseExportBytes(noCodeColumn)).toMatchObject({ ok: false, error: "not_export" });
  });
  it("valid file but 訂單匯入 has no data → ok:true, 0 rows", async () => {
    expect(await parseExportBytes(withSheet(SHEET2_HEADER))).toEqual({ ok: true, rows: [], noCode: 0 });
  });
});

describe("S5 — dedupeByTrackingNo keeps the LAST row for a repeated code", () => {
  it("one row per code, latest wins, first-appearance order kept", () => {
    expect(dedupeByTrackingNo([
      { tracking_no: "A", buyer_username: null },
      { tracking_no: "B", buyer_username: "b1" },
      { tracking_no: "A", buyer_username: "a-late" },
    ])).toEqual([{ tracking_no: "A", buyer_username: "a-late" }, { tracking_no: "B", buyer_username: "b1" }]);
  });
});

describe("planSync — writes only what changed, never clobbers a stored handle (pure)", () => {
  const rows = [
    { tracking_no: "NEW1", buyer_username: "maria" }, // new with handle
    { tracking_no: "NEW2", buyer_username: null },    // new without handle → code only (S6)
    { tracking_no: "OLD1", buyer_username: "same" },  // unchanged
    { tracking_no: "OLD2", buyer_username: "renamed" }, // handle changed
    { tracking_no: "OLD3", buyer_username: null },    // file lost the handle → keep the stored one
  ];
  const existing = new Map<string, string | null>([["OLD1", "same"], ["OLD2", "old"], ["OLD3", "kept"]]);
  it("buckets + counts", () => {
    const p = planSync(rows, existing);
    expect(p.withHandle).toEqual([{ tracking_no: "NEW1", buyer_username: "maria" }, { tracking_no: "OLD2", buyer_username: "renamed" }]);
    expect(p.codeOnly).toEqual([{ tracking_no: "NEW2" }]);
    expect(p).toMatchObject({ fresh: 2, updated: 1, same: 2, withoutHandle: 2 });
  });
});

describe("classifyDbError — each cause maps to its own message", () => {
  it("42501 / not_allowed → permission; foreign_tracking_no → foreign; JWT → signed_out; else network", () => {
    expect(classifyDbError({ code: "42501", message: "not_allowed" })).toBe("permission");
    expect(classifyDbError({ code: "P0001", message: "foreign_tracking_no" })).toBe("foreign");
    expect(classifyDbError({ code: "PGRST301", message: "JWT expired" })).toBe("signed_out");
    expect(classifyDbError({ message: "Failed to fetch" })).toBe("network");
    expect(classifyDbError(null)).toBe("network");
  });
});

describe("syncFromExport — the whole upload path", () => {
  it("first upload: handle rows upsert ONLY {user_id, tracking_no, buyer_username}; no-username rows are KEPT as code-only inserts", async () => {
    const res = await syncFromExport(fullFile());
    expect(res).toMatchObject({ ok: true, total: 3, fresh: 3, updated: 0, same: 0, withoutHandle: 1 });
    expect(rpc).toHaveBeenCalledWith("parcel_tracking_foreign_overlap", { p_codes: ["F836749464", "F836749265", "F836748584"] });
    expect(upsert).toHaveBeenCalledTimes(2);
    const [handlePayload, handleOpts] = upsert.mock.calls[0] as [Array<Record<string, unknown>>, Record<string, unknown>];
    expect(handleOpts).toEqual({ onConflict: "user_id,tracking_no" });
    expect(handlePayload).toEqual([
      { user_id: "SELLER-UID", tracking_no: "F836749464", buyer_username: "Ashley102031" },
      { user_id: "SELLER-UID", tracking_no: "F836749265", buyer_username: "18ingaryg(IG)" },
    ]);
    const [codePayload, codeOpts] = upsert.mock.calls[1] as [Array<Record<string, unknown>>, Record<string, unknown>];
    expect(codeOpts).toEqual({ onConflict: "user_id,tracking_no", ignoreDuplicates: true }); // never overwrites an existing row
    expect(codePayload).toEqual([{ user_id: "SELLER-UID", tracking_no: "F836748584" }]);
    for (const row of [...handlePayload, ...codePayload]) {
      for (const k of ["status", "terminal", "pickup_deadline", "rec_store", "last_polled_at", "recipient_name", "store_id", "order_amount", "cm_order_no"]) {
        expect(row).not.toHaveProperty(k);
      }
    }
  });

  it("S5: re-uploading the same file is a NO-OP — 0 writes, reported as already synced", async () => {
    M.existing = [
      { tracking_no: "F836749464", buyer_username: "Ashley102031" },
      { tracking_no: "F836749265", buyer_username: "18ingaryg(IG)" },
      { tracking_no: "F836748584", buyer_username: null },
    ];
    const res = await syncFromExport(fullFile());
    expect(res).toMatchObject({ ok: true, total: 3, fresh: 0, updated: 0, same: 3 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("S5: a code repeated inside the file is written ONCE (latest row wins) — no 'row affected twice' rejection", async () => {
    const res = await syncFromExport(withSheet(SHEET2_HEADER + dataRow(4, "FDUP", "first") + dataRow(5, "FONE", "x") + dataRow(6, "FDUP", "latest")));
    expect(res).toMatchObject({ ok: true, total: 2, fresh: 2 });
    const payload = upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(payload.filter((r) => r.tracking_no === "FDUP")).toEqual([{ user_id: "SELLER-UID", tracking_no: "FDUP", buyer_username: "latest" }]);
  });

  it("S3: codes that belong to another seller → 'foreign', NOTHING written", async () => {
    M.foreign = 2;
    const res = await syncFromExport(fullFile());
    expect(res).toMatchObject({ ok: false, error: "foreign", foreign: 2 });
    expect(lookup).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("S3 backstop: the DB trigger's foreign_tracking_no (a race after the pre-check) → 'foreign'", async () => {
    M.upsertErrors = [{ code: "P0001", message: "foreign_tracking_no" }];
    expect(await syncFromExport(fullFile())).toMatchObject({ ok: false, error: "foreign" });
  });

  it("S4: not on the allowlist (42501 from the overlap check) → 'permission', nothing written", async () => {
    M.rpcError = { code: "42501", message: "not_allowed" };
    expect(await syncFromExport(fullFile())).toMatchObject({ ok: false, error: "permission" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("S4: signed out → 'signed_out', nothing read or written", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } } as unknown as Awaited<ReturnType<typeof getSession>>);
    expect(await syncFromExport(fullFile())).toMatchObject({ ok: false, error: "signed_out" });
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("S4: a failure AFTER some parcels saved → 'partial' with saved / attempted", async () => {
    const body = SHEET2_HEADER + Array.from({ length: 600 }, (_, i) => dataRow(4 + i, `F${String(i).padStart(9, "0")}`, `h${i}`)).join("");
    M.upsertErrors = [null, { message: "Failed to fetch" }]; // chunk 1 (500) ok, chunk 2 fails
    const res = await syncFromExport(withSheet(body));
    expect(res).toMatchObject({ ok: false, error: "partial", saved: 500, attempted: 600 });
  });

  it("S4: a failure before anything saved → the real cause, never a parse error", async () => {
    M.upsertErrors = [{ message: "Failed to fetch" }];
    expect(await syncFromExport(fullFile())).toMatchObject({ ok: false, error: "network" });
    M.lookupError = { code: "42501", message: "permission denied for table parcel_tracking" };
    expect(await syncFromExport(fullFile())).toMatchObject({ ok: false, error: "permission" });
  });

  it("S4: rows but no 交貨便 codes yet → 'no_codes'; wrong file → 'not_export'; empty tab → 'empty'", async () => {
    const noCodes = withSheet(SHEET2_HEADER + `<row r="4"><c r="G4" t="inlineStr"><is><t>J*o</t></is></c></row>`);
    expect(await syncFromExport(noCodes)).toMatchObject({ ok: false, error: "no_codes" });
    expect(await syncFromExport(new Uint8Array([0, 1, 2, 3]))).toMatchObject({ ok: false, error: "not_export" });
    expect(await syncFromExport(withSheet(SHEET2_HEADER))).toMatchObject({ ok: false, error: "empty" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("5,000-row file: every row is considered (no cap), written in 500-row chunks", async () => {
    const body = SHEET2_HEADER + Array.from({ length: 5000 }, (_, i) => dataRow(4 + i, `G${String(i).padStart(9, "0")}`, `u${i}`)).join("");
    const res = await syncFromExport(withSheet(body));
    expect(res).toMatchObject({ ok: true, total: 5000, fresh: 5000 });
    expect(upsert).toHaveBeenCalledTimes(10);
    expect(lookup).toHaveBeenCalledTimes(25); // 200 codes per own-row lookup
  });
});
