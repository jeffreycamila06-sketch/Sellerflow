// WAYBILL USERNAME — who is the buyer of a TikTok Shop order?
// TikTok masks the buyer username in the order list but KEEPS the first character, the last
// character and the length ("a****8" = 6 characters, starts "a", ends "8"). The seller's own TikTok
// buyers from the lives of TODAY and YESTERDAY (Asia/Taipei day — the same clock as the Philippines)
// are the candidates. Exactly one candidate with the same shape → filled in by itself; none or 2+ →
// the seller picks. PURE parts unit-tested; the one database read is loadWaybillCandidates.
import { fetchAllPages } from "../../lib/fetchAllPages";
import { taipeiDayId } from "../../lib/dateHelpers";
import { addDays } from "./useSessionWindow";
import { isSupabaseConfigured, supabase } from "../../supabase";

export interface CandidateRow {
  user_id?: string | null;
  session_date?: string | null;
  buyer_number?: number | null;
  handle?: string | null;
  customer_name?: string | null;
  platform?: string | null;
  price?: number | string | null;
  qty?: number | string | null;
  created_at?: string | null;
}
export interface Candidate {
  handle: string;       // without "@", as last seen
  key: string;          // lower case, for comparing
  name: string;         // the latest customer name ("" = none)
  buyerNumber: number;  // the latest buyer number
  orders: number;       // order rows today + yesterday
  total: number;        // sum of price × qty
  day: "today" | "yesterday"; // the latest day seen
  lastAt: number;       // epoch ms of the latest order (sorting)
}

export const stripAt = (s: string): string => String(s ?? "").trim().replace(/^@+/, "").trim();
const chars = (s: string): string[] => Array.from(s);

// Does the TikTok mask fit this username? Case does not matter. A mask without "*" must be the
// username itself. With stars: same length, and every character that is not a star is the same
// character at the same place (= first + last + length for TikTok's usual "m*****3").
export function maskFits(mask: string, handle: string): boolean {
  const m = chars(stripAt(mask).toLowerCase());
  const h = chars(stripAt(handle).toLowerCase());
  if (!m.length || !h.length) return false;
  if (!m.includes("*")) return m.join("") === h.join("");
  if (m.length !== h.length) return false;
  for (let i = 0; i < m.length; i++) if (m[i] !== "*" && m[i] !== h[i]) return false;
  return m.some((c) => c !== "*"); // "******" alone tells nothing → never a match
}

// The candidates from the rows of today + yesterday. Only TikTok rows, only the given user's rows,
// only those two days (the read already asks for exactly that — this repeats it so nothing else can
// slip in), only rows with a username.
export function buildCandidates(rows: CandidateRow[], userId: string, today: string): Candidate[] {
  const yesterday = addDays(today, -1);
  const map = new Map<string, Candidate>();
  for (const r of rows) {
    if (!r || r.user_id !== userId) continue; // only MY rows (a row without a seller never counts)
    if (String(r.platform ?? "").trim().toLowerCase() !== "tiktok") continue;
    const day = r.session_date === today ? "today" : r.session_date === yesterday ? "yesterday" : null;
    if (!day) continue;
    const handle = stripAt(r.handle ?? "");
    if (!handle) continue;
    const key = handle.toLowerCase();
    const price = Number(r.price) || 0;
    const qty = Math.max(1, Math.floor(Number(r.qty) || 1));
    const at = r.created_at ? Date.parse(r.created_at) || 0 : 0;
    const name = String(r.customer_name ?? "").trim();
    const num = Number(r.buyer_number) || 0;
    const had = map.get(key);
    if (!had) {
      map.set(key, { handle, key, name, buyerNumber: num, orders: 1, total: price * qty, day, lastAt: at });
      continue;
    }
    had.orders += 1;
    had.total += price * qty;
    if (day === "today") had.day = "today";
    if (at >= had.lastAt) {
      had.lastAt = at;
      had.handle = handle;
      had.buyerNumber = num;
      if (name) had.name = name;
    } else if (!had.name && name) had.name = name;
  }
  return Array.from(map.values()).sort(byRecent);
}

const byRecent = (a: Candidate, b: Candidate): number =>
  (a.day === b.day ? 0 : a.day === "today" ? -1 : 1) || b.lastAt - a.lastAt || a.key.localeCompare(b.key);

export function candidatesFor(mask: string, cands: Candidate[]): Candidate[] {
  return cands.filter((c) => maskFits(mask, c.handle));
}

// The search box of the "Pick the buyer" sheet: contains, over username and name.
export function searchCandidates(q: string, cands: Candidate[]): Candidate[] {
  const s = stripAt(q).toLowerCase();
  if (!s) return cands;
  return cands.filter((c) => c.key.includes(s) || c.name.toLowerCase().includes(s));
}

// ── the one read: own TikTok rows of today + yesterday (paged, never partial) ──────────────────
const PAGE = 1000;
export type CandidateLoad = { ok: true; candidates: Candidate[]; today: string } | { ok: false };

export async function loadWaybillCandidates(userId: string, today: string = taipeiDayId()): Promise<CandidateLoad> {
  if (!userId || !isSupabaseConfigured || !supabase) return { ok: false };
  const sb = supabase;
  const yesterday = addDays(today, -1);
  try {
    const rows = await fetchAllPages<CandidateRow>(async (page) => {
      const { data, error } = await sb
        .from("live_session_orders")
        .select("id,user_id,session_date,buyer_number,handle,customer_name,platform,price,qty,created_at")
        .eq("user_id", userId)
        .ilike("platform", "tiktok")
        .in("session_date", [yesterday, today])
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      return error ? null : ((data ?? []) as CandidateRow[]);
    }, PAGE);
    if (!rows) return { ok: false };
    return { ok: true, candidates: buildCandidates(rows, userId, today), today };
  } catch {
    return { ok: false };
  }
}
