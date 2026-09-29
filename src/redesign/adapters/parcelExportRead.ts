// Seller-side 匯出報表 (order-info export) reader — the no-extension path to feed the
// F-code↔handle link into parcel_tracking. The seller downloads 賣貨便's 匯出報表 .xlsx
// and uploads it here; we parse the 訂單匯入 tab client-side (no SheetJS) and upsert
// { tracking_no, buyer_username } under the seller's own JWT (RLS user_id = auth.uid()).
//
// Reuses the proven zip primitives from shippingXlsmPatch (parseZip / readEntryText /
// resolveSheetPath). The extraction logic is a straight port of the owner-only Chrome
// extension reader (chrome-extension/myship-export-711.js) so both paths agree byte-for-
// byte on which columns carry the F-code + handle.
//
// Column contract (verified against a real export):
//   • sheet 訂單匯入 resolved BY NAME (the two tabs have different column orders)
//   • header = ROW 3 (rows 1–2 are a title/date/filter banner); data = rows ≥ 4
//   • 配送單編號 → tracking_no ; 其[他它]資訊 / FB·LINE·IG → buyer_username (VERBATIM,
//     blank → null) ; 商品名稱 (shop-name product column) is EXPLICITLY ignored
//   • NO reliable shop identity exists in the file (row 1 = an order-date filter; the
//     filename is a random per-export token) → a wrong-shop upload is caught by
//     tracking-number COLLISION with another seller instead (sql/62)
//   • the bogus <dimension> (phantom ~1,000 cols) is ignored — real <row> elements only
import { parseZip, readEntryText, resolveSheetPath } from "./shippingXlsmPatch";
import { isSupabaseConfigured, supabase } from "../../supabase";

const IMPORT_SHEET = "訂單匯入";
const HEADER_ROW = 3;
const UPSERT_CHUNK = 500;

export interface ExportHandleRow { tracking_no: string; buyer_username: string | null }

const unesc = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n").replace(/&#13;/g, "\r").replace(/&amp;/g, "&");

// sharedStrings: concat ALL <t> runs within each <si> (a value can be rich text).
function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = "";
    for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += tm[1];
    out.push(unesc(t));
  }
  return out;
}

interface SheetRow { rn: number; cells: Record<string, string> }
function rowsOf(xml: string, S: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rn = +rm[1];
    const cells: Record<string, string> = {};
    for (const cm of rm[2].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is>([\s\S]*?)<\/is>)?<\/c>/g)) {
      const col = cm[1], t = cm[2], v = cm[3], is = cm[4];
      let val = "";
      if (is !== undefined) { for (const tm of is.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) val += tm[1]; val = unesc(val); }
      else if (t === "s" && v !== undefined) val = S[+v] ?? "";
      else if (v !== undefined) val = v;
      cells[col] = val;
    }
    rows.push({ rn, cells });
  }
  return rows;
}

// PURE: the 訂單匯入 sheet XML + sharedStrings XML → { tracking_no, buyer_username } rows.
// Columns are located BY HEADER TEXT on row 3 (positions differ between the two tabs).
export function extractImportHandles(sheetXml: string, sharedStringsXml: string): { rows: ExportHandleRow[]; cols: { fcodeCol?: string; handleCol?: string }; noCode: number } {
  const S = sharedStrings(sharedStringsXml || "");
  const rows = rowsOf(sheetXml, S);
  const header = rows.find((r) => r.rn === HEADER_ROW);
  if (!header) return { rows: [], cols: {}, noCode: 0 };
  let fcodeCol: string | undefined;
  let handleCol: string | undefined;
  for (const [col, txt] of Object.entries(header.cells)) {
    const h = String(txt || "").replace(/\s+/g, "");
    if (!fcodeCol && /配送單編號/.test(h)) fcodeCol = col;
    // handle column: 其他/其它資訊 OR the FB/LINE/IG hint — but NEVER 商品名稱 (the product/shop-name column)
    else if (!handleCol && !/商品名稱/.test(h) && (/其[他它]資訊/.test(h) || /FB\/LINE\/IG/.test(h))) handleCol = col;
  }
  if (!fcodeCol) return { rows: [], cols: {}, noCode: 0 };
  const out: ExportHandleRow[] = [];
  let noCode = 0;
  for (const r of rows) {
    if (r.rn <= HEADER_ROW) continue;
    const tn = String(r.cells[fcodeCol] || "").trim();
    if (!tn) {
      // an order row with no 交貨便 code yet (賣貨便 mints it after shipping) — counted
      // so the seller hears "no tracking numbers yet", never silently dropped
      if (Object.values(r.cells).some((v) => String(v || "").trim())) noCode += 1;
      continue;
    }
    const hv = handleCol ? String(r.cells[handleCol] || "") : "";
    out.push({ tracking_no: tn, buyer_username: hv.trim() ? hv : null }); // VERBATIM; blank → null
  }
  return { rows: out, cols: { fcodeCol, handleCol }, noCode };
}

// S5 — one row per tracking number, keeping the LAST occurrence in the sheet (the
// latest line wins, e.g. a handle added on a later row). Order of first appearance kept.
export function dedupeByTrackingNo(rows: ExportHandleRow[]): ExportHandleRow[] {
  const last = new Map<string, ExportHandleRow>();
  for (const r of rows) last.set(r.tracking_no, r);
  const seen = new Set<string>();
  const out: ExportHandleRow[] = [];
  for (const r of rows) {
    if (seen.has(r.tracking_no)) continue;
    seen.add(r.tracking_no);
    out.push(last.get(r.tracking_no)!);
  }
  return out;
}

// Parse .xlsx bytes → the 訂單匯入 handle rows. Anything that isn't a 賣貨便 匯出報表
// (not a zip, no workbook, no 訂單匯入 tab, no 配送單編號 column) → ok:false "not_export".
export async function parseExportBytes(bytes: Uint8Array): Promise<{ ok: boolean; rows: ExportHandleRow[]; noCode: number; error?: "not_export" }> {
  const bad = { ok: false, rows: [] as ExportHandleRow[], noCode: 0, error: "not_export" as const };
  let entries: ReturnType<typeof parseZip>;
  try { entries = parseZip(bytes); } catch { return bad; }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const wbE = byName.get("xl/workbook.xml");
  const relsE = byName.get("xl/_rels/workbook.xml.rels");
  if (!wbE || !relsE) return bad;
  try {
    const wb = await readEntryText(bytes, wbE);
    const rels = await readEntryText(bytes, relsE);
    let sheetPath: string;
    try { sheetPath = resolveSheetPath(wb, rels, IMPORT_SHEET); } catch { return bad; } // no 訂單匯入 tab
    const sheetE = byName.get(sheetPath);
    if (!sheetE) return bad;
    const sheetXml = await readEntryText(bytes, sheetE);
    const ssE = byName.get("xl/sharedStrings.xml");
    const ssXml = ssE ? await readEntryText(bytes, ssE) : "";
    const ex = extractImportHandles(sheetXml, ssXml);
    if (!ex.cols.fcodeCol) return bad; // no 配送單編號 column → not this report
    return { ok: true, rows: ex.rows, noCode: ex.noCode };
  } catch { return bad; }
}

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

// Each failure cause has its own plain-words message on the screen (S4).
export type SyncError =
  | "signed_out"   // no session / expired token → "Sign in again, then retry"
  | "permission"   // not on the Pickup Status allowlist → "Your plan doesn't include Pickup Status"
  | "partial"      // some chunks saved, then a failure → "Saved N of M parcels — retry to save the rest"
  | "no_codes"     // rows exist but 賣貨便 hasn't minted 交貨便 codes yet
  | "not_export"   // not the 匯出報表 file / wrong columns
  | "empty"        // the 訂單匯入 tab has no order rows at all
  | "foreign"      // S3: codes already belong to another seller → a different shop's file
  | "network";     // anything else (offline, timeout, server hiccup) — never "couldn't read the file"

export interface SyncResult {
  ok: boolean;
  error?: SyncError;
  total: number;          // distinct tracking numbers in the file (after S5 dedupe)
  fresh: number;          // new parcels saved
  updated: number;        // existing parcels whose username changed
  same: number;           // already synced, nothing to change
  withoutHandle: number;  // parcels in the file with no username (kept — S6)
  saved?: number;         // partial: how many were written before the failure
  attempted?: number;     // partial: how many we tried to write
  foreign?: number;       // S3: how many codes belong to another seller
}

// PURE — map a Supabase/PostgREST error to a cause. 42501 = the sql/62 allowlist guard
// (or any permission denial); P0001 foreign_tracking_no = the sql/62 collision backstop;
// JWT/401 codes = the session is gone.
export function classifyDbError(err: { code?: string; message?: string; status?: number } | null | undefined): SyncError {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  if (code === "42501" || msg.includes("not_allowed") || msg.includes("permission denied")) return "permission";
  if (msg.includes("foreign_tracking_no")) return "foreign";
  if (code === "PGRST301" || code === "PGRST302" || err?.status === 401 || msg.includes("jwt")) return "signed_out";
  return "network";
}

// PURE — what to write, given the file's (deduped) rows and the seller's existing rows.
//   • new code with a username    → write it (username)
//   • new code without a username → write the code alone (S6: never dropped)
//   • existing, username changed  → update the username
//   • existing, same username, or the file has no username for it → nothing (never clobbers
//     a handle the extension / an earlier upload already stored)
export function planSync(rows: ExportHandleRow[], existing: Map<string, string | null>) {
  const withHandle: { tracking_no: string; buyer_username: string }[] = [];
  const codeOnly: { tracking_no: string }[] = [];
  let fresh = 0, updated = 0, same = 0, withoutHandle = 0;
  for (const r of rows) {
    const has = r.buyer_username != null && String(r.buyer_username).trim() !== "";
    if (!has) withoutHandle += 1;
    if (!existing.has(r.tracking_no)) {
      fresh += 1;
      if (has) withHandle.push({ tracking_no: r.tracking_no, buyer_username: String(r.buyer_username) });
      else codeOnly.push({ tracking_no: r.tracking_no });
    } else if (has && existing.get(r.tracking_no) !== r.buyer_username) {
      updated += 1;
      withHandle.push({ tracking_no: r.tracking_no, buyer_username: String(r.buyer_username) });
    } else {
      same += 1;
    }
  }
  return { withHandle, codeOnly, fresh, updated, same, withoutHandle };
}

const LOOKUP_CHUNK = 200; // tracking numbers per own-row lookup (URL length)

// Read the export and sync it under the seller's own JWT. Writes ONLY user_id /
// tracking_no / buyer_username — merge on (user_id, tracking_no) — so the poller's
// live-status columns are NEVER clobbered. Order: parse → dedupe (S5) → wrong-shop
// check BEFORE any write (S3) → read what's already stored → write only what changed.
export async function syncFromExport(bytes: Uint8Array): Promise<SyncResult> {
  const zero: SyncResult = { ok: false, total: 0, fresh: 0, updated: 0, same: 0, withoutHandle: 0 };
  if (!isSupabaseConfigured || !supabase) return { ...zero, error: "signed_out" };
  const me = await uid();
  if (!me) return { ...zero, error: "signed_out" };

  const parsed = await parseExportBytes(bytes);
  if (!parsed.ok) return { ...zero, error: "not_export" };
  if (parsed.rows.length === 0) return { ...zero, error: parsed.noCode > 0 ? "no_codes" : "empty" };
  const rows = dedupeByTrackingNo(parsed.rows);
  const codes = rows.map((r) => r.tracking_no);
  const base: SyncResult = { ...zero, total: rows.length };

  try {
    // S3 — any code already under another seller → this is not the seller's shop export.
    const ov = await supabase.rpc("parcel_tracking_foreign_overlap", { p_codes: codes });
    if (ov.error) return { ...base, error: classifyDbError(ov.error) };
    const foreign = Number(ov.data) || 0;
    if (foreign > 0) return { ...base, error: "foreign", foreign };

    // What's already stored for these codes (own rows only — RLS + explicit user_id).
    const existing = new Map<string, string | null>();
    for (const c of chunk(codes, LOOKUP_CHUNK)) {
      const { data, error } = await supabase.from("parcel_tracking").select("tracking_no, buyer_username").eq("user_id", me).in("tracking_no", c);
      if (error) return { ...base, error: classifyDbError(error) };
      for (const r of (data ?? []) as { tracking_no: string; buyer_username: string | null }[]) existing.set(String(r.tracking_no), r.buyer_username ?? null);
    }

    const plan = planSync(rows, existing);
    const counts = { total: rows.length, fresh: plan.fresh, updated: plan.updated, same: plan.same, withoutHandle: plan.withoutHandle };
    const attempted = plan.withHandle.length + plan.codeOnly.length;
    let saved = 0;
    const fail = (error: { code?: string; message?: string; status?: number }): SyncResult => {
      const cause = classifyDbError(error);
      if (saved > 0 && cause !== "signed_out") return { ok: false, ...counts, error: "partial", saved, attempted };
      return { ok: false, ...counts, error: cause };
    };
    for (const c of chunk(plan.withHandle, UPSERT_CHUNK)) {
      const { error } = await supabase.from("parcel_tracking")
        .upsert(c.map((r) => ({ user_id: me, ...r })), { onConflict: "user_id,tracking_no" });
      if (error) return fail(error);
      saved += c.length;
    }
    for (const c of chunk(plan.codeOnly, UPSERT_CHUNK)) {
      const { error } = await supabase.from("parcel_tracking")
        .upsert(c.map((r) => ({ user_id: me, ...r })), { onConflict: "user_id,tracking_no", ignoreDuplicates: true });
      if (error) return fail(error);
      saved += c.length;
    }
    return { ok: true, ...counts, saved };
  } catch {
    return { ...base, error: "network" };
  }
}
