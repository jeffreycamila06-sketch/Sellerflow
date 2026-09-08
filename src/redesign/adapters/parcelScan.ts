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
export interface ParcelScanRow {
  id: string;
  customerName: string;
  phone: string;
  storeId: string;
  amount: number | null;
  notes: string;
  status: string;
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
import { validateRecipientName, validPhone, validStore, SHIP_MIN_TOTAL, SHIP_MAX_TOTAL } from "./shipping";

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
    .select("id, customer_name, phone, store_id, amount, notes, status, created_at")
    .eq("user_id", me)
    .order("created_at", { ascending: false })
    .limit(SCANS_PAGE);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => rowToScan(r as Record<string, unknown>)) };
}

// One INSERT per confirmed parcel — status 'confirmed', the model's raw
// fields+confidence kept in raw_extraction for later accuracy tuning.
export async function saveParcelScan(
  fields: ScanFields,
  rawExtraction: { fields: ScanFields; confidence?: Record<keyof ScanFields, ScanConfidence> } | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("parcel_scans").insert({
    user_id: me,
    customer_name: fields.name,
    phone: fields.phone,
    store_id: fields.store_id,
    amount: fields.amount,
    notes: fields.notes,
    status: "confirmed",
    raw_extraction: rawExtraction,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
