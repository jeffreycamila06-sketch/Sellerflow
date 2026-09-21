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
export function extractImportHandles(sheetXml: string, sharedStringsXml: string): { rows: ExportHandleRow[]; cols: { fcodeCol?: string; handleCol?: string } } {
  const S = sharedStrings(sharedStringsXml || "");
  const rows = rowsOf(sheetXml, S);
  const header = rows.find((r) => r.rn === HEADER_ROW);
  if (!header) return { rows: [], cols: {} };
  let fcodeCol: string | undefined;
  let handleCol: string | undefined;
  for (const [col, txt] of Object.entries(header.cells)) {
    const h = String(txt || "").replace(/\s+/g, "");
    if (!fcodeCol && /配送單編號/.test(h)) fcodeCol = col;
    // handle column: 其他/其它資訊 OR the FB/LINE/IG hint — but NEVER 商品名稱 (the product/shop-name column)
    else if (!handleCol && !/商品名稱/.test(h) && (/其[他它]資訊/.test(h) || /FB\/LINE\/IG/.test(h))) handleCol = col;
  }
  if (!fcodeCol) return { rows: [], cols: {} };
  const out: ExportHandleRow[] = [];
  for (const r of rows) {
    if (r.rn <= HEADER_ROW) continue;
    const tn = String(r.cells[fcodeCol] || "").trim();
    if (!tn) continue; // no F-code → skip (never garbage)
    const hv = handleCol ? String(r.cells[handleCol] || "") : "";
    out.push({ tracking_no: tn, buyer_username: hv.trim() ? hv : null }); // VERBATIM; blank → null
  }
  return { rows: out, cols: { fcodeCol, handleCol } };
}

// Parse .xlsx bytes → the 訂單匯入 handle rows. A non-zip / non-xlsx file → ok:false.
// A valid file whose 訂單匯入 tab has no data → ok:true with rows:[].
export async function parseExportBytes(bytes: Uint8Array): Promise<{ ok: boolean; rows: ExportHandleRow[]; error?: string }> {
  let entries;
  try { entries = parseZip(bytes); } catch { return { ok: false, rows: [], error: "not_xlsx" }; }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const wbE = byName.get("xl/workbook.xml");
  const relsE = byName.get("xl/_rels/workbook.xml.rels");
  if (!wbE || !relsE) return { ok: false, rows: [], error: "not_xlsx" };
  try {
    const wb = await readEntryText(bytes, wbE);
    const rels = await readEntryText(bytes, relsE);
    let sheetPath: string;
    try { sheetPath = resolveSheetPath(wb, rels, IMPORT_SHEET); }
    catch { return { ok: true, rows: [] }; } // no 訂單匯入 tab → nothing to sync (not an error)
    const sheetE = byName.get(sheetPath);
    if (!sheetE) return { ok: true, rows: [] };
    const sheetXml = await readEntryText(bytes, sheetE);
    const ssE = byName.get("xl/sharedStrings.xml");
    const ssXml = ssE ? await readEntryText(bytes, ssE) : "";
    return { ok: true, rows: extractImportHandles(sheetXml, ssXml).rows };
  } catch { return { ok: false, rows: [], error: "parse_failed" }; }
}

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

export interface SyncResult { ok: boolean; synced: number; totalRows: number; without: number; empty?: boolean; error?: string }

// Read the export + upsert the handle link under the seller's own JWT. Writes ONLY
// { user_id, tracking_no, buyer_username } — merge on (user_id, tracking_no) — so the
// poller's live-status columns (status/pickup_deadline/rec_store/order_amount/…) are
// NEVER clobbered. Handle-less rows are dropped (the F-code alone is the poller's job).
export async function syncFromExport(bytes: Uint8Array): Promise<SyncResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, synced: 0, totalRows: 0, without: 0, error: "not_configured" };
  const me = await uid();
  if (!me) return { ok: false, synced: 0, totalRows: 0, without: 0, error: "not_signed_in" };
  const parsed = await parseExportBytes(bytes);
  if (!parsed.ok) return { ok: false, synced: 0, totalRows: 0, without: 0, error: parsed.error || "parse_failed" };
  const totalRows = parsed.rows.length;
  if (totalRows === 0) return { ok: true, synced: 0, totalRows: 0, without: 0, empty: true };
  const withHandle = parsed.rows.filter((r) => r.buyer_username != null && String(r.buyer_username).trim() !== "");
  const without = totalRows - withHandle.length;
  const payload = withHandle.map((r) => ({ user_id: me, tracking_no: String(r.tracking_no), buyer_username: String(r.buyer_username) }));
  let synced = 0;
  for (const c of chunk(payload, UPSERT_CHUNK)) {
    const { error } = await supabase.from("parcel_tracking").upsert(c, { onConflict: "user_id,tracking_no" });
    if (error) return { ok: false, synced, totalRows, without, error: error.message };
    synced += c.length;
  }
  return { ok: true, synced, totalRows, without };
}
