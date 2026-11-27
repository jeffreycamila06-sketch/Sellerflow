// WAYBILL USERNAME — one row per waybill page: which order it is, what TikTok shows, and what goes
// on the waybill. PURE — unit-tested. (The page facts come from waybillPdf.scanWaybills; this module
// only uses their plain shape, so it never pulls pdf-lib into the main bundle.)
import type { CsvOrder } from "./waybillCsv";
import { candidatesFor, type Candidate } from "./waybillMatch";

export interface PageFacts {
  index: number;
  orderId: string | null;
  words: string[];
  slot: { ok: true } | { ok: false; reason: string };
}

const slotReason = (p: PageFacts): string | null => ("reason" in p.slot ? p.slot.reason : null);

export type BaseStatus = "auto" | "pick" | "no_room" | "not_in_list" | "unreadable";
export interface BaseRow {
  index: number;
  orderId: string | null;
  tracking: string | null;
  masked: string;               // as TikTok shows it ("" when the page is not in the order list)
  cands: Candidate[];           // the buyers that fit the mask (sorted: today first, latest first)
  status: BaseStatus;
  handle: string | null;        // the auto-filled username ("auto" only)
}

export function buildRows(pages: PageFacts[], orders: CsvOrder[], cands: Candidate[]): BaseRow[] {
  const byOrder = new Map<string, CsvOrder>();
  const byTracking = new Map<string, CsvOrder>();
  for (const o of orders) {
    if (o.orderId && !byOrder.has(o.orderId)) byOrder.set(o.orderId, o);
    if (o.tracking && !byTracking.has(o.tracking)) byTracking.set(o.tracking, o);
  }
  return pages.map((p) => {
    const order = (p.orderId ? byOrder.get(p.orderId) : undefined) ?? p.words.map((w) => byTracking.get(w)).find(Boolean);
    const base = { index: p.index, orderId: order?.orderId ?? p.orderId, tracking: order?.tracking ?? null, cands: [] as Candidate[], handle: null };
    if (!order) {
      const unreadable = slotReason(p) === "unreadable" && !p.orderId;
      return { ...base, masked: "", status: unreadable ? "unreadable" : "not_in_list" };
    }
    if (!p.slot.ok) return { ...base, masked: order.masked, status: "no_room" };
    const fit = order.masked ? candidatesFor(order.masked, cands) : [];
    if (fit.length === 1) return { ...base, masked: order.masked, cands: fit, status: "auto", handle: fit[0].handle };
    return { ...base, masked: order.masked, cands: fit, status: "pick" };
  });
}

// The seller's choice for a page: a username, or null = leave it blank.
export type Choice = { handle: string | null };
export type RowKind = "stamp" | "pick" | "blank" | "no_room" | "cant_place" | "not_in_list" | "unreadable";
export interface ShownRow extends BaseRow { kind: RowKind; final: string | null; picked: boolean }

// canPlace(index, handle) = the username fits the free space of that page (waybillPdf.placeOn).
export function showRow(row: BaseRow, choice: Choice | undefined, canPlace: (index: number, handle: string) => boolean): ShownRow {
  if (row.status === "not_in_list" || row.status === "unreadable" || row.status === "no_room") return { ...row, kind: row.status, final: null, picked: false };
  const handle = choice ? choice.handle : row.handle;
  const picked = !!choice;
  if (choice && choice.handle === null) return { ...row, kind: "blank", final: null, picked };
  if (!handle) return { ...row, kind: "pick", final: null, picked };
  if (!canPlace(row.index, handle)) return { ...row, kind: "cant_place", final: null, picked };
  return { ...row, kind: "stamp", final: handle, picked };
}

export function counts(rows: ShownRow[]): { all: number; added: number; needs: number } {
  return { all: rows.length, added: rows.filter((r) => r.kind === "stamp").length, needs: rows.filter((r) => r.kind === "pick").length };
}

// What gets written: page index → username, for the "stamp" rows only.
export function stampsOf(rows: ShownRow[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of rows) if (r.kind === "stamp" && r.final) m.set(r.index, r.final);
  return m;
}

// "…4823": the last 4 digits of the order id (or of the tracking number).
export const tailOf = (row: BaseRow): string | null => {
  const s = row.orderId || row.tracking || "";
  return s ? s.slice(-4) : null;
};
