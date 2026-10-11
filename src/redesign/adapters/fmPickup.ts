// 全家 (FamilyMart) pickup — the seller downloads the 好賣+ "Order export" (.xlsx) and uploads
// it on Pickup Status. We read it here (client-side, no SheetJS — same zip primitives as the
// 賣貨便 reader), map each order to a pickup status, and send the rows to the
// fm_pickup_upload RPC (sql/119) under the seller's own JWT. The SHOPMORE poller never sees
// these rows (carrier = 'fm').
//
// File contract: first sheet, header row 1, data from row 2, columns found BY HEADER TEXT.
import { parseZip, readEntryText } from "./shippingXlsmPatch";
import { rowsOf, sharedStrings } from "./parcelExportRead";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { log } from "../../lib/log";
import { FM_SCAN_DEFAULT_PRODUCT } from "./fmScan";

export const FM_MAX_ROWS = 2000;

const H = {
  orderNo: "訂單編號", status: "訂單狀態", deadline: "取貨截止日", name: "收件人姓名",
  phone: "取件人手機", trackingNo: "寄件編號", shipType: "配送方式", storeId: "取件店號",
  storeName: "取件店名", total: "訂單總金額", content: "訂單內容", shipped: "寄件日期",
  picked: "取件日期", returned: "包裹退回取件日期", cancelled: "取消日期",
  statusTime: "訂單狀態時間", orderDate: "訂購日期",
} as const;
type Key = keyof typeof H;
// Without these the file is not a 全家 Order export.
const REQUIRED: Key[] = ["orderNo", "status", "shipped", "picked", "returned", "cancelled", "content"];

export type FmStatus = "at_store" | "in_transit" | "picked_up" | "returned" | "hide";

export interface FmRow {
  order_no: string;
  status: FmStatus;
  status_message: string | null;
  tracking_no: string | null;
  pickup_deadline: string | null; // YYYY-MM-DD
  picked_up_at: string | null;    // ISO, +08:00
  returned_at: string | null;
  buyer_username: string | null;
  recipient_name: string | null;  // masked in the export, stored as-is
  recipient_phone: string | null; // masked in the export, stored as-is
  store_id: string | null;        // 6 digits, leading 0 kept
  rec_store: string | null;
  order_amount: number | null;
  ship_type: string | null;
}

export type FmParseError = "not_fm_export" | "too_many";

// ── dates ─────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

// Excel serial (days since 1899-12-30) or "2026/10/5 下午 02:30:00" / "2026-10-05 14:30".
// Returns local Taipei wall-clock parts, or null.
function dateParts(v: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const serial = Number(t);
    if (!(serial > 1)) return null;
    const ms = Math.round((serial - 25569) * 86400000); // as UTC wall clock
    const dt = new Date(ms);
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds() };
  }
  const m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (!m) return null;
  let h = m[5] ? Number(m[5]) : 0;
  const ap = (m[4] || m[8] || "").toUpperCase();
  if ((ap === "下午" || ap === "PM") && h < 12) h += 12;
  if ((ap === "上午" || ap === "AM") && h === 12) h = 0;
  const p = { y: +m[1], mo: +m[2], d: +m[3], h, mi: m[6] ? +m[6] : 0, s: m[7] ? +m[7] : 0 };
  if (p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31 || p.h > 23 || p.mi > 59 || p.s > 59) return null;
  return p;
}
export function fmDate(v: string): string | null {
  const p = dateParts(v);
  return p ? `${p.y}-${pad(p.mo)}-${pad(p.d)}` : null;
}
export function fmTimestamp(v: string): string | null {
  const p = dateParts(v);
  return p ? `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}+08:00` : null;
}

// ── status ────────────────────────────────────────────────────────────────────
const ARRIVED = /到店|到門市|到達門市/;
// Words we expect in 訂單狀態; anything else is logged once (the date-based result stands).
const KNOWN = /到店|到門市|取件|取貨|退回|退貨|取消|配送|運送|寄件|出貨|已成立|處理|待|完成/;
const seenUnknown = new Set<string>();

export interface FmStatusInput { status: string; shipped: string; picked: string; returned: string; cancelled: string; deadline?: string; trackingNo?: string }

// PURE. null = not shipped yet (處理中: no 寄件編號 and no 寄件日期) → not shown.
export function fmStatusOf(r: FmStatusInput): FmStatus | null {
  const has = (v: string) => String(v ?? "").trim() !== "";
  if (has(r.cancelled)) return "hide";
  if (has(r.returned)) return "returned";
  if (has(r.picked)) return "picked_up";
  // A pickup deadline only exists once the parcel is at the store, so it counts as arrived too.
  if (has(r.shipped)) return ARRIVED.test(r.status || "") || has(r.deadline ?? "") ? "at_store" : "in_transit";
  // Tracking number issued, not dropped off yet (出貨中) → in transit, like 7-11.
  if (has(r.trackingNo ?? "")) return "in_transit";
  return null;
}

// 好賣+ voids a tracking number this many days after it was issued.
export const FM_DROP_OFF_DAYS = 14;

// PURE. Drop-off deadline (YYYY-MM-DD) = the 訂單狀態時間 date ("MM/DD HH:mm", no year) + 14 days.
// The year comes from 訂購日期; a status date before the order date means the next year.
export function fmDropOffDeadline(statusTime: string, orderDate: string): string | null {
  const m = String(statusTime ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\s|$)/);
  const o = dateParts(orderDate);
  if (!m || !o) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let y = o.y;
  if (mo < o.mo || (mo === o.mo && d < o.d)) y += 1;
  const dt = new Date(Date.UTC(y, mo - 1, d + FM_DROP_OFF_DAYS));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function noteUnknownStatus(text: string) {
  const t = text.trim();
  if (!t || KNOWN.test(t) || seenUnknown.has(t)) return;
  seenUnknown.add(t);
  log.warn(`[FM] unknown 訂單狀態 text: ${t}`);
}

// "@juan_dela.cruz  1" → "juan_dela.cruz" ; "汽泡水  1" → "汽泡水".
// "商品  1" → null: Parcel Scan FamilyMart writes that placeholder when the buyer has no @username.
export function fmBuyerUsername(content: string): string | null {
  const s = String(content ?? "").replace(/\s+\d+\s*$/, "").trim().replace(/^@/, "").trim();
  return s && s !== FM_SCAN_DEFAULT_PRODUCT ? s : null;
}

function storeIdOf(v: string): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  return /^\d{1,6}$/.test(t) ? t.padStart(6, "0") : t;
}

// ── parse ─────────────────────────────────────────────────────────────────────
// Real headers carry a note after the name ("訂單內容 (品名 規格/尺寸 顏色 數量)", "訂單總金額 (A+B-C)").
// A header matches when it IS the name, or the whole name followed by a space or an opening
// bracket — so 取件日期 never matches 包裹退回取件日期 and 訂單狀態 never matches 訂單狀態時間.
export function headerMatches(header: string, key: string): boolean {
  const h = String(header ?? "").trim();
  if (h === key) return true;
  return h.startsWith(key) && /^[\s(（]/.test(h.slice(key.length));
}

export async function parseFmExport(bytes: Uint8Array): Promise<{ ok: true; rows: FmRow[]; notShipped: number } | { ok: false; error: FmParseError }> {
  const bad = { ok: false as const, error: "not_fm_export" as const };
  let entries: ReturnType<typeof parseZip>;
  try { entries = parseZip(bytes); } catch { return bad; }
  const byName = new Map(entries.map((e) => [e.name, e]));
  // First sheet = the lowest-numbered worksheet file.
  const sheets = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!sheets.length) return bad;
  let sheetRows: ReturnType<typeof rowsOf>;
  try {
    const ssE = byName.get("xl/sharedStrings.xml");
    const S = ssE ? sharedStrings(await readEntryText(bytes, ssE)) : [];
    sheetRows = rowsOf(await readEntryText(bytes, byName.get(sheets[0])!), S);
  } catch { return bad; }

  const header = sheetRows.find((r) => r.rn === 1);
  if (!header) return bad;
  const col: Partial<Record<Key, string>> = {};
  for (const [c, v] of Object.entries(header.cells)) {
    for (const k of Object.keys(H) as Key[]) if (!col[k] && headerMatches(v, H[k])) col[k] = c;
  }
  if (REQUIRED.some((k) => !col[k])) return bad;

  const data = sheetRows.filter((r) => r.rn >= 2).sort((a, b) => a.rn - b.rn)
    .filter((r) => String(r.cells[col.orderNo!] ?? "").trim() !== "");
  if (data.length > FM_MAX_ROWS) return { ok: false, error: "too_many" };

  const get = (r: (typeof data)[number], k: Key) => (col[k] ? String(r.cells[col[k]!] ?? "") : "");
  const rows: FmRow[] = [];
  let notShipped = 0;
  for (const r of data) {
    const statusText = get(r, "status").trim();
    const shipped = get(r, "shipped");
    const status = fmStatusOf({ status: statusText, shipped, picked: get(r, "picked"), returned: get(r, "returned"), cancelled: get(r, "cancelled"), deadline: get(r, "deadline"), trackingNo: get(r, "trackingNo") });
    if (status) noteUnknownStatus(statusText);
    if (!status) { notShipped += 1; continue; }
    const shipType = get(r, "shipType").trim();
    const amount = Number(get(r, "total").replace(/[,\s]/g, ""));
    rows.push({
      order_no: get(r, "orderNo").trim(),
      status,
      status_message: statusText || null,
      tracking_no: get(r, "trackingNo").trim() || null,
      // at_store: the pickup deadline. Not dropped off yet (出貨中, no 寄件日期): the drop-off deadline.
      pickup_deadline: status === "at_store" ? fmDate(get(r, "deadline"))
        : status === "in_transit" && !shipped.trim() && statusText.includes("出貨中") ? fmDropOffDeadline(get(r, "statusTime"), get(r, "orderDate"))
          : null,
      picked_up_at: status === "picked_up" ? fmTimestamp(get(r, "picked")) : null,
      returned_at: status === "returned" ? fmTimestamp(get(r, "returned")) : null,
      buyer_username: fmBuyerUsername(get(r, "content")),
      recipient_name: get(r, "name").trim() || null,
      recipient_phone: get(r, "phone").trim() || null,
      store_id: storeIdOf(get(r, "storeId")),
      rec_store: get(r, "storeName").trim() || null,
      order_amount: get(r, "total").trim() !== "" && Number.isFinite(amount) ? amount : null,
      ship_type: shipType.includes("店到店") ? "C2C" : (shipType || null),
    });
  }
  return { ok: true, rows, notShipped };
}

// ── upload ────────────────────────────────────────────────────────────────────
export type FmUploadError =
  | "not_fm_export" | "too_many" | "empty" | "signed_out" | "disabled" | "not_allowed" | "too_soon" | "network";

export interface FmUploadResult {
  ok: boolean;
  error?: FmUploadError;
  inserted?: number; updated?: number; hidden?: number; skipped?: number; notShipped?: number;
  atStore?: number; // parcels in the file now waiting at the store
}

export async function uploadFmExport(bytes: Uint8Array): Promise<FmUploadResult> {
  const parsed = await parseFmExport(bytes);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  if (!parsed.rows.length) return { ok: false, error: "empty", notShipped: parsed.notShipped };
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "signed_out" };
  const { data, error } = await supabase.rpc("fm_pickup_upload", { p_rows: parsed.rows });
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    return { ok: false, error: error.code === "PGRST301" || msg.includes("jwt") ? "signed_out" : "network" };
  }
  const d = (data ?? {}) as { ok?: boolean; reason?: string; inserted?: number; updated?: number; hidden?: number; skipped?: number };
  if (!d.ok) {
    const map: Record<string, FmUploadError> = { not_signed_in: "signed_out", disabled: "disabled", not_allowed: "not_allowed", too_many: "too_many", too_soon: "too_soon" };
    return { ok: false, error: map[d.reason ?? ""] ?? "network" };
  }
  return { ok: true, inserted: d.inserted ?? 0, updated: d.updated ?? 0, hidden: d.hidden ?? 0, skipped: d.skipped ?? 0, notShipped: parsed.notShipped,
    atStore: parsed.rows.filter((r) => r.status === "at_store").length };
}
