// Parcel Scan (Phase A1, ADMIN-ONLY dogfood) — client half.
//
// Flow: owner multi-picks handwritten-slip photos → each is downscaled on a
// canvas (~1500px long edge JPEG) → POSTed ONE AT A TIME to the live server's
// admin-guarded /admin/parcel-scan (broadcastTranslate.ts client shape — the
// server re-checks is_admin, this is NOT a UI-only gate) → the owner confirms →
// one INSERT into parcel_scans per confirmed parcel (own-scoped RLS).
//
// ⚠️ EGRESS-SAFE: read-on-open (one select of recent rows) + write-on-action
// (one insert per Save, one scan call per picked photo). ZERO poll. The photo
// is NEVER stored — it exists only inside the one scan request.
import { SERVER } from "./serverIdentity";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { isAdminRole } from "../../lib/roles";
import { SHIP_TEMP_AMBIENT, validateRecipientName, validPhone, validStore, validateAmounts, SHIP_MIN_TOTAL, SHIP_MAX_TOTAL } from "./shipping";

// ── Feature gate (canUseClassicText pattern: printing.ts) ─────────────────────
// ADMIN ROLE ONLY — deliberately NO googletest allowlist (diverges from
// canUseClassicText): the server route requires admin anyway, so googletest
// would only see a button that always 403s — and it's the Apple review demo
// account. The server route independently enforces admin regardless.
export function canUseParcelScan(role: string | undefined | null): boolean {
  return isAdminRole(role);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type ScanConfidence = "high" | "low";
export interface ScanFields {
  name: string | null;
  phone: string | null;
  store_id: string | null;
  amount: number | null;
  notes: string | null;
}
export interface ScanResult {
  ok: boolean;
  fields?: ScanFields;
  confidence?: Record<keyof ScanFields, ScanConfidence>;
  error?: string;
  unreachable?: boolean; // server not deployed yet / offline
}
// E-Map store-code verdict (server /admin/parcel-emap-check). "checking" is a
// LOCAL transient only (never persisted) shown while a lookup is in flight.
export type StoreCheckStatus = "valid" | "not_found" | "unknown" | "checking";
export interface ParcelScanRow {
  id: string;
  customerName: string;
  phone: string;
  storeId: string;
  amount: number | null;
  notes: string;
  status: string;
  storeCheckStatus: string | null; // valid | not_found | unknown | checking | null
  createdAt: string;
}

// ── Image downscale (pure math split out for unit tests) ──────────────────────
export const SCAN_MAX_EDGE = 1500; // long-edge px cap — plenty for handwriting, cuts vision tokens
export const SCAN_JPEG_QUALITY = 0.8;

export function scaledDims(w: number, h: number, maxEdge: number = SCAN_MAX_EDGE): { w: number; h: number } {
  const safeW = Math.max(1, Math.round(w) || 1);
  const safeH = Math.max(1, Math.round(h) || 1);
  const long = Math.max(safeW, safeH);
  if (long <= maxEdge) return { w: safeW, h: safeH };
  const k = maxEdge / long;
  return { w: Math.max(1, Math.round(safeW * k)), h: Math.max(1, Math.round(safeH * k)) };
}

// File → downscaled JPEG base64 (no data: prefix). Canvas re-encode also strips
// EXIF; browsers apply EXIF orientation when DECODING, so the pixels land
// upright. Throws only inside the returned promise — callers treat any failure
// as a per-parcel error card.
export async function fileToScanBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolvePromise, reject) => {
      const el = new Image();
      el.onload = () => resolvePromise(el);
      el.onerror = () => reject(new Error("image_decode_failed"));
      el.src = url;
    });
    const { w, h } = scaledDims(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", SCAN_JPEG_QUALITY);
    const comma = dataUrl.indexOf(",");
    if (comma === -1) throw new Error("encode_failed");
    return { base64: dataUrl.slice(comma + 1), mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Confirm-form validation (pure — the screen imports these) ─────────────────
// Non-empty fields are checked with the EXISTING 賣貨便 validators; EMPTY fields
// are allowed — unreadable handwriting saves as null and gets fixed at encode
// time (A2). Amount range is a WARNING only (per spec), never a block.
// (validators + SHIP_MIN/MAX_TOTAL imported at the top of the file.)

export interface ScanFormState { name: string; phone: string; store: string; amount: string; notes: string }

export function formErrors(f: ScanFormState): { name: boolean; phone: boolean; store: boolean; empty: boolean } {
  const name = f.name.trim();
  const nameBad = name !== "" && validateRecipientName(name) !== "";
  const phoneBad = f.phone.trim() !== "" && !validPhone(f.phone);
  const storeBad = f.store.trim() !== "" && !validStore(f.store);
  const empty = name === "" && f.phone.trim() === "" && f.store.trim() === "" && f.amount.trim() === "" && f.notes.trim() === "";
  return { name: nameBad, phone: phoneBad, store: storeBad, empty };
}
export const amountWarns = (amount: string): boolean => {
  const t = amount.trim();
  if (t === "") return false;
  const n = Number(t);
  return !Number.isFinite(n) || n < SHIP_MIN_TOTAL || n > SHIP_MAX_TOTAL;
};

// ── Scan API call (translateBroadcast client shape) ───────────────────────────
export async function scanParcel(base64: string, mediaType: string): Promise<ScanResult> {
  if (!base64) return { ok: false, error: "empty_image" };
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(`${SERVER}/admin/parcel-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ imageBase64: base64, mediaType }),
    });
    const j = await r.json().catch(() => ({} as { success?: boolean; fields?: ScanFields; confidence?: Record<keyof ScanFields, ScanConfidence>; error?: string }));
    if (r.status === 403) return { ok: false, error: "forbidden" };
    if (!r.ok || !j.success || !j.fields) return { ok: false, error: j.error || `http_${r.status}` };
    return { ok: true, fields: j.fields, confidence: j.confidence };
  } catch {
    return { ok: false, error: "unreachable", unreachable: true };
  }
}

// ── parcel_scans reads/writes (shippingDb pattern; getSession = LOCAL) ────────
async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export function rowToScan(row: Record<string, unknown>): ParcelScanRow {
  return {
    id: String(row.id),
    customerName: String(row.customer_name ?? ""),
    phone: String(row.phone ?? ""),
    storeId: String(row.store_id ?? ""),
    amount: row.amount === null || row.amount === undefined || row.amount === "" ? null : Number(row.amount),
    notes: String(row.notes ?? ""),
    status: String(row.status ?? "pending"),
    storeCheckStatus: row.store_check_status ? String(row.store_check_status) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export const SCANS_PAGE = 50; // recent rows on screen open — A2 brings the full queue UX

export async function loadParcelScans(): Promise<{ ok: boolean; rows: ParcelScanRow[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const { data, error } = await supabase
    .from("parcel_scans")
    .select("id, customer_name, phone, store_id, amount, notes, status, store_check_status, created_at")
    .eq("user_id", me)
    .order("created_at", { ascending: false })
    .limit(SCANS_PAGE);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => rowToScan(r as Record<string, unknown>)) };
}

const newParcelId = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// One INSERT per confirmed parcel — status 'confirmed', the model's raw
// fields+confidence kept in raw_extraction for later accuracy tuning. Returns
// the new row id so the caller can attach the async E-Map store-code verdict.
//
// ⚠️ FIRE-FIX (2026-09-08): the id is generated CLIENT-SIDE and inserted, and
// we use a BARE .insert() — NOT the previous `.insert(...).select("id").single()`
// chain. That chain (the ONLY .select()-after-insert in the whole codebase — every
// other adapter uses a bare insert) returned ok:false on the real supabase-js
// path even though the row committed, so the caller's `if (r.id)` guard never
// passed and the store-code check NEVER FIRED (zero POSTs to /admin/parcel-emap-
// check in prod). With a client-supplied id the guard always passes on a real
// save, and the id matches the row (so saveStoreCheck's .eq("id") updates it).
// The parcel_scans.id column defaults to gen_random_uuid() but accepts a
// supplied uuid; RLS insert check (user_id = auth.uid()) is unaffected.
export async function saveParcelScan(
  fields: ScanFields,
  rawExtraction: { fields: ScanFields; confidence?: Record<keyof ScanFields, ScanConfidence> } | null,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const id = newParcelId();
  const { error } = await supabase.from("parcel_scans").insert({
    id,
    user_id: me,
    customer_name: fields.name,
    phone: fields.phone,
    store_id: fields.store_id,
    amount: fields.amount,
    notes: fields.notes,
    status: "confirmed",
    raw_extraction: rawExtraction,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

// ── E-Map store-code check (best-effort; never blocks) ────────────────────────
export interface EmapCheckResult { status: StoreCheckStatus; storeName?: string; address?: string }

// Calls the admin-guarded server route (server re-checks is_admin). Any failure
// — 403, network, non-ok — resolves to "unknown" (grey "can't verify" badge),
// never throws, never blocks encoding.
export async function checkEmapStore(storeId: string): Promise<EmapCheckResult> {
  if (!/^\d{6}$/.test(String(storeId || "").trim())) return { status: "unknown" };
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(`${SERVER}/admin/parcel-emap-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ storeId }),
    });
    const j = await r.json().catch(() => ({} as { success?: boolean; status?: string; storeName?: string; address?: string }));
    if (!r.ok || !j.success) return { status: "unknown" };
    const status: StoreCheckStatus = j.status === "valid" || j.status === "not_found" ? j.status : "unknown";
    return { status, storeName: j.storeName, address: j.address };
  } catch {
    return { status: "unknown" };
  }
}

// ── 賣貨便 訂單匯入 Excel export (reuses the EXISTING, 賣貨便-accepted builder) ──
// The row-mapper mirrors shippingExport.entryToXlsRow's A–J shape so the SAME
// buildXlsmFromTemplate + patchXlsmTemplate produce a file 賣貨便 accepts. No
// quota RPC (admin-only, owner is sole user). Pure — unit-tested.

// H 買家下訂日期 — the scan's created_at as the seller's Taipei day, template's
// slashed no-leading-zero format (2026/9/8), matching orderDateFromSessionKey.
export function scanOrderDate(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // Strip leading zeros on month/day to match orderDateFromSessionKey (2026/9/8).
  return `${g("year")}/${Number(g("month"))}/${Number(g("day"))}`;
}

export interface ScanXlsOpts { storeName: string; fee: number; tempLayer?: string }

// parcel_scans row → 賣貨便 A–J string[] (all strings; required cols are Text @).
// Gap columns (owner-decided): D 溫層 = 常溫 (clothing is ambient), E 商品 =
// the seller's shop name (same for every row; no new DB field), G 運費 =
// seller_shipping_settings.default_fee, I/J = blank.
export function scanToXlsRow(row: ParcelScanRow, opts: ScanXlsOpts): string[] {
  return [
    row.customerName.trim(),                          // A ＊取件人姓名
    row.phone.trim(),                                 // B ＊取件人手機 (leading 0 kept)
    row.storeId.trim(),                               // C ＊取件門市
    opts.tempLayer ?? SHIP_TEMP_AMBIENT,              // D ＊溫層 = 常溫
    String(opts.storeName || "").trim(),              // E ＊商品 = shop name (e.g. Budgetukay)
    row.amount == null ? "" : String(row.amount),     // F ＊訂單金額
    String(opts.fee),                                 // G ＊運費金額 = default_fee
    scanOrderDate(row.createdAt),                     // H 買家下訂日期 (optional)
    "",                                               // I 商品備註 (blank)
    "",                                               // J 其他資訊 (blank — parcel_scans has no handle)
  ];
}

// ── Export gate — split rows into READY (go into the Excel) vs NEEDS-ATTENTION
// (excluded, listed with a reason). Uses the SAME 賣貨便 validators as the
// shipping export, PLUS store_check_status. Rows already 'exported' are skipped
// (neither bucket). store_check_status 'unknown'/null → READY (soft-warned in
// the UI, never excluded: E-Map may be down / the confirmed-gate off). Pure.
export type ExportReason = "wrong_store" | "bad_name" | "bad_phone" | "bad_store" | "bad_amount";
export interface ScanExportSplit {
  ready: ParcelScanRow[];
  attention: { row: ParcelScanRow; reason: ExportReason }[];
}
export function splitScansForExport(rows: ParcelScanRow[], fee: number): ScanExportSplit {
  const ready: ParcelScanRow[] = [];
  const attention: { row: ParcelScanRow; reason: ExportReason }[] = [];
  for (const row of rows) {
    if (row.status === "exported") continue; // already done — don't re-include
    let reason: ExportReason | null = null;
    if (row.storeCheckStatus === "not_found") reason = "wrong_store";           // E-Map: wrong code
    else if (validateRecipientName(row.customerName) !== "") reason = "bad_name";
    else if (!validPhone(row.phone)) reason = "bad_phone";
    else if (!validStore(row.storeId)) reason = "bad_store";
    else if (validateAmounts(row.amount == null ? NaN : row.amount, fee) !== "") reason = "bad_amount"; // null amount → excluded
    if (reason) attention.push({ row, reason });
    else ready.push(row);
  }
  return { ready, attention };
}

// Mark exported rows done so re-exports skip them (status 'exported', sql/27).
// Own-scoped via RLS; best-effort. Empty id list is a no-op success.
export async function markScansExported(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (!ids.length) return { ok: true };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("parcel_scans").update({ status: "exported" }).in("id", ids).eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Persist the verdict onto the row (own-scoped via RLS). 'checking' is local-
// only and never written. Best-effort — a failed write just leaves the row
// unchecked; the badge falls back to "can't verify".
export async function saveStoreCheck(rowId: string, status: StoreCheckStatus): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (status === "checking") return { ok: false, error: "transient" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase
    .from("parcel_scans")
    .update({ store_check_status: status, store_check_at: new Date().toISOString() })
    .eq("id", rowId)
    .eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}
