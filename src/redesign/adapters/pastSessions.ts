// Past sessions for the Orders buyer-# card (Send to TikTok testers: admin OR "tiktok_send").
// READ-ONLY and SEPARATE STATE: these rows never reach liveSession, buyer numbering, Auto
// Mode, printing, Sales or shipping — they only feed the numeric buyer-# card in Orders.
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

/** One past session, read-only: its buyers + order list rebuilt exactly like the live board
 *  (rebuildSessionFromRows), and the STORED rows by orderNum for Reprint. */
export interface PastSessionData { buyers: Buyer[]; orders: Order[]; rows: Map<number, LiveSessionRow> }
export function pastSessionFromRows(rows: LiveSessionRow[]): PastSessionData {
  const rebuilt = rebuildSessionFromRows(rows);
  const byNum = new Map<number, LiveSessionRow>();
  for (const r of rows) {
    const t = r.created_at ? Date.parse(r.created_at) : NaN;
    if (Number.isFinite(t)) byNum.set(t, r); // orderNum derivation mirrors rebuildSessionFromRows
  }
  return { buyers: rebuilt.buyers, orders: liveOrdersToRedesign(rebuilt), rows: byNum };
}
export async function loadPastSession(sessionId: string): Promise<PastSessionData | null> {
  const rows = await loadLiveSessionBySessionId(sessionId, true);
  return rows === null ? null : pastSessionFromRows(rows);
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

  // Reprint source in a past session: ONLY the stored row of that order (its own buyer # and
  // item) — never anything looked up from the live session.
  const rowFor = useCallback((orderNum: number | undefined): LiveSessionRow | null => (orderNum == null ? null : data.rows.get(orderNum) ?? null), [data]);

  return { list, listState, ensureList, selected: enabled ? selected : null, buyers: data.buyers, orders: data.orders, rowFor, buyersState, pick };
}
