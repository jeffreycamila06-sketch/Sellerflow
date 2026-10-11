// Parcel Scan FamilyMart (全家) — the seller types each parcel, then exports a 好賣+ 大量匯單 .xlsx
// (sql/120). Separate from the 7-11 Parcel Scan (parcel_scans) — nothing here touches it.
//
// File layout = FamilyMart's own sample (verified by real uploads to 好賣+): one sheet 大量匯單,
// rows 1–17 FamilyMart's instructions, row 19 the headers (A–G), data from row 20. EVERY data cell
// is a text cell, so phone 09… and store 0… keep their leading 0. Max 500 rows per file.
import { buildZip, crc32 } from "./shippingXlsmPatch";
import { isSupabaseConfigured, supabase } from "../../supabase";

export const FM_SCAN_MAX_PER_FILE = 500;
export const FM_SCAN_DEFAULT_FEE = 39;
export const FM_SCAN_DATE_WINDOW_DAYS = 60;
export const FM_SCAN_DEFAULT_PRODUCT = "商品";

export interface FmScanRow {
  id: string;
  recipientName: string;
  phone: string;
  storeId: string;
  amount: number;
  shippingFee: number;
  orderDate: string;          // YYYY-MM-DD
  buyerUsername: string | null;
  createdAt: string;
  exportedAt: string | null;
  exportBatchId: string | null;
}

export interface FmScanInput {
  recipientName: string; phone: string; storeId: string;
  amount: string; shippingFee: string; orderDate: string; buyerUsername: string;
}

export type FmScanField = "recipientName" | "phone" | "storeId" | "amount" | "shippingFee" | "orderDate" | "buyerUsername" | "total";
export type FmScanError =
  | "name_required" | "name_long" | "phone" | "store" | "amount" | "fee" | "total" | "date" | "username_long";

// ── rules (FamilyMart 大量匯單) ──────────────────────────────────────────────────
export const normPhone = (v: string) => String(v ?? "").replace(/[\s-]/g, "");
export const normStore = (v: string) => String(v ?? "").replace(/\s/g, "");

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// PURE. today = Taipei YYYY-MM-DD. Returns the first problem per field (empty = OK).
export function validateFmScan(input: FmScanInput, today: string): Partial<Record<FmScanField, FmScanError>> {
  const e: Partial<Record<FmScanField, FmScanError>> = {};
  const name = input.recipientName.trim();
  if (!name) e.recipientName = "name_required";
  else if (name.length > 50) e.recipientName = "name_long";
  if (!/^09\d{8}$/.test(normPhone(input.phone))) e.phone = "phone";
  if (!/^\d{6}$/.test(normStore(input.storeId))) e.storeId = "store";
  const amt = Number(input.amount), fee = Number(input.shippingFee);
  const amtOk = input.amount.trim() !== "" && Number.isFinite(amt) && amt >= 10 && amt <= 20000;
  const feeOk = input.shippingFee.trim() !== "" && Number.isFinite(fee) && fee >= 0 && fee <= 200;
  if (!amtOk) e.amount = "amount";
  if (!feeOk) e.shippingFee = "fee";
  if (amtOk && feeOk && (amt + fee < 60 || amt + fee > 20000)) e.total = "total";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(input.orderDate) ? daysBetween(input.orderDate, today) : NaN;
  if (!(d >= 0 && d <= FM_SCAN_DATE_WINDOW_DAYS)) e.orderDate = "date";
  if (input.buyerUsername.trim().length > 100) e.buyerUsername = "username_long";
  return e;
}

// ── file ──────────────────────────────────────────────────────────────────────
const INSTRUCTIONS = [
  "好賣+ 大量匯單",
  "匯入欄位說明",
  "1. 取件人姓名：(必填欄位) 取件時所看到名稱，請確實填寫",
  "2. 取件人手機：(必填欄位) 10 碼數字，勿使用「-」符號，請代入純數字值。例如：0987654321",
  "3. 取件門市：(必填欄位) 請填寫門市服務代號 6 碼數字，門市服務代號請從 https://www.family.com.tw/marketing/inquiry.aspx 查詢",
  "4. 商品金額：(必填欄位) 請填數字，10 ≦ 商品金額≦ 20000",
  "5. 運費金額：(必填欄位) 請填寫數字，0 ≦ 運費金額 ≦ 200",
  "6. 訂購日期：(必填欄位) 請填寫買家下訂日期，並以西元年註記。例如 108 年 7 月 31 日，請填寫 2019/7/31。若「訂購日期」為三個月前，將無法在「訂單管理」找尋此訂單。\n大量匯單「訂購日期」須為上傳當日前60天內之訂單。若要上傳未來成立之訂單，則為180天以內為限。",
  "7. 商品：請賣家自行填入商品名稱。",
  "匯入檢核",
  "請在檔案填入商品資料，一次最多可以上傳 500 筆商品資料",
  "按下 「驗證」 後，本巨集會協助您檢查資料格式。",
  "注意事項：",
  "1. 必填欄位請務必帶值",
  "2. 請將每個欄位的儲存格格式設為 文字 ※重要",
  "3. 訂單金額區間：60 ≦ (商品金額  + 運費金額) ≦ 20000",
  "資料驗證成功，請存檔案並回賣場匯入",
];
export const FM_SCAN_HEADERS = ["取件人姓名", "取件人手機", "取件門市", "商品金額", "運費金額", "訂購日期", "商品"];
export const FM_SCAN_HEADER_ROW = 19;

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const numStr = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

// One parcel → the 7 text cells, in column order A–G.
export function fmScanCells(r: Pick<FmScanRow, "recipientName" | "phone" | "storeId" | "amount" | "shippingFee" | "orderDate" | "buyerUsername">): string[] {
  return [
    r.recipientName.trim(), normPhone(r.phone), normStore(r.storeId), numStr(r.amount), numStr(r.shippingFee),
    r.orderDate.replace(/-/g, "/"), (r.buyerUsername ?? "").trim() || FM_SCAN_DEFAULT_PRODUCT,
  ];
}

// PURE. Builds one .xlsx (max 500 rows — call per chunk).
export function buildFmXlsx(rows: Parameters<typeof fmScanCells>[0][]): Uint8Array {
  const col = (i: number) => String.fromCharCode(65 + i);
  const cell = (ref: string, v: string, s: number) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  let data = INSTRUCTIONS.map((t, i) => `<row r="${i + 1}">${cell(`A${i + 1}`, t, 1)}</row>`).join("");
  data += `<row r="${FM_SCAN_HEADER_ROW}">${FM_SCAN_HEADERS.map((h, i) => cell(`${col(i)}${FM_SCAN_HEADER_ROW}`, h, 1)).join("")}</row>`;
  rows.forEach((r, k) => {
    const rn = FM_SCAN_HEADER_ROW + 1 + k;
    data += `<row r="${rn}">${fmScanCells(r).map((v, i) => cell(`${col(i)}${rn}`, v, 1)).join("")}</row>`;
  });
  const last = FM_SCAN_HEADER_ROW + Math.max(rows.length, 0);
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><dimension ref="A1:G${last}"/>`
    + `<cols><col min="1" max="7" width="19.37" customWidth="1" style="1"/></cols><sheetData>${data}</sheetData>`
    + `<mergeCells count="2"><mergeCell ref="A1:G1"/><mergeCell ref="A8:G8"/></mergeCells></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${NS}>`
    + `<fonts count="1"><font><sz val="12"/><name val="新細明體"/><family val="1"/><charset val="136"/></font></fonts>`
    + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} xmlns:r="${R}"><sheets><sheet name="大量匯單" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const enc = new TextEncoder();
  const file = (name: string, text: string) => {
    const data = enc.encode(text);
    return { name, flags: 0x0800, method: 0, time: 0, date: 0x21, crc: crc32(data), csize: data.length, usize: data.length, data };
  };
  return buildZip([
    file("[Content_Types].xml", types), file("_rels/.rels", rootRels), file("xl/workbook.xml", workbook),
    file("xl/_rels/workbook.xml.rels", wbRels), file("xl/styles.xml", styles), file("xl/worksheets/sheet1.xml", sheet),
  ]);
}

// PURE. 500 per file, in order.
export function splitForExport<T>(rows: T[], per = FM_SCAN_MAX_PER_FILE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out;
}

// The files for one export (500 per file, numbered names), stamped with the current time.
export function buildFmExport<R extends Parameters<typeof fmScanCells>[0]>(rows: R[], nowMs = Date.now()) {
  const chunks = splitForExport(rows);
  return { nowMs, files: chunks.map((c, i) => ({ name: fmExportFilename(nowMs, i + 1, chunks.length), bytes: buildFmXlsx(c) })) };
}

// familymart_YYYYMMDD_HHmm[_n].xlsx — Taipei clock.
export function fmExportFilename(nowMs: number, part: number, parts: number): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(nowMs));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `familymart_${g("year")}${g("month")}${g("day")}_${g("hour")}${g("minute")}${parts > 1 ? `_${part}` : ""}.xlsx`;
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type ShareNav = Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };

// App shell (phone): ONE share sheet with every file — call synchronously from the tap.
// Browser: one download per file.
export function deliverFmFiles(files: { name: string; bytes: Uint8Array }[], appShell: boolean): Promise<{ ok: boolean; cancelled?: boolean }> {
  if (appShell) {
    const nav = (typeof navigator !== "undefined" ? navigator : undefined) as ShareNav | undefined;
    if (!nav?.share || typeof File === "undefined") return Promise.resolve({ ok: false });
    const list = files.map((f) => new File([f.bytes.buffer as ArrayBuffer], f.name, { type: XLSX_TYPE }));
    if (nav.canShare && !nav.canShare({ files: list })) return Promise.resolve({ ok: false });
    return nav.share({ files: list }).then(() => ({ ok: true }), (e) => ({ ok: false, cancelled: e instanceof DOMException && e.name === "AbortError" }));
  }
  if (typeof document === "undefined") return Promise.resolve({ ok: false });
  for (const f of files) {
    const url = URL.createObjectURL(new Blob([f.bytes.buffer as ArrayBuffer], { type: XLSX_TYPE }));
    const a = document.createElement("a");
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return Promise.resolve({ ok: true });
}

// ── database (own rows, RLS) ───────────────────────────────────────────────────
const COLS = "id, recipient_name, phone, store_id, amount, shipping_fee, order_date, buyer_username, created_at, exported_at, export_batch_id";
function toRow(r: Record<string, unknown>): FmScanRow {
  return {
    id: String(r.id), recipientName: String(r.recipient_name ?? ""), phone: String(r.phone ?? ""), storeId: String(r.store_id ?? ""),
    amount: Number(r.amount), shippingFee: Number(r.shipping_fee), orderDate: String(r.order_date ?? ""),
    buyerUsername: r.buyer_username == null ? null : String(r.buyer_username), createdAt: String(r.created_at ?? ""),
    exportedAt: r.exported_at == null ? null : String(r.exported_at), exportBatchId: r.export_batch_id == null ? null : String(r.export_batch_id),
  };
}
async function uid(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function loadFmScans(): Promise<{ ok: boolean; rows: FmScanRow[] }> {
  const me = await uid();
  if (!me) return { ok: false, rows: [] };
  const { data, error } = await supabase!.from("fm_parcel_scans").select(COLS).eq("user_id", me).order("created_at", { ascending: false }).limit(2000);
  if (error) return { ok: false, rows: [] };
  return { ok: true, rows: (data ?? []).map((r) => toRow(r as Record<string, unknown>)) };
}

export function inputToDb(input: FmScanInput) {
  return {
    recipient_name: input.recipientName.trim(), phone: normPhone(input.phone), store_id: normStore(input.storeId),
    amount: Number(input.amount), shipping_fee: Number(input.shippingFee), order_date: input.orderDate,
    buyer_username: input.buyerUsername.trim() || null,
  };
}

export async function saveFmScan(input: FmScanInput, id?: string): Promise<{ ok: boolean; row?: FmScanRow }> {
  const me = await uid();
  if (!me) return { ok: false };
  const q = id
    ? supabase!.from("fm_parcel_scans").update(inputToDb(input)).eq("id", id).eq("user_id", me)
    : supabase!.from("fm_parcel_scans").insert({ user_id: me, ...inputToDb(input) });
  const { data, error } = await q.select(COLS).single();
  if (error || !data) return { ok: false };
  return { ok: true, row: toRow(data as Record<string, unknown>) };
}

export async function deleteFmScan(id: string): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { error } = await supabase!.from("fm_parcel_scans").delete().eq("id", id).eq("user_id", me);
  return !error;
}

export async function markFmExported(ids: string[], batchId: string, atIso: string): Promise<boolean> {
  const me = await uid();
  if (!me || !ids.length) return !!me;
  const { error } = await supabase!.from("fm_parcel_scans").update({ exported_at: atIso, export_batch_id: batchId }).eq("user_id", me).in("id", ids);
  return !error;
}

export async function loadFmFee(): Promise<number> {
  const me = await uid();
  if (!me) return FM_SCAN_DEFAULT_FEE;
  const { data } = await supabase!.from("fm_scan_settings").select("shipping_fee").eq("user_id", me).maybeSingle();
  const n = Number((data as { shipping_fee?: unknown } | null)?.shipping_fee);
  return Number.isFinite(n) && n >= 0 && n <= 200 ? n : FM_SCAN_DEFAULT_FEE;
}

export async function saveFmFee(fee: number): Promise<boolean> {
  const me = await uid();
  if (!me || !(fee >= 0 && fee <= 200)) return false;
  const { error } = await supabase!.from("fm_scan_settings").upsert({ user_id: me, shipping_fee: fee, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return !error;
}
