// Printer testers + Admin-approved printers (sql/160). ADD-ONLY next to today's printer flow:
//  • a tester (feature key "printer_tester") may run ONE test sticker on a printer that is not on
//    the list, in a language they pick (TSPL / ESC/POS / CPCL), through the EXISTING generic path
//    (buildGenericStickerBytes → native testGenericPrinter, which saves nothing), then report
//    "clean / not clean" (+ a photo when clean);
//  • Admin reads the reports and approves a clean one in one tap → approved_printers;
//  • every device reads the ACTIVE approved rows once per session → printerModels.setApprovedPrinters
//    (the built-in list stays first and always wins; a failed read = the built-in list only).
import { useEffect } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { btCallOutcome, buildTestBuyerV2, type BluetoothPrinterDevice } from "./printerBridge";
import { buildGenericStickerBytes, buildNativeStickerPayload, onPrinterLane, type Settings } from "./printing";
import { bytesToBase64 } from "./stickerRaster";
import { setApprovedPrinters, WHITELIST, type ApprovedPrinter, type PrinterLang } from "./printerModels";
import { chooseEncoding, decodeUpright } from "./productImages";
import { bridgeBuildNumber } from "./nativeVersion";

export const PRINTER_TEST_BUCKET = "printer-test-photos";
export const PRINTER_TEST_PHOTO_MAX_BYTES = 2 * 1024 * 1024; // = the bucket's file_size_limit (sql/160)
export const TESTER_LANGS: readonly PrinterLang[] = ["tspl", "escpos", "cpcl"];
export const LANG_LABEL: Record<PrinterLang, string> = { tspl: "TSPL", escpos: "ESC/POS", cpcl: "CPCL" };

// ── Approved printers: ONE read per session ─────────────────────────────────────────────────
const isLang = (v: unknown): v is PrinterLang => v === "tspl" || v === "escpos" || v === "cpcl";
// "Shift left (mm)" (sql/161): 0–8 mm; missing / not a number / out of range = 0 (no shift).
export function parseShiftMm(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 8 ? n : 0;
}
export function parseApprovedRows(data: unknown): ApprovedPrinter[] {
  if (!Array.isArray(data)) return [];
  const out: ApprovedPrinter[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || r.active === false) continue;
    const prefix = typeof r.prefix === "string" ? r.prefix.trim() : "";
    if (prefix.length < 2 || !isLang(r.lang)) continue;
    out.push({ prefix, brand: typeof r.brand === "string" && r.brand.trim() ? r.brand.trim() : "Other", model: typeof r.model === "string" ? r.model : prefix, lang: r.lang, shiftMm: parseShiftMm(r.shift_mm), flip: r.flip === true });
  }
  return out;
}
let approvedRead: Promise<ApprovedPrinter[]> | null = null;
export function loadApprovedPrinters(): Promise<ApprovedPrinter[]> {
  if (approvedRead) return approvedRead;
  approvedRead = (async () => {
    if (!isSupabaseConfigured || !supabase) return [];
    try {
      const first = await supabase.from("approved_printers").select("prefix,brand,model,lang,active,shift_mm,flip").eq("active", true);
      if (!first.error) return parseApprovedRows(first.data);
      // sql/161 not applied yet (no shift_mm / flip columns) → the same rows without a shift / flip
      const { data, error } = await supabase.from("approved_printers").select("prefix,brand,model,lang,active").eq("active", true);
      return error ? [] : parseApprovedRows(data);
    } catch { return []; }
  })();
  return approvedRead;
}
export function __resetApprovedPrinters(): void { approvedRead = null; setApprovedPrinters(null); }
// Signed in → read once (cached for the session) → the whitelist knows the approved rows.
export function useApprovedPrinters(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void loadApprovedPrinters().then((rows) => { if (live) setApprovedPrinters(rows); });
    return () => { live = false; };
  }, [signedIn]);
}

// ── Tester side ──────────────────────────────────────────────────────────────────────────────
// The default approved-name prefix (editable before saving): with a "-" in the name, everything up to
// and including the first "-" (CT221B-D4F8 → "CT221B-", B1 Pro-I61 → "B1 Pro-") unless only 1–3 characters come
// before it (XP-365B, GP-1324D → the whole name); without one, the text
// before the first digit, only when that leaves ≥ 4 characters (PRINTER123456 → "PRINTER"); else the whole name.
export function defaultPrefix(name: string | undefined | null): string {
  const n = String(name || "").trim();
  const dash = n.indexOf("-");
  if (dash >= 0) { const before = n.slice(0, dash).trim(); return before.length >= 4 ? `${before}-` : n; } // a 1–3 letter brand ("XP-", "GP-", "MPT-") is too broad → the whole name
  const digit = n.search(/\d/);
  if (digit >= 0) { const p = n.slice(0, digit).trim(); if (p.length >= 4) return p; }
  return n;
}

// The phone's facts about this row — what the scan reports today. The app does not (yet) send the
// advertised services or the write/notify characteristic, so those stay null until it does.
export interface BleFacts { transport: string | null; likely: boolean | null; model: string | null; brand: string | null; paired: boolean | null; signal: number | null; services: string[] | null; write_char: string | null; notify_char: string | null }
export function bleFactsOf(p: BluetoothPrinterDevice): BleFacts {
  const x = p as BluetoothPrinterDevice & { services?: unknown; writeChar?: unknown; notifyChar?: unknown };
  return {
    transport: p.transport ?? null,
    likely: typeof p.likely === "boolean" ? p.likely : null,
    model: p.model ?? null,
    brand: p.brand ?? null,
    paired: typeof p.paired === "boolean" ? p.paired : null,
    signal: typeof p.signal === "number" ? p.signal : null,
    services: Array.isArray(x.services) ? x.services.filter((s): s is string => typeof s === "string").slice(0, 20) : null,
    write_char: typeof x.writeChar === "string" ? x.writeChar : null,
    notify_char: typeof x.notifyChar === "string" ? x.notifyChar : null,
  };
}

// ONE test sticker in `lang` at the chosen sticker size, through the existing generic path. Saves nothing.
export interface TesterSendResult { ok: boolean; code: string }
export async function testPrintInLang(p: BluetoothPrinterDevice, lang: PrinterLang, settings: Settings, cur: string, storeName: string): Promise<TesterSendResult> {
  return onPrinterLane(async () => {
    try {
      const payload = buildNativeStickerPayload(buildTestBuyerV2(), cur || "NT$", storeName || "SellerFlowLive", settings);
      const bytes = await buildGenericStickerBytes(lang, payload);
      const r = await btCallOutcome("testGenericPrinter", { address: p.address, name: p.name, transport: p.transport === "spp" ? "spp" : "ble", data: bytesToBase64(bytes) });
      return { ok: r.ok, code: r.ok ? "" : (r.code || "BT_PRINT_FAILED") };
    } catch { return { ok: false, code: "BUILD_FAILED" }; }
  });
}

// The sticker photo → JPEG ≤ 2 MB (same decoder as product pictures). null = unreadable / too big.
export async function resizeTestPhoto(file: Blob): Promise<Blob | null> {
  const up = await decodeUpright(file);
  if (!up) return null;
  try {
    const long = Math.max(up.w, up.h) || 1;
    const k = Math.min(1, 2000 / long);
    const w = Math.max(1, Math.round(up.w * k)), h = Math.max(1, Math.round(up.h * k));
    const picked = chooseEncoding((scale, quality) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
      up.draw(ctx, c.width, c.height);
      const m = /^data:image\/jpeg;base64,(.*)$/.exec(c.toDataURL("image/jpeg", quality) || "");
      if (!m) return null;
      const bin = atob(m[1]); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: "image/jpeg" });
    }, PRINTER_TEST_PHOTO_MAX_BYTES - 64 * 1024, PRINTER_TEST_PHOTO_MAX_BYTES);
    return picked;
  } finally { up.done(); }
}

export interface PrinterTestReportInput {
  printer: BluetoothPrinterDevice; lang: PrinterLang; stickerSize: string;
  send: TesterSendResult; clean: boolean; photo: Blob | null;
  tuningVersion?: number | null; // Printer setup help (sql/230): the seller's tuning version the test sticker printed with
}
export type SubmitResult = { ok: true } | { ok: false; reason: "photo_required" | "no_session" | "upload_failed" | "save_failed" };
// Photo first (own folder in the private bucket), then the row. A clean report without a photo is refused here AND by the table.
export async function submitPrinterTestReport(r: PrinterTestReportInput): Promise<SubmitResult> {
  if (r.clean && !r.photo) return { ok: false, reason: "photo_required" };
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: "no_session" };
  let uid: string | null = null; let email = "";
  try { const u = (await supabase.auth.getSession()).data.session?.user; uid = u?.id ?? null; email = u?.email ?? ""; } catch { /* no session */ }
  if (!uid) return { ok: false, reason: "no_session" };
  let photoPath: string | null = null;
  if (r.photo) {
    const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    try {
      const up = await supabase.storage.from(PRINTER_TEST_BUCKET).upload(path, r.photo, { contentType: "image/jpeg", upsert: false });
      if (up.error) return { ok: false, reason: "upload_failed" };
    } catch { return { ok: false, reason: "upload_failed" }; }
    photoPath = path;
  }
  try {
    const { error } = await supabase.from("printer_test_reports").insert({
      user_id: uid, email, printer_name: String(r.printer.name || "").slice(0, 120),
      // a Printer setup help report (tuningVersion present) also says the app build, when the app tells it
      ble_facts: "tuningVersion" in r ? { ...bleFactsOf(r.printer), app_build: bridgeBuildNumber() } : bleFactsOf(r.printer),
      lang: r.lang, sticker_size: String(r.stickerSize || "").slice(0, 40), send_ok: r.send.ok, send_code: r.send.code.slice(0, 60) || null,
      clean: r.clean, photo_path: photoPath,
      ...(typeof r.tuningVersion === "number" && Number.isInteger(r.tuningVersion) && r.tuningVersion >= 1 ? { tuning_version: r.tuningVersion } : {}),
    });
    return error ? { ok: false, reason: "save_failed" } : { ok: true };
  } catch { return { ok: false, reason: "save_failed" }; }
}

// ── Admin side (every RPC checks is_admin() inside — sql/160) ────────────────────────────────
export interface TesterRow { email: string; created_at: string }
export interface ReportRow { id: string; email: string; printer_name: string; lang: PrinterLang; sticker_size: string; send_ok: boolean; send_code: string | null; clean: boolean; photo_path: string | null; created_at: string; ble_facts: unknown }
// locked (sql/229): "Locked — working" — the database refuses any change / removal of the row.
export interface ApprovedRow extends ApprovedPrinter { id: string; active: boolean; approved_at: string; shift_mm?: number | string | null; flip?: boolean | null; locked?: boolean | null }
// `code` = the database's refusal word when it is one we show ("prefix_overlaps_locked" / "printer_locked").
export type AdminRpcCode = "prefix_overlaps_locked" | "printer_locked";
const KNOWN_CODES: readonly AdminRpcCode[] = ["prefix_overlaps_locked", "printer_locked"];
export function adminRpcCode(message: unknown): AdminRpcCode | undefined {
  const m = typeof message === "string" ? message : "";
  return KNOWN_CODES.find((c) => m.includes(c));
}
const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<{ ok: boolean; data: T | null; code?: AdminRpcCode }> => {
  if (!isSupabaseConfigured || !supabase) return { ok: false, data: null };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (!error) return { ok: true, data: data as T };
    const code = adminRpcCode((error as { message?: unknown }).message);
    return code ? { ok: false, data: null, code } : { ok: false, data: null };
  } catch { return { ok: false, data: null }; }
};
export const adminListTesters = () => rpc<TesterRow[]>("admin_printer_testers");
export const adminAddTester = (email: string) => rpc<boolean>("admin_printer_tester_add", { p_email: email.trim().toLowerCase() });
export const adminRemoveTester = (email: string) => rpc<boolean>("admin_printer_tester_remove", { p_email: email });
export const adminListReports = () => rpc<ReportRow[]>("admin_printer_test_reports");
export const adminListApproved = () => rpc<ApprovedRow[]>("admin_approved_printers");
export const adminApprovePrinter = (a: { reportId: string; prefix: string; brand: string; model: string; lang: PrinterLang }) =>
  rpc<string>("admin_approve_printer", { p_report: a.reportId, p_prefix: a.prefix.trim(), p_brand: a.brand.trim() || "Other", p_model: a.model.trim(), p_lang: a.lang });
export const adminSetApprovedActive = (id: string, active: boolean) => rpc<boolean>("admin_set_approved_printer_active", { p_id: id, p_active: active });
export const adminSetApprovedLayout = (id: string, shiftMm: number, flip: boolean) => rpc<boolean>("admin_set_approved_printer_layout", { p_id: id, p_shift: shiftMm, p_flip: flip });
// The 5 built-in printers shown read-only on Admin → Printer list (names from printerModels.ts WHITELIST).
export const BUILT_IN_SHOWN: readonly { brand: string; model: string }[] = ["D520BT", "Y41BT", "XP-420B", "B1", "B1 Pro"]
  .map((m) => WHITELIST.find((w) => w.model === m)!).map((w) => ({ brand: w.brand, model: w.model }));
// "Lock — working na" (sql/229): admin only; there is no unlock from the app.
export const adminLockApproved = (id: string) => rpc<boolean>("admin_lock_approved_printer", { p_id: id });
export async function adminPhotoUrl(path: string): Promise<string | null> {
  if (!path || !isSupabaseConfigured || !supabase) return null;
  try { const { data, error } = await supabase.storage.from(PRINTER_TEST_BUCKET).createSignedUrl(path, 600); return error ? null : data?.signedUrl ?? null; } catch { return null; }
}

// The approve / Add back refusal (sql/229 prefix_overlaps_locked): when the new name STARTS WITH a locked
// approved printer's name or a built-in printer's name, that printer already covers it (its settings print
// this one) → that printer's name, longest match first. null = the names only overlap the other way round.
export function coveringPrinter(prefix: string, approved: readonly ApprovedRow[] | null, exceptId?: string): string | null {
  const p = String(prefix || "").trim().toUpperCase();
  if (!p) return null;
  const taken: { k: string; name: string }[] = [
    ...(approved || []).filter((a) => a.active && a.locked === true && a.id !== exceptId).map((a) => ({ k: String(a.prefix).trim().toUpperCase(), name: [a.brand, a.model].filter(Boolean).join(" ") || a.prefix })),
    ...WHITELIST.map((w) => ({ k: w.prefix.toUpperCase(), name: `${w.brand} ${w.model}` })),
  ].filter((x) => x.k);
  const hit = taken.filter((x) => p.startsWith(x.k)).sort((a, b) => b.k.length - a.k.length)[0];
  return hit ? hit.name : null;
}
