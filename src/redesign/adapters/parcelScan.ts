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
import { getAppSetting, setAppSetting } from "./appSettings";
import { isAdminRole } from "../../lib/roles";
import { isActivePaid, planDaysLeft } from "../../lib/planWindow";
import { SHIP_TEMP_AMBIENT, validateRecipientName, validPhone, validStore, validateAmounts, SHIP_MIN_TOTAL, SHIP_MAX_TOTAL } from "./shipping";

// ── Feature gate (canUseClassicText pattern: printing.ts) ─────────────────────
// ADMIN ROLE ONLY — deliberately NO googletest allowlist (diverges from
// canUseClassicText): the server route requires admin anyway, so googletest
// would only see a button that always 403s — and it's the Apple review demo
// account. The server route independently enforces admin regardless.
export function canUseParcelScan(role: string | undefined | null): boolean {
  return isAdminRole(role);
}

// ⚠️ PHASED-ROLLOUT ALLOWLIST (Jeff's decision, 2026-09-10) — the ONE place the
// allowed tiers live. Manual encode opens to PLUS / PRO / MASTER only; BASIC is
// deliberately EXCLUDED for now so Jeff can onboard the ~20 higher-tier sellers
// one-by-one without an inquiry flood. CHANGE THIS LIST (e.g. add "basic") when
// ready to widen — do not scatter the tier logic elsewhere. Case-insensitive.
export const PARCEL_MANUAL_TIERS = ["plus", "pro", "master"] as const;

// MANUAL-ENCODE gate (2026-09-10; tier-gated 2026-09-10) — a PLUS/PRO/MASTER,
// ACTIVE seller may open Parcel Scan for MANUAL entry only (no camera, no AI
// scan, no credits). Composes the shared planWindow predicate (isActivePaid:
// time-limited plan + status active + days left > 0) AND the tier allowlist above
// — NOT a new expiry rule. BASIC/free/expired → false (no screen, no nav tile).
// The camera/AI/credits surface stays admin-only via canUseParcelScan; the global
// kill switch (parcel_manual_enabled) gates ON TOP of this in RedesignApp.
export function canUseParcelManual(
  plan: string | undefined | null,
  planStatus: string | undefined | null,
  planExpiry: string | undefined | null,
  nowMs: number = Date.now(),
): boolean {
  // A plan must actually be present: isTimeLimitedPlan treats ANY non-"free"
  // string (including "") as time-limited, so guard the missing/blank case here
  // before delegating the real active+paid+not-expired decision to isActivePaid.
  const tier = String(plan ?? "").trim().toLowerCase();
  if (!tier) return false;
  // Tier allowlist FIRST (basic is active+paid but not yet allowed), then the
  // shared active+not-expired decision (expired plus/pro/master → false).
  if (!PARCEL_MANUAL_TIERS.includes(tier as (typeof PARCEL_MANUAL_TIERS)[number])) return false;
  return isActivePaid({ plan: plan ?? "", planStatus: planStatus ?? "", daysLeft: planDaysLeft(planExpiry, nowMs) });
}

// ── KILL SWITCH (2026-09-10) — global admin toggle for seller manual encode ────
// app_settings 'parcel_manual_enabled'. Lets Jeff open/close seller manual-encode
// access WITHOUT a deploy. Reuses the appSettings adapter (shipping_default_fee
// pattern). ⚠️ FAIL-CLOSED — the OPPOSITE of the shipping fee: only the exact
// string "true" opens it; a missing row / error / RLS deny / any other value →
// false (closed). A read failure must HIDE the feature, never expose it.
export const PARCEL_MANUAL_ENABLED_KEY = "parcel_manual_enabled";

export async function loadParcelManualEnabled(): Promise<boolean> {
  const row = await getAppSetting(PARCEL_MANUAL_ENABLED_KEY);
  return row?.value === "true"; // null/undefined/"false"/"1"/anything-else → false
}
// Admin panel read: state + when it last changed.
export async function loadParcelManualEnabledMeta(): Promise<{ enabled: boolean; updatedAt: string | null }> {
  const row = await getAppSetting(PARCEL_MANUAL_ENABLED_KEY);
  return { enabled: row?.value === "true", updatedAt: row?.updatedAt ?? null };
}
// Admin-only write (RLS is_admin() gates the DB — a non-admin upsert is rejected
// and surfaces here as { ok:false }). Stores the literal "true"/"false".
export async function saveParcelManualEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  return setAppSetting(PARCEL_MANUAL_ENABLED_KEY, enabled ? "true" : "false");
}

// Pure visibility combiner (the RedesignApp gate, unit-tested). Admin sees the
// full surface regardless of the switch; a paying+active seller sees it ONLY
// when the switch is ON (manualEnabled). Everyone else → nothing.
//   visible    = show nav tile + screen
//   manualOnly = allowed but NOT admin → hide camera/AI/credits, manual + "soon"
export function parcelScanVisible(opts: {
  role: string | undefined | null;
  plan: string | undefined | null;
  planStatus: string | undefined | null;
  planExpiry: string | undefined | null;
  manualEnabled: boolean;
  nowMs?: number;
}): { visible: boolean; manualOnly: boolean } {
  const admin = canUseParcelScan(opts.role);
  const manual = opts.manualEnabled && canUseParcelManual(opts.plan, opts.planStatus, opts.planExpiry, opts.nowMs);
  const visible = admin || manual;
  return { visible, manualOnly: visible && !admin };
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
  balance?: number;      // wallet balance the server returns (success / insufficient / charged failure)
  insufficient?: boolean; // HTTP 402 — out of Scan Credits (no scan happened)
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
    const j = await r.json().catch(() => ({} as { success?: boolean; fields?: ScanFields; confidence?: Record<keyof ScanFields, ScanConfidence>; error?: string; balance?: number }));
    const bal = typeof j.balance === "number" ? j.balance : undefined;
    if (r.status === 403) return { ok: false, error: "forbidden" };
    if (r.status === 402) return { ok: false, error: j.error || "insufficient_credits", insufficient: true, balance: bal ?? 0 };
    if (!r.ok || !j.success || !j.fields) return { ok: false, error: j.error || `http_${r.status}`, balance: bal };
    return { ok: true, fields: j.fields, confidence: j.confidence, balance: bal };
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
// the GLOBAL admin shipping fee (app_settings 'shipping_default_fee'), I/J = blank.
export function scanToXlsRow(row: ParcelScanRow, opts: ScanXlsOpts): string[] {
  return [
    row.customerName.trim(),                          // A ＊取件人姓名
    row.phone.trim(),                                 // B ＊取件人手機 (leading 0 kept)
    row.storeId.trim(),                               // C ＊取件門市
    opts.tempLayer ?? SHIP_TEMP_AMBIENT,              // D ＊溫層 = 常溫
    String(opts.storeName || "").trim(),              // E ＊商品 = shop name (e.g. Budgetukay)
    row.amount == null ? "" : String(row.amount),     // F ＊訂單金額
    String(opts.fee),                                 // G ＊運費金額 = global admin shipping fee
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
export async function markScansExported(ids: string[]): Promise<{ ok: boolean; batchId?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (!ids.length) return { ok: true };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  // One fresh batch id per export run → the whole run can be reverted together
  // ("Undo last export"). Stamped alongside status='exported' (own-scoped).
  const batchId = newParcelId();
  const { error } = await supabase.from("parcel_scans").update({ status: "exported", export_batch_id: batchId }).in("id", ids).eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true, batchId };
}

// Undo one export run: revert every row of the batch back to 'confirmed' and
// clear the batch id, so they re-enter the ready list and can be exported
// again. Own-scoped (RLS + explicit user_id). Existing pre-column exported rows
// have export_batch_id = NULL → not covered by any batch undo (by design).
export async function unmarkScansExported(batchId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (!batchId) return { ok: false, error: "no batch" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("parcel_scans").update({ status: "confirmed", export_batch_id: null }).eq("export_batch_id", batchId).eq("user_id", me);
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

// ── Credit balance (read-only; Part 2 wires the UI) ──────────────────────────
// Own-scoped SELECT on parcel_credit_wallet (RLS: user_id = auth.uid() OR admin).
// No wallet row yet → balance 0. Never writes (debits/grants/refunds are the
// SECURITY DEFINER RPCs — the server debits; the admin grant is Part 2 UI).
export async function getCreditBalance(): Promise<{ ok: boolean; balance: number; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, balance: 0, error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, balance: 0, error: "not signed in" };
  const { data, error } = await supabase
    .from("parcel_credit_wallet")
    .select("balance")
    .eq("user_id", me)
    .maybeSingle();
  if (error) return { ok: false, balance: 0, error: error.message };
  return { ok: true, balance: data ? Number((data as { balance: number }).balance) || 0 : 0 };
}

// Admin-only read of ANOTHER user's balance by their auth user id (RLS SELECT is
// own-OR-is_admin, so this only returns for an admin caller). Used by the Admin
// grant UI to show a seller's balance before topping up. No wallet row → 0.
export async function getCreditBalanceForUser(userId: string | null | undefined): Promise<{ ok: boolean; balance: number }> {
  if (!isSupabaseConfigured || !supabase || !userId) return { ok: false, balance: 0 };
  const { data, error } = await supabase
    .from("parcel_credit_wallet")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, balance: 0 };
  return { ok: true, balance: data ? Number((data as { balance: number }).balance) || 0 : 0 };
}

// ── Deletes (own-scoped via RLS; awaited, not fire-and-forget) ────────────────
// Hard delete — the row is gone (parcel_scans_delete RLS = user_id = auth.uid(),
// verified present). The caller AWAITS these and surfaces any error inline; a
// failed delete must never be a silent no-op (the row stays, the caller shows
// the error and does NOT prune it from the list).

// Delete one saved parcel by id.
export async function deleteParcelScan(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (!id) return { ok: false, error: "no id" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("parcel_scans").delete().eq("id", id).eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Edit an existing parcel — own-scoped UPDATE of the editable fields. FREE:
// this never calls /admin/parcel-scan and never debits a credit (editing a
// mis-scanned parcel must not cost a scan). Own-scoped like the delete
// (.eq id + .eq user_id) + the parcel_scans own-scoped RLS update policy.
// Status/created_at are left untouched (no un-export, no re-date).
export async function updateParcelScan(id: string, fields: ScanFields): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  if (!id) return { ok: false, error: "no id" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase
    .from("parcel_scans")
    .update({
      customer_name: fields.name,
      phone: fields.phone,
      store_id: fields.store_id,
      amount: fields.amount,
      notes: fields.notes,
    })
    .eq("id", id)
    .eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Delete every already-exported parcel (status 'exported') for the owner. The
// status filter + the RLS user_id scope mean only the caller's exported rows go.
export async function deleteExportedParcels(): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("parcel_scans").delete().eq("status", "exported").eq("user_id", me);
  return error ? { ok: false, error: error.message } : { ok: true };
}
