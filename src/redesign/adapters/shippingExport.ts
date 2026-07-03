// 7-11 shipping export (P2) — plan quotas, 賣貨便 row mapping (cols A–J), the
// export RPC call, and the .xlsm delivery seam. The QUOTA IS ENFORCED SERVER-SIDE
// (sql/10 check_and_export_shipping — atomic, per-user advisory lock, 30-day
// SLIDING window); everything here is display/UX or post-RPC file generation.
// The client builds the .xlsm ONLY AFTER the RPC succeeds (spec ordering).
import { isSupabaseConfigured, supabase } from "../../supabase";
import type { ShippingEntry } from "./shipping";

// ── Plan quotas (display mirror of the RPC's CASE — server is authoritative) ──
export function quotaForPlan(plan: string | undefined | null): number | null {
  switch ((plan || "free").toLowerCase()) {
    case "master": return null; // unlimited
    case "pro": return 500;
    case "basic": return 200;
    default: return 50;
  }
}

// ── 賣貨便 row (cols A–J) — ALL values as strings (required cols are Text @) ──
// H 買家下訂日期 = the session's start day, template's slashed format (2026/7/3).
export function orderDateFromSessionKey(sessionKey: string): string {
  const day = sessionKey.split("~")[0]; // "2026-07-02~3d" → "2026-07-02"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : "";
}
export function entryToXlsRow(e: ShippingEntry): string[] {
  return [
    e.recipientName.trim(),                 // A ＊取件人姓名
    e.phone.trim(),                         // B ＊取件人手機 (string, keeps the leading 0)
    e.storeId.trim(),                       // C ＊取件門市
    e.tempLayer,                            // D ＊溫層
    e.productDesc.trim(),                   // E ＊商品
    String(e.orderAmount),                  // F ＊訂單金額 (number as string)
    String(e.shippingFee),                  // G ＊運費金額 (number as string)
    orderDateFromSessionKey(e.sessionKey),  // H 買家下訂日期 (optional)
    "",                                     // I 商品備註 (optional)
    e.buyerUsername.trim(),                 // J 其他資訊 (FB/LINE/IG帳號) — the username lives HERE
  ];
}

// sellerflow_711_YYYYMMDD_HHmm.xlsm — Taipei clock, matches the seller's day.
export function exportFilename(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `sellerflow_711_${get("year")}${get("month")}${get("day")}_${get("hour")}${get("minute")}.xlsm`;
}

// ── Export RPC (server-side quota + atomic exported stamping) ─────────────────
export interface ExportRpcResult { ok: boolean; error?: string; batchId?: string; count?: number; used?: number; quota?: number | null; selected?: number }
export async function callExportRpc(entryIds: string[]): Promise<ExportRpcResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: "not configured" };
  const { data, error } = await supabase.rpc("check_and_export_shipping", { entry_ids: entryIds });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: !!r.ok,
    error: r.error ? String(r.error) : undefined,
    batchId: r.batch_id ? String(r.batch_id) : undefined,
    count: r.count != null ? Number(r.count) : undefined,
    used: r.used != null ? Number(r.used) : undefined,
    quota: r.quota == null ? null : Number(r.quota),
    selected: r.selected != null ? Number(r.selected) : undefined,
  };
}

// Usage meter — ONE count read per Shipping-screen open (read-on-load; the RPC
// result refreshes it after an export). head:true = count only, zero row egress.
export async function loadExportedCount(): Promise<number> {
  if (!isSupabaseConfigured || !supabase) return 0;
  const { data: sess } = await supabase.auth.getSession(); // local, no network
  const uid = sess.session?.user?.id;
  if (!uid) return 0;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("shipping_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .eq("status", "exported")
    .gte("exported_at", since);
  return error || count == null ? 0 : count;
}

// ── File delivery — native (Capacitor Filesystem+Share, future APK) or browser
// download. The current APK shell has NO Filesystem/Share plugins (printer
// plugin only) — feature-detected so the JS is ready the moment the P4 APK
// adds them; until then the browser path serves web/desktop.
type CapPluginHost = { Plugins?: { Filesystem?: { writeFile: (o: { path: string; data: string; directory: string }) => Promise<{ uri: string }> }; Share?: { share: (o: { title: string; url: string }) => Promise<unknown> } } };
export function hasNativeFileShare(): boolean {
  const cap = (typeof window !== "undefined" ? (window as { Capacitor?: CapPluginHost }).Capacitor : undefined);
  return !!(cap?.Plugins?.Filesystem && cap?.Plugins?.Share);
}
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export async function deliverXlsm(bytes: Uint8Array, filename: string): Promise<{ ok: boolean; via: "native" | "browser"; error?: string }> {
  if (hasNativeFileShare()) {
    try {
      const cap = (window as unknown as { Capacitor: CapPluginHost }).Capacitor;
      const w = await cap.Plugins!.Filesystem!.writeFile({ path: filename, data: toBase64(bytes), directory: "CACHE" });
      await cap.Plugins!.Share!.share({ title: filename, url: w.uri });
      return { ok: true, via: "native" };
    } catch (e) {
      return { ok: false, via: "native", error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (typeof document === "undefined") return { ok: false, via: "browser", error: "no document" };
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.ms-excel.sheet.macroEnabled.12" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { ok: true, via: "browser" };
}

// ── .xlsm build — RAW ZIP PATCH of the bundled 賣貨便 template (P4 fallback:
// the SheetJS full-rebuild ballooned 36KB → 73KB and 賣貨便 rejected it with
// "Failed to read Excel file"). shippingXlsmPatch keeps every zip entry's
// compressed bytes VERBATIM (VBA, styles, sharedStrings, 填寫說明, …) and only
// splices our rows into the 訂單匯入 sheet XML at row 7+ (inlineStr cells,
// dimension updated). Same interface as before; unit-tested against the REAL
// bundled template. The next 賣貨便 dummy upload re-runs the P4 gate.
export const SHIP_TEMPLATE_URL = "/templates/myship-import-template.xlsm";
export const SHIP_DATA_SHEET = "訂單匯入";

export async function fetchShipTemplate(): Promise<ArrayBuffer> {
  const r = await fetch(SHIP_TEMPLATE_URL);
  if (!r.ok) throw new Error(`template fetch failed (${r.status})`);
  return r.arrayBuffer();
}

// Pure given bytes+rows (unit-tested against the REAL bundled template).
export async function buildXlsmFromTemplate(templateBytes: ArrayBuffer | Uint8Array, rows: string[][]): Promise<Uint8Array> {
  const bytes = templateBytes instanceof Uint8Array ? templateBytes : new Uint8Array(templateBytes);
  const { patchXlsmTemplate } = await import("./shippingXlsmPatch");
  return patchXlsmTemplate(bytes, rows);
}
