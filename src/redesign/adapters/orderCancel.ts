// CANCEL ORDER (sql/234) — Orders tab only (Jeff, 2026-11-28).
//
// The order keeps its row and its buyer number; a cancelled order is MARKED (cancelled_at, on its
// live_session_orders row and its ledger row) and left out of everything that counts or sends:
// Sales, the Orders totals, the buyer card, Send to TikTok, Invoicing, the Messenger receipt, the Live
// board totals. Buyer numbering still counts it (the next new buyer never re-uses its number, and the
// same buyer ordering again keeps the number). Only orders made with a tag (order_ref) can be cancelled.
//
// What lives here:
//   • visibleSession(full)  PURE — the session without cancelled orders (same object when none)
//   • cancel / undo / check  — one database call each (own rows only, one transaction)
//   • the optional-column helpers the loaders use so the app keeps working before sql/234 is applied
import { isSupabaseConfigured, supabase } from "../../supabase";
import type { RebuiltSession } from "../../lib/orderLogic";
import type { Buyer } from "../../lib/orderTypes";
import { log } from "../../lib/log";

/** The session as every reader sees it: cancelled orders taken out, buyer totals recomputed, a buyer
 *  whose orders are all cancelled left out. Returns `full` itself when nothing is cancelled (no extra
 *  render, byte-identical to before). PURE. */
export function visibleSession(full: RebuiltSession): RebuiltSession {
  if (!full.orders.some((o) => o.cancelled)) return full;
  const orders = full.orders.filter((o) => !o.cancelled);
  const buyers: Buyer[] = [];
  for (const b of full.buyers) {
    const kept = b.orders.filter((o) => !o.cancelled);
    if (!kept.length) continue;
    buyers.push(kept.length === b.orders.length ? b : { ...b, orders: kept, totalOrders: kept.length, totalSpent: kept.reduce((s, o) => s + (o.total || 0), 0) });
  }
  return { buyers, orders };
}

/** Mark / unmark one order (by its tag) in a full session. PURE — new objects only where it changed. */
export function markCancelled(full: RebuiltSession, ref: string, cancelled: boolean): RebuiltSession {
  let hit = false;
  const flip = <T extends { ref?: string; cancelled?: boolean }>(o: T): T => {
    if (o.ref !== ref || !!o.cancelled === cancelled) return o;
    hit = true;
    const next = { ...o };
    if (cancelled) next.cancelled = true; else delete next.cancelled;
    return next;
  };
  const orders = full.orders.map(flip);
  if (!hit) return full;
  const buyers = full.buyers.map((b) => (b.orders.some((o) => o.ref === ref) ? { ...b, orders: b.orders.map(flip) } : b));
  return { buyers, orders };
}

// ── optional columns (sql/234) ──────────────────────────────────────────────────────────────────────
// The loaders ask for order_ref + cancelled_at. Before sql/234 is applied those columns do not exist
// and Postgres refuses the whole read (42703) / PostgREST refuses an insert (PGRST204): the caller then
// repeats the SAME request without them, and remembers it for the rest of the app's life.
export const CANCEL_COLS = "order_ref,cancelled_at";
let colsMissing = false;
export const cancelColsMissing = (): boolean => colsMissing;
export function noteCancelColsMissing(): void { colsMissing = true; }
/** Test-only. */
export function __resetCancelCols(): void { colsMissing = false; }
/** A refusal that means "this column does not exist (yet)". */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "");
  if (!/order_ref|cancelled_at/.test(msg)) return false;
  return code === "42703" || code === "PGRST204" || /does not exist|could not find/i.test(msg);
}

/** A fresh tag for one order tap. */
export function newOrderRef(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through */ }
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${h().slice(1)}-${h()}${h()}${h()}`;
}

// ── who sees the button (one rule) ──────────────────────────────────────────────────────────────────
export const orderCancelVisible = (o: { isAdmin: boolean; previewKey: boolean; switchOn: boolean }): boolean =>
  !!(o.isAdmin || o.previewKey || o.switchOn);

// ── database calls ──────────────────────────────────────────────────────────────────────────────────
export type CancelResult = "cancelled" | "already" | "not_found" | "not_allowed" | "error";
export type UndoResult = "restored" | "not_cancelled" | "not_found" | "not_allowed" | "error";
export interface CancelCheck { result: "ok" | "cancelled" | "not_found" | "not_allowed" | "error"; sent: boolean }

async function rpc(fn: string, ref: string): Promise<Record<string, unknown> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc(fn, { p_ref: ref });
    if (error) { log.error(`${fn} error:`, error.message); return null; }
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch (e) {
    log.error(`${fn} error:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function checkOrderCancel(ref: string): Promise<CancelCheck> {
  const d = await rpc("order_cancel_check", ref);
  const r = String(d?.result ?? "");
  return { result: (["ok", "cancelled", "not_found", "not_allowed"].includes(r) ? r : "error") as CancelCheck["result"], sent: d?.sent === true };
}
export async function cancelOrder(ref: string): Promise<CancelResult> {
  const r = String((await rpc("cancel_order", ref))?.result ?? "");
  return (["cancelled", "already", "not_found", "not_allowed"].includes(r) ? r : "error") as CancelResult;
}
export async function undoCancelOrder(ref: string): Promise<UndoResult> {
  const r = String((await rpc("uncancel_order", ref))?.result ?? "");
  return (["restored", "not_cancelled", "not_found", "not_allowed"].includes(r) ? r : "error") as UndoResult;
}

/** Run a live_session_orders select with ",order_ref,cancelled_at" added; before sql/234 (columns
 *  missing) the same select again without them, and every later select skips them at once. */
export async function withCancelCols<R extends { error: { message: string } | null }>(base: string, run: (cols: string) => PromiseLike<R>): Promise<R> {
  if (cancelColsMissing()) return run(base);
  const res = await run(`${base},${CANCEL_COLS}`);
  if (res.error && isMissingColumnError(res.error)) { noteCancelColsMissing(); return run(base); }
  return res;
}

/** Rows that are not cancelled (a row without the column = not cancelled). */
export function keepNotCancelled<T>(rows: T[]): T[] {
  return rows.filter((r) => !(r as { cancelled_at?: string | null }).cancelled_at);
}
