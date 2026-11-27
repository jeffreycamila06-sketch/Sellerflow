// Past sessions in Orders — the "This session + Past sessions" picker. Who sees it
// (pastSessionsAllowed): an admin, a seller on the "tiktok_send" list, or EVERY signed-in seller
// (any plan, free included) while the app_settings switch past_sessions_public is 'true'
// (sql/134). Separate from Send to TikTok, which keeps its own gate (tiktokSendAllowed).
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
import { visibleSession } from "./orderCancel";
import { log } from "../../lib/log";

/** Who sees the past-session picker: admin, the "tiktok_send" preview list, or anyone while the
 *  past_sessions_public switch is on. Independent of the Send to TikTok gate. PURE. */
export const pastSessionsAllowed = (isAdmin: boolean, listed: boolean, publicSwitch: boolean): boolean => isAdmin || listed || publicSwitch;

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
  // Cancel order (sql/234): the buyers (receipts, Invoicing, Send to TikTok) leave cancelled orders
  // out; the order list keeps them (struck through in the Orders tab). Same object when none.
  return { buyers: visibleSession(rebuilt).buyers, orders, rows: byId };
}
export async function loadPastSession(sessionId: string): Promise<PastSessionData | null> {
  const rows = await loadLiveSessionBySessionId(sessionId, true, true);
  return rows === null ? null : pastSessionFromRows(rows as PastRow[]);
}
const EMPTY: PastSessionData = { buyers: [], orders: [], rows: new Map() };

// ── A session's platform (Invoicing only). Every session belongs to ONE platform — switching platform
// starts a new session (live data 2026-11-27: 0 sessions with more than one) — so ONE stored row of the
// session tells it. Read once per session (≤ 12 sessions per seller, one tiny "limit 1" read each) and
// kept for the app's life: a session's platform never changes. The Orders tab never asks for it.
const platformCache = new Map<string, string | null>();
/** Test-only: forget the remembered platforms. */
export function __resetSessionPlatforms(): void { platformCache.clear(); }
async function readSessionPlatform(id: string): Promise<string | null | undefined> {
  if (!supabase) return undefined;
  try {
    const { data, error } = await supabase.from("live_session_orders").select("platform")
      .eq("session_id", id).not("platform", "is", null).limit(1);
    if (error) { log.error("Load session platform error:", error.message); return undefined; }
    const row = Array.isArray(data) ? (data[0] as { platform?: string | null } | undefined) : undefined;
    return row?.platform ? String(row.platform) : null;
  } catch (e) {
    log.error("Load session platform error:", e instanceof Error ? e.message : String(e));
    return undefined;
  }
}
/** The platform of each session ("TikTok" / "Facebook" / … — the name the orders carry; null = the session
 *  has no stored row). null = a read failed (the list is not shown half-filtered). */
export async function loadSessionPlatforms(ids: string[]): Promise<Map<string, string | null> | null> {
  if (!isSupabaseConfigured || !supabase) return new Map(ids.map((id) => [id, null]));
  const missing = ids.filter((id) => !platformCache.has(id));
  const got = await Promise.all(missing.map(async (id) => [id, await readSessionPlatform(id)] as const));
  if (got.some(([, p]) => p === undefined)) return null;
  for (const [id, p] of got) platformCache.set(id, p as string | null);
  return new Map(ids.map((id) => [id, platformCache.get(id) ?? null]));
}
/** Only the sessions of that platform (case does not matter). PURE. */
export const sessionsOfPlatform = (list: SessionSummary[], platforms: ReadonlyMap<string, string | null>, platform: string): SessionSummary[] =>
  list.filter((s) => String(platforms.get(s.id) || "").toLowerCase() === platform.toLowerCase());

export type LoadState = "idle" | "loading" | "ready" | "error";

/** Picker state. `selected` null = Current (the Orders screen exactly as before).
 *  `platform` (Invoicing only — "TikTok" / "Facebook" …): the list keeps only that platform's sessions.
 *  Without it (the Orders tab) the list is exactly the my_session_summaries list, as before. */
export function usePastSessions(enabled: boolean, currentId: string | null, platform?: string) {
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
    let next = await loadSummaries(currentId);
    if (next !== null && platform) {
      const kinds = await loadSessionPlatforms(next.map((x) => x.id));
      next = kinds === null ? null : sessionsOfPlatform(next, kinds, platform);
    }
    loadingRef.current = false;
    if (next === null) { setListState("error"); return; }
    setList(next);
    setListState("ready");
  }, [enabled, currentId, platform]);

  const pick = useCallback(async (s: SessionSummary | null) => {
    if (!s || s.current) { pickedRef.current = null; setSelected(null); setData(EMPTY); setBuyersState("idle"); return; } // back to Current
    pickedRef.current = s.id;
    setSelected(s); setData(EMPTY); setBuyersState("loading");
    const d = await loadPastSession(s.id);
    if (pickedRef.current !== s.id) return;      // the seller picked something else meanwhile
    if (d === null) setBuyersState("error"); else { setData(d); setBuyersState("ready"); }
  }, []);

  // Cancel order: read the picked session again WITHOUT clearing the screen (buyers / receipts then
  // leave the cancelled order out). A failed read keeps what is shown.
  const reload = useCallback(async () => {
    const id = pickedRef.current;
    if (!id) return;
    const d = await loadPastSession(id);
    if (pickedRef.current !== id || d === null) return;
    setData(d);
  }, []);

  // Reprint source in a past session: ONLY the stored row with that id (its own buyer # and
  // item) — never anything looked up from the live session or by time.
  const rowFor = useCallback((rowId: number | undefined): PastRow | null => (rowId == null ? null : data.rows.get(rowId) ?? null), [data]);

  return { list, listState, ensureList, selected: enabled ? selected : null, buyers: data.buyers, orders: data.orders, rowFor, buyersState, pick, reload };
}
