// Past sessions for the Orders buyer-# card (Send to TikTok testers: admin OR "tiktok_send").
// READ-ONLY and SEPARATE STATE: these rows never reach liveSession, buyer numbering, Auto
// Mode, printing, Sales or shipping — they only feed the numeric buyer-# card in Orders.
// Loaded lazily: the session list when the picker opens, one session's rows when picked.
// RLS + an explicit user_id filter keep every read to the signed-in seller's own rows.
import { useCallback, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { fetchAllPages } from "../../lib/fetchAllPages";
import { rebuildSessionFromRows } from "../../lib/orderLogic";
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
interface IndexRow { session_id: string | null; session_date: string | null; created_at: string | null }

const DAY_MS = 86_400_000;
const spanDays = (a: string, b: string): number => {
  const d = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(d) && d >= 0 ? d + 1 : 1;
};
/** "10/10" from "2026-10-10". */
export const md = (day: string): string => (day && day.length >= 10 ? day.slice(5, 10).replace("-", "/") : day);
/** "10/10 → 10/14", or "10/14" for a one-day session. */
export const sessionRange = (s: Pick<SessionSummary, "first" | "last">): string => (s.first === s.last ? md(s.first) : `${md(s.first)} → ${md(s.last)}`);

/** Rows → one summary per session_id, newest activity first. PURE. */
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

const INDEX_PAGE = 1000;
async function loadIndexRows(): Promise<IndexRow[] | null> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: { session } } = await supabase.auth.getSession();
  const me = session?.user?.id;
  if (!me) return null;
  return fetchAllPages<IndexRow>(async (page) => {
    const from = page * INDEX_PAGE;
    const { data, error } = await supabase!
      .from("live_session_orders")
      .select("session_id,session_date,created_at")
      .eq("user_id", me)
      .not("session_id", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + INDEX_PAGE - 1);
    if (error) { log.error("Load past sessions error:", error.message); return null; }
    return (data || []) as IndexRow[];
  }, INDEX_PAGE);
}

/** One past session's buyers, grouped exactly like the live board (rebuildSessionFromRows). */
export async function loadSessionBuyers(sessionId: string): Promise<Buyer[] | null> {
  const rows = await loadLiveSessionBySessionId(sessionId, true);
  return rows === null ? null : rebuildSessionFromRows(rows).buyers;
}

export type LoadState = "idle" | "loading" | "ready" | "error";

/** Picker state. `selected` null = Current (the Orders screen exactly as before). */
export function usePastSessions(enabled: boolean, currentId: string | null) {
  const [list, setList] = useState<SessionSummary[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [buyersState, setBuyersState] = useState<LoadState>("idle");
  const pickedRef = useRef<string | null>(null); // the latest pick (an older load that lands late is dropped)

  const ensureList = useCallback(async () => {
    if (!enabled || listState === "loading" || listState === "ready") return;
    setListState("loading");
    const rows = await loadIndexRows();
    if (rows === null) { setListState("error"); return; }
    setList(buildSessionIndex(rows, currentId));
    setListState("ready");
  }, [enabled, listState, currentId]);

  const pick = useCallback(async (s: SessionSummary | null) => {
    if (!s || s.current) { pickedRef.current = null; setSelected(null); setBuyers([]); setBuyersState("idle"); return; } // back to Current
    pickedRef.current = s.id;
    setSelected(s); setBuyers([]); setBuyersState("loading");
    const b = await loadSessionBuyers(s.id);
    if (pickedRef.current !== s.id) return;      // the seller picked something else meanwhile
    if (b === null) setBuyersState("error"); else { setBuyers(b); setBuyersState("ready"); }
  }, []);

  return { list, listState, ensureList, selected: enabled ? selected : null, buyers, buyersState, pick };
}
