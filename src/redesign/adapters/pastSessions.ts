// Past sessions in Orders (Send to TikTok testers: admin OR "tiktok_send", switch on).
// READ-ONLY and SEPARATE STATE: these rows never reach liveSession, buyer numbering, Auto
// Mode, Sales or shipping. They feed only the Orders screen's past-session view: the order
// list, the buyer-# card + Send, Export, and Reprint (which prints the STORED row, found by its
// own id — RedesignApp's zero-write performReprint).
// Loaded lazily: the session list (one small RPC, my_session_summaries — sql/128) EACH time the
// picker opens, one session's rows when picked. The RPC filters on auth.uid() and the session
// read is RLS + user_id scoped, so every read is the signed-in seller's own rows.
import { useCallback, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { addDays } from "./useSessionWindow";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../lib/orderLogic";
import { liveOrdersToRedesign } from "./useReadData";
import type { Order } from "../data";
import type { Buyer } from "../../lib/orderTypes";
import { loadLiveSessionBySessionId } from "./useSessionWindow";
import { log } from "../../lib/log";

export interface SessionSummary {
  id: string;
  first: string;   // first session_date (YYYY-MM-DD)
  last: string;    // last session_date
  days: number;    // last − first + 1 (calendar span)
  orders: number;
  latest: string;  // latest created_at (sort key)
  current: boolean;
}
export interface IndexRow { session_id: string | null; session_date: string | null; created_at: string | null }

const DAY_MS = 86_400_000;
const spanDays = (a: string, b: string): number => {
  const d = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(d) && d >= 0 ? d + 1 : 1;
};
/** The day the retention v2 purge (sql/127) went live. Before it, days older than 10 were
 *  deleted whatever the session — so a session that started more than 10 days before this
 *  date may be missing its first days. */
export const RETENTION_V2_SINCE = "2026-10-14";
/** True when a session may be incomplete (its first day is before RETENTION_V2_SINCE − 10). */
export const mayBeIncomplete = (s: Pick<SessionSummary, "first">): boolean => !!s.first && s.first < addDays(RETENTION_V2_SINCE, -10);

/** A past order's own Taipei date + time from its order instant: "10/08 · 2:41 AM". */
export function pastOrderStamp(orderNum: number | undefined): string {
  if (orderNum == null || !Number.isFinite(orderNum)) return "";
  const d = new Date(orderNum);
  try {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "numeric", minute: "2-digit" }).format(d);
    return `${md(day)} · ${time}`;
  } catch { return ""; }
}

/** "10/10" from "2026-10-10". */
export const md = (day: string): string => (day && day.length >= 10 ? day.slice(5, 10).replace("-", "/") : day);
/** "10/10 → 10/14", or "10/14" for a one-day session. */
export const sessionRange = (s: Pick<SessionSummary, "first" | "last">): string => (s.first === s.last ? md(s.first) : `${md(s.first)} → ${md(s.last)}`);

/** Rows → one summary per session_id, newest activity first. PURE. (The app now gets the
 *  summaries from the database — my_session_summaries(); this stays as the test reference.) */
export function buildSessionIndex(rows: IndexRow[], currentId: string | null): SessionSummary[] {
  const by = new Map<string, SessionSummary>();
  for (const r of rows) {
    if (!r.session_id || !r.session_date) continue;
    const day = r.session_date.slice(0, 10);
    const at = r.created_at || "";
    const s = by.get(r.session_id);
    if (!s) { by.set(r.session_id, { id: r.session_id, first: day, last: day, days: 1, orders: 1, latest: at, current: r.session_id === currentId }); continue; }
    if (day < s.first) s.first = day;
    if (day > s.last) s.last = day;
    if (at > s.latest) s.latest = at;
    s.orders += 1;
  }
  const out = [...by.values()].map((s) => ({ ...s, days: spanDays(s.first, s.last) }));
  return out.sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
}

interface SummaryRow { session_id: string | null; first_day: string | null; last_day: string | null; orders: number | null; latest: string | null }

/** my_session_summaries() rows → SessionSummary[], newest activity first. PURE. */
export function summariesFromRpc(rows: SummaryRow[], currentId: string | null): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (const r of rows) {
    if (!r.session_id || !r.first_day || !r.last_day) continue;
    const first = r.first_day.slice(0, 10), last = r.last_day.slice(0, 10);
    out.push({ id: r.session_id, first, last, days: spanDays(first, last), orders: Number(r.orders) || 0, latest: r.latest || "", current: r.session_id === currentId });
  }
  return out.sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
}

async function loadSummaries(currentId: string | null): Promise<SessionSummary[] | null> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase.rpc("my_session_summaries");
    if (error) { log.error("Load past sessions error:", error.message); return null; }
    return summariesFromRpc((data || []) as SummaryRow[], currentId);
  } catch (e) {
    log.error("Load past sessions error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** A stored live_session_orders row with its own database id. */
export type PastRow = LiveSessionRow & { id?: number | null };
/** One past session, read-only: its buyers + order list rebuilt exactly like the live board
 *  (rebuildSessionFromRows), and the STORED rows by their own id for Reprint. Each order
 *  carries rowId = the id of the row it was rebuilt from (rebuild makes one order per row, in
 *  row order; liveOrdersToRedesign lists them newest first). Never keyed by time: two rows can
 *  share a created_at millisecond. */
export interface PastSessionData { buyers: Buyer[]; orders: Order[]; rows: Map<number, PastRow> }
export function pastSessionFromRows(rows: PastRow[]): PastSessionData {
  const rebuilt = rebuildSessionFromRows(rows);
  const byId = new Map<number, PastRow>();
  for (const r of rows) if (typeof r.id === "number" && Number.isFinite(r.id)) byId.set(r.id, r);
  const listed = liveOrdersToRedesign(rebuilt); // newest first = rows reversed
  const n = rows.length;
  const orders = listed.length === n
    ? listed.map((o, k) => { const id = rows[n - 1 - k].id; return typeof id === "number" ? { ...o, rowId: id } : o; })
    : listed; // never expected; without rowId the row simply has no Reprint
  return { buyers: rebuilt.buyers, orders, rows: byId };
}
export async function loadPastSession(sessionId: string): Promise<PastSessionData | null> {
  const rows = await loadLiveSessionBySessionId(sessionId, true, true);
  return rows === null ? null : pastSessionFromRows(rows as PastRow[]);
}
const EMPTY: PastSessionData = { buyers: [], orders: [], rows: new Map() };

export type LoadState = "idle" | "loading" | "ready" | "error";

/** Picker state. `selected` null = Current (the Orders screen exactly as before). */
export function usePastSessions(enabled: boolean, currentId: string | null) {
  const [list, setList] = useState<SessionSummary[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [data, setData] = useState<PastSessionData>(EMPTY);
  const [buyersState, setBuyersState] = useState<LoadState>("idle");
  const pickedRef = useRef<string | null>(null); // the latest pick (an older load that lands late is dropped)

  const loadingRef = useRef(false);
  // Reloads EVERY time the picker opens (a session started on another phone shows up); the old
  // list stays visible meanwhile. One call at a time.
  const ensureList = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setListState("loading");
    const next = await loadSummaries(currentId);
    loadingRef.current = false;
    if (next === null) { setListState("error"); return; }
    setList(next);
    setListState("ready");
  }, [enabled, currentId]);

  const pick = useCallback(async (s: SessionSummary | null) => {
    if (!s || s.current) { pickedRef.current = null; setSelected(null); setData(EMPTY); setBuyersState("idle"); return; } // back to Current
    pickedRef.current = s.id;
    setSelected(s); setData(EMPTY); setBuyersState("loading");
    const d = await loadPastSession(s.id);
    if (pickedRef.current !== s.id) return;      // the seller picked something else meanwhile
    if (d === null) setBuyersState("error"); else { setData(d); setBuyersState("ready"); }
  }, []);

  // Reprint source in a past session: ONLY the stored row with that id (its own buyer # and
  // item) — never anything looked up from the live session or by time.
  const rowFor = useCallback((rowId: number | undefined): PastRow | null => (rowId == null ? null : data.rows.get(rowId) ?? null), [data]);

  return { list, listState, ensureList, selected: enabled ? selected : null, buyers: data.buyers, orders: data.orders, rowFor, buyersState, pick };
}
