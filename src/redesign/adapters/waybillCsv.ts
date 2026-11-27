// WAYBILL USERNAME — the TikTok Shop "Order list" CSV (Seller Center → Orders → Export → CSV).
// Read in the browser only: the file is never uploaded, saved or logged. PURE — unit-tested.
//
// What we need from each order row: Order ID, Tracking ID (fallback match for a waybill page) and
// Buyer Username (TikTok MASKS it: first character, stars, last character — e.g. "m*****3").
// TikTok writes one row per item, so an order with 3 items is 3 rows → kept once (first username wins).
// Columns are found by their HEADER TEXT, in any order; extra columns are ignored.

export interface CsvOrder {
  orderId: string | null;   // digits only (TikTok sometimes puts a tab or ' in front so Excel keeps all digits)
  tracking: string | null;  // upper case, no spaces
  masked: string;           // the masked buyer username as TikTok shows it ("" = none)
}
export type CsvError = "empty" | "no_order_col" | "no_username_col" | "no_rows";
export type CsvResult = { ok: true; orders: CsvOrder[] } | { ok: false; error: CsvError };

// RFC 4180 rows: quoted fields with "" for a quote, commas / line breaks inside quotes, CRLF or LF.
export function parseCsvRows(text: string, delim = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === "\"" && field === "") { quoted = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// The delimiter of the header line (outside quotes): comma, semicolon or tab — whichever appears most.
export function detectDelimiter(text: string): string {
  const firstLine = (() => {
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "\"") q = !q;
      else if (!q && (c === "\n" || c === "\r")) return text.slice(0, i);
    }
    return text;
  })();
  let comma = 0, semi = 0, tab = 0, q = false;
  for (const c of firstLine) {
    if (c === "\"") q = !q;
    else if (!q) { if (c === ",") comma++; else if (c === ";") semi++; else if (c === "\t") tab++; }
  }
  if (tab > comma && tab > semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

const norm = (s: string): string => s.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_]+/g, " ");
const ORDER_HEADERS = ["order id", "orderid", "order no", "order number"];
const TRACKING_HEADERS = ["tracking id", "tracking number", "tracking no", "trackingid"];
const USERNAME_HEADERS = ["buyer username", "buyer user name", "username"];

function findCol(headers: string[], names: string[]): number {
  for (const name of names) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

export const orderIdOf = (raw: string): string | null => {
  const d = String(raw ?? "").replace(/\D+/g, "");
  return d.length >= 10 && d.length <= 24 ? d : null;
};
export const trackingOf = (raw: string): string | null => {
  const t = String(raw ?? "").replace(/[\s'"]+/g, "").toUpperCase();
  return /^[A-Z0-9-]{8,40}$/.test(t) ? t : null;
};

// text = the whole file as text (decoded UTF-8; a byte-order mark is fine).
export function parseOrderCsv(text: string): CsvResult {
  const body = String(text ?? "").replace(/^\uFEFF/, "");
  if (!body.trim()) return { ok: false, error: "empty" };
  const rows = parseCsvRows(body, detectDelimiter(body));
  if (!rows.length) return { ok: false, error: "empty" };
  const headers = rows[0].map(norm);
  const cOrder = findCol(headers, ORDER_HEADERS);
  const cUser = findCol(headers, USERNAME_HEADERS);
  const cTrack = findCol(headers, TRACKING_HEADERS);
  if (cUser < 0) return { ok: false, error: "no_username_col" };
  if (cOrder < 0) return { ok: false, error: "no_order_col" };
  const byKey = new Map<string, CsvOrder>();
  const out: CsvOrder[] = [];
  for (const r of rows.slice(1)) {
    const orderId = orderIdOf(r[cOrder] ?? "");
    const tracking = cTrack >= 0 ? trackingOf(r[cTrack] ?? "") : null;
    if (!orderId && !tracking) continue; // a description row, a total row, an empty row
    const masked = String(r[cUser] ?? "").trim();
    const key = orderId ? `o:${orderId}` : `t:${tracking}`;
    const had = byKey.get(key);
    if (had) {
      if (!had.masked && masked) had.masked = masked;
      if (!had.tracking && tracking) had.tracking = tracking;
      continue;
    }
    const o: CsvOrder = { orderId, tracking, masked };
    byKey.set(key, o);
    out.push(o);
  }
  if (!out.length) return { ok: false, error: "no_rows" };
  return { ok: true, orders: out };
}

// A File → its text (UTF-8). Kept tiny so the screen can test it with a fake File.
export async function readCsvFile(file: Blob): Promise<CsvResult> {
  try {
    const text = await file.text();
    return parseOrderCsv(text);
  } catch {
    return { ok: false, error: "empty" };
  }
}
