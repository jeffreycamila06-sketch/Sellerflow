import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
const warn = vi.fn();
vi.mock("../../../lib/log", () => ({ log: { warn: (...a: unknown[]) => warn(...a), log() {}, info() {}, error() {}, debug() {} } }));

import { buildZip, crc32 } from "../shippingXlsmPatch";
import { headerMatches, fmStatusOf, fmBuyerUsername, fmDate, fmTimestamp, fmDropOffDeadline, parseFmExport, uploadFmExport, FM_MAX_ROWS } from "../fmPickup";

// The real 好賣+ "Order export" header row (row 1, 38 columns), copied from Jeff's file. Several
// headers carry a note after the name — the reader must still find them.
const HEADERS = ("賣場名稱|訂購日期|訂單編號|訂單狀態|訂單狀態時間|取貨截止日|訂購人姓名|訂購人手機|訂購人信箱|收件人姓名|"
  + "取件人手機|寄件編號|付款方式|配送方式|取件店號|取件店名|商品總額 (A)|運費 (B)|抵用折價券(C)|"
  + "訂單總金額 (A+B-C)|訂單內容 (品名 規格/尺寸 顏色 數量)|訂單問答|折價券來源|付款狀態|賣家對買家運費變價|"
  + "平台運費|指定退回店號|指定退回店名|付款日期|寄件日期|取件日期|包裹退回取件日期|取消日期|匯款日期|匯款金額|"
  + "匯款狀態|賣家備註|買家備註").split("|");
const colOf = (i: number) => { let s = ""; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
type Cell = string | number;

// Strings go to sharedStrings; numbers are numeric cells (as in the real file).
function xlsx(rows: Record<string, Cell>[], headers = HEADERS): Uint8Array {
  const strings: string[] = [];
  const si = (v: string) => { let i = strings.indexOf(v); if (i < 0) { strings.push(v); i = strings.length - 1; } return i; };
  const cell = (ref: string, v: Cell) => typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : v === "" ? "" : `<c r="${ref}" t="s"><v>${si(v)}</v></c>`;
  const rowXml = (rn: number, vals: Cell[]) => `<row r="${rn}">` + vals.map((v, i) => cell(`${colOf(i)}${rn}`, v)).join("") + `</row>`;
  let body = rowXml(1, headers);
  rows.forEach((r, k) => { body += rowXml(k + 2, headers.map((h) => r[h] ?? "")); });
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  const enc = new TextEncoder();
  const file = (name: string, text: string) => { const data = enc.encode(text); return { name, flags: 0, method: 0, time: 0, date: 0, crc: crc32(data), csize: data.length, usize: data.length, data }; };
  return buildZip([file("[Content_Types].xml", "<Types/>"), file("xl/workbook.xml", "<workbook/>"), file("xl/sharedStrings.xml", sst), file("xl/worksheets/sheet1.xml", sheet)]);
}

// Jeff's real sample row (numbers are numeric cells, store 022131 arrives as 22131).
const REAL: Record<string, Cell> = {
  "賣場名稱": "汽泡水", "訂購日期": "2026/10/11", "訂單編號": "L26A110WW1", "訂單狀態": "處理中", "訂單狀態時間": "10/11 17:05",
  "訂購人姓名": "j*f*r*y", "訂購人手機": "0958***782", "收件人姓名": "J*f*r*y", "取件人手機": "0*5*****8*", "付款方式": "貨到付款",
  "配送方式": "常溫店到店", "取件店號": 22131, "取件店名": "樹林新柑園店", "商品總額 (A)": 500, "運費 (B)": 39, "抵用折價券(C)": 0,
  "訂單總金額 (A+B-C)": 539, "訂單內容 (品名 規格/尺寸 顏色 數量)": "汽泡水  1", "付款狀態": "未付款", "賣家對買家運費變價": "N", "平台運費": 35,
};
const base = REAL;
const H_CONTENT = "訂單內容 (品名 規格/尺寸 顏色 數量)";

describe("fmStatusOf — status mapping table", () => {
  const d = "2026/10/05";
  it.each([
    [{ status: "已取消", shipped: d, picked: d, returned: d, cancelled: d }, "hide"],
    [{ status: "已退回", shipped: d, picked: "", returned: d, cancelled: "" }, "returned"],
    [{ status: "已取件", shipped: d, picked: d, returned: "", cancelled: "" }, "picked_up"],
    [{ status: "已到店", shipped: d, picked: "", returned: "", cancelled: "" }, "at_store"],
    [{ status: "配送中", shipped: d, picked: "", returned: "", cancelled: "" }, "in_transit"],
    [{ status: "怪怪的", shipped: d, picked: "", returned: "", cancelled: "" }, "in_transit"],
    [{ status: "已成立", shipped: "", picked: "", returned: "", cancelled: "" }, null],
    [{ status: "出貨中", shipped: "", picked: "", returned: "", cancelled: "", trackingNo: "16351746626" }, "in_transit"],
    [{ status: "出貨中", shipped: "", picked: "", returned: "", cancelled: d, trackingNo: "16351746626" }, "hide"],
  ])("%j → %s", (input, want) => { expect(fmStatusOf(input)).toBe(want); });
});

describe("helpers", () => {
  it("buyer_username strips quantity and leading @", () => {
    expect(fmBuyerUsername("@juan_dela.cruz  1")).toBe("juan_dela.cruz");
    expect(fmBuyerUsername("汽泡水  1")).toBe("汽泡水");
    expect(fmBuyerUsername("  ")).toBeNull();
    // the Parcel Scan FamilyMart placeholder (no @username) is not a buyer
    expect(fmBuyerUsername("商品  1")).toBeNull();
    expect(fmBuyerUsername("商品")).toBeNull();
  });
  it("dates: strings, 上午/下午, Excel serials", () => {
    expect(fmDate("2026/10/5")).toBe("2026-10-05");
    expect(fmTimestamp("2026/10/05 下午 02:30:00")).toBe("2026-10-05T14:30:00+08:00");
    expect(fmTimestamp("2026-10-05 上午 12:05")).toBe("2026-10-05T00:05:00+08:00");
    expect(fmDate("46300")).toBe("2026-10-05");
    expect(fmTimestamp("46300.5")).toBe("2026-10-05T12:00:00+08:00");
    expect(fmDate("not a date")).toBeNull();
  });
});

describe("real 好賣+ export (Jeff's file)", () => {
  const one = async (extra: Record<string, Cell>) => parseFmExport(xlsx([{ ...REAL, ...extra }]));
  it("is accepted; 處理中 with no dates = not shipped yet", async () => {
    const r = await one({});
    expect(r).toEqual({ ok: true, rows: [], notShipped: 1 });
  });
  it("+寄件日期 → in transit, every field read through the suffixed headers", async () => {
    const r = await one({ "寄件日期": "2026/10/12" });
    if (!r.ok) throw new Error("rejected");
    expect(r.rows[0]).toMatchObject({ order_no: "L26A110WW1", status: "in_transit", status_message: "處理中", buyer_username: "汽泡水",
      store_id: "022131", rec_store: "樹林新柑園店", order_amount: 539, recipient_name: "J*f*r*y", recipient_phone: "0*5*****8*", ship_type: "C2C" });
  });
  it("+取件日期 → picked up; +取消日期 → hide", async () => {
    const p = await one({ "寄件日期": "2026/10/12", "取件日期": "2026/10/14" });
    const c = await one({ "寄件日期": "2026/10/12", "取消日期": "2026/10/13" });
    expect(p.ok && p.rows[0].status).toBe("picked_up");
    expect(c.ok && c.rows[0].status).toBe("hide");
  });
  it("a pickup deadline with a ship date → waiting at the store, even when 訂單狀態 lacks 到店", async () => {
    const r = await one({ "寄件日期": "2026/10/12", "取貨截止日": "2026/10/19" });
    expect(r.ok && r.rows[0]).toMatchObject({ status: "at_store", pickup_deadline: "2026-10-19" });
  });
});

// Jeff's real Pending-shipment row: tracking number issued, not dropped off yet.
const PENDING: Record<string, Cell> = { ...REAL, "訂單狀態": "出貨中", "寄件編號": 16351746626 };

describe("not dropped off yet (出貨中 + 寄件編號, no 寄件日期)", () => {
  const one = async (extra: Record<string, Cell>) => parseFmExport(xlsx([{ ...PENDING, ...extra }]));
  it("shows in transit with tracking_no = 寄件編號 and the drop-off deadline (status date + 14 days)", async () => {
    const r = await one({});
    if (!r.ok) throw new Error("rejected");
    expect(r.notShipped).toBe(0);
    expect(r.rows[0]).toMatchObject({ status: "in_transit", tracking_no: "16351746626", status_message: "出貨中", pickup_deadline: "2026-10-25" });
  });
  it("+寄件日期 → normal in transit (no drop-off deadline)", async () => {
    const r = await one({ "寄件日期": "2026/10/12" });
    expect(r.ok && r.rows[0]).toMatchObject({ status: "in_transit", pickup_deadline: null });
  });
  it("+取消日期 → hidden", async () => {
    const r = await one({ "取消日期": "2026/10/13" });
    expect(r.ok && r.rows[0].status).toBe("hide");
  });
  it("處理中 with neither 寄件編號 nor 寄件日期 stays hidden", async () => {
    const r = await parseFmExport(xlsx([REAL]));
    expect(r).toEqual({ ok: true, rows: [], notShipped: 1 });
  });
  it("deadline year: from 訂購日期, next year when the status date is earlier in the year", () => {
    expect(fmDropOffDeadline("10/11 17:05", "2026/10/11")).toBe("2026-10-25");
    expect(fmDropOffDeadline("12/25 09:00", "2026/12/20")).toBe("2027-01-08");
    expect(fmDropOffDeadline("01/02 09:00", "2026/12/30")).toBe("2027-01-16");
    expect(fmDropOffDeadline("", "2026/10/11")).toBeNull();
    expect(fmDropOffDeadline("10/11 17:05", "")).toBeNull();
  });
});

describe("headerMatches", () => {
  it.each([
    ["訂單內容 (品名 規格/尺寸 顏色 數量)", "訂單內容", true],
    ["訂單總金額 (A+B-C)", "訂單總金額", true],
    ["訂單總金額（A+B-C）", "訂單總金額", true],
    ["訂單編號", "訂單編號", true],
    ["包裹退回取件日期", "取件日期", false],
    ["訂單狀態時間", "訂單狀態", false],
    ["商品總額 (A)", "訂單總金額", false],
    ["訂單總金額 (A+B-C)", "商品總額", false],
  ])("%s ~ %s → %s", (h, k, want) => { expect(headerMatches(h, k)).toBe(want); });
});

describe("parseFmExport — real export shape", () => {
  beforeEach(() => warn.mockReset());
  it("reads rows, keeps masked fields and the store leading 0, maps 店到店 to C2C", async () => {
    const r = await parseFmExport(xlsx([
      { ...base, "訂單編號": "L26A110WW1", "訂單狀態": "已到店", "取貨截止日": "2026/10/12", "寄件編號": "FM123", [H_CONTENT]: "@juan_dela.cruz  1", "寄件日期": "2026/10/05" },
      { ...base, "訂單編號": "L26A110WW2", "訂單狀態": "已取件", [H_CONTENT]: "汽泡水  2", "寄件日期": "2026/10/04", "取件日期": "2026/10/06 下午 01:00:00", "取件店號": "22131" },
      { ...base, "訂單編號": "L26A110WW3", "訂單狀態": "已成立", [H_CONTENT]: "x  1" },
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notShipped).toBe(1);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ order_no: "L26A110WW1", status: "at_store", status_message: "已到店", tracking_no: "FM123", pickup_deadline: "2026-10-12", buyer_username: "juan_dela.cruz", recipient_name: "J*f*r*y", recipient_phone: "0*5*****8*", store_id: "022131", rec_store: "樹林新柑園店", order_amount: 539, ship_type: "C2C" });
    expect(r.rows[1]).toMatchObject({ status: "picked_up", picked_up_at: "2026-10-06T13:00:00+08:00", pickup_deadline: null, tracking_no: null, store_id: "022131" });
  });
  it("logs unknown status text once, without names or phones", async () => {
    const row = { ...base, [H_CONTENT]: "x  1", "寄件日期": "2026/10/05", "訂單狀態": "神秘狀態" };
    await parseFmExport(xlsx([{ ...row, "訂單編號": "A1" }, { ...row, "訂單編號": "A2" }]));
    await parseFmExport(xlsx([{ ...row, "訂單編號": "A3" }]));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/J\*f|0\*5/);
  });
  it("rejects a file that isn't a 全家 Order export", async () => {
    expect(await parseFmExport(new TextEncoder().encode("hello"))).toEqual({ ok: false, error: "not_fm_export" });
    expect(await parseFmExport(xlsx([], ["配送單編號", "其它資訊"]))).toEqual({ ok: false, error: "not_fm_export" });
  });
  it(`refuses more than ${FM_MAX_ROWS} rows`, async () => {
    const rows = Array.from({ length: FM_MAX_ROWS + 1 }, (_, i) => ({ "訂單編號": `N${i}`, "訂單狀態": "x", [H_CONTENT]: "a  1" }));
    expect(await parseFmExport(xlsx(rows))).toEqual({ ok: false, error: "too_many" });
  });
});

describe("uploadFmExport", () => {
  beforeEach(() => rpc.mockReset());
  const file = () => xlsx([{ ...base, "訂單編號": "L1", "訂單狀態": "配送中", [H_CONTENT]: "a  1", "寄件日期": "2026/10/05" }]);
  it("sends parsed rows to fm_pickup_upload", async () => {
    rpc.mockResolvedValue({ data: { ok: true, reason: "saved", inserted: 1, updated: 0, hidden: 0, skipped: 0 }, error: null });
    const r = await uploadFmExport(file());
    expect(rpc).toHaveBeenCalledWith("fm_pickup_upload", { p_rows: [expect.objectContaining({ order_no: "L1", status: "in_transit" })] });
    expect(r).toMatchObject({ ok: true, inserted: 1 });
  });
  it("maps server refusals", async () => {
    for (const [reason, err] of [["disabled", "disabled"], ["too_soon", "too_soon"], ["not_allowed", "not_allowed"], ["not_signed_in", "signed_out"]]) {
      rpc.mockResolvedValueOnce({ data: { ok: false, reason }, error: null });
      expect((await uploadFmExport(file())).error).toBe(err);
    }
  });
  it("wrong file never calls the server", async () => {
    expect((await uploadFmExport(new Uint8Array([1, 2, 3]))).error).toBe("not_fm_export");
    expect(rpc).not.toHaveBeenCalled();
  });
});
