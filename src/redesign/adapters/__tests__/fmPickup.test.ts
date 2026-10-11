import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
const warn = vi.fn();
vi.mock("../../../lib/log", () => ({ log: { warn: (...a: unknown[]) => warn(...a), log() {}, info() {}, error() {}, debug() {} } }));

import { buildZip, crc32 } from "../shippingXlsmPatch";
import { fmStatusOf, fmBuyerUsername, fmDate, fmTimestamp, parseFmExport, uploadFmExport, FM_MAX_ROWS } from "../fmPickup";

// The real 好賣+ "Order export": Sheet1, header row 1, 38 columns. Only the ones we read carry
// meaning here; the rest are filler so the column letters match a real file's width.
const HEADERS = [
  "訂購日期", "訂單編號", "訂單狀態", "訂單狀態時間", "取貨截止日", "收件人姓名", "取件人手機", "寄件編號", "付款方式",
  "配送方式", "取件店號", "取件店名", "商品總額", "運費", "訂單總金額", "訂單內容", "付款狀態", "寄件日期", "取件日期",
  "包裹退回取件日期", "取消日期",
];
while (HEADERS.length < 38) HEADERS.push(`欄${HEADERS.length + 1}`);
const colOf = (i: number) => { let s = ""; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function xlsx(rows: Record<string, string>[], headers = HEADERS): Uint8Array {
  const strings: string[] = [];
  const si = (v: string) => { let i = strings.indexOf(v); if (i < 0) { strings.push(v); i = strings.length - 1; } return i; };
  const rowXml = (rn: number, vals: string[]) => `<row r="${rn}">` + vals.map((v, i) => v === "" ? "" : `<c r="${colOf(i)}${rn}" t="s"><v>${si(v)}</v></c>`).join("") + `</row>`;
  let body = rowXml(1, headers);
  rows.forEach((r, k) => { body += rowXml(k + 2, headers.map((h) => r[h] ?? "")); });
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  const enc = new TextEncoder();
  const file = (name: string, text: string) => { const data = enc.encode(text); return { name, flags: 0, method: 0, time: 0, date: 0, crc: crc32(data), csize: data.length, usize: data.length, data }; };
  return buildZip([file("[Content_Types].xml", "<Types/>"), file("xl/workbook.xml", "<workbook/>"), file("xl/sharedStrings.xml", sst), file("xl/worksheets/sheet1.xml", sheet)]);
}

const base = { "訂購日期": "2026/10/01", "收件人姓名": "陳*美", "取件人手機": "0912***678", "配送方式": "常溫店到店", "取件店號": "022131", "取件店名": "全家中山店", "訂單總金額": "350" };

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
  ])("%j → %s", (input, want) => { expect(fmStatusOf(input)).toBe(want); });
});

describe("helpers", () => {
  it("buyer_username strips quantity and leading @", () => {
    expect(fmBuyerUsername("@juan_dela.cruz  1")).toBe("juan_dela.cruz");
    expect(fmBuyerUsername("汽泡水  1")).toBe("汽泡水");
    expect(fmBuyerUsername("  ")).toBeNull();
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

describe("parseFmExport — real export shape", () => {
  beforeEach(() => warn.mockReset());
  it("reads rows, keeps masked fields and the store leading 0, maps 店到店 to C2C", async () => {
    const r = await parseFmExport(xlsx([
      { ...base, "訂單編號": "L26A110WW1", "訂單狀態": "已到店", "取貨截止日": "2026/10/12", "寄件編號": "FM123", "訂單內容": "@juan_dela.cruz  1", "寄件日期": "2026/10/05" },
      { ...base, "訂單編號": "L26A110WW2", "訂單狀態": "已取件", "訂單內容": "汽泡水  2", "寄件日期": "2026/10/04", "取件日期": "2026/10/06 下午 01:00:00", "取件店號": "22131" },
      { ...base, "訂單編號": "L26A110WW3", "訂單狀態": "已成立", "訂單內容": "x  1" },
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notShipped).toBe(1);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ order_no: "L26A110WW1", status: "at_store", status_message: "已到店", tracking_no: "FM123", pickup_deadline: "2026-10-12", buyer_username: "juan_dela.cruz", recipient_name: "陳*美", recipient_phone: "0912***678", store_id: "022131", rec_store: "全家中山店", order_amount: 350, ship_type: "C2C" });
    expect(r.rows[1]).toMatchObject({ status: "picked_up", picked_up_at: "2026-10-06T13:00:00+08:00", pickup_deadline: null, tracking_no: null, store_id: "022131" });
  });
  it("logs unknown status text once, without names or phones", async () => {
    const row = { ...base, "訂單內容": "x  1", "寄件日期": "2026/10/05", "訂單狀態": "神秘狀態" };
    await parseFmExport(xlsx([{ ...row, "訂單編號": "A1" }, { ...row, "訂單編號": "A2" }]));
    await parseFmExport(xlsx([{ ...row, "訂單編號": "A3" }]));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/陳|0912/);
  });
  it("rejects a file that isn't a 全家 Order export", async () => {
    expect(await parseFmExport(new TextEncoder().encode("hello"))).toEqual({ ok: false, error: "not_fm_export" });
    expect(await parseFmExport(xlsx([], ["配送單編號", "其它資訊"]))).toEqual({ ok: false, error: "not_fm_export" });
  });
  it(`refuses more than ${FM_MAX_ROWS} rows`, async () => {
    const rows = Array.from({ length: FM_MAX_ROWS + 1 }, (_, i) => ({ "訂單編號": `N${i}`, "訂單狀態": "x", "訂單內容": "a  1" }));
    expect(await parseFmExport(xlsx(rows))).toEqual({ ok: false, error: "too_many" });
  });
});

describe("uploadFmExport", () => {
  beforeEach(() => rpc.mockReset());
  const file = () => xlsx([{ ...base, "訂單編號": "L1", "訂單狀態": "配送中", "訂單內容": "a  1", "寄件日期": "2026/10/05" }]);
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
