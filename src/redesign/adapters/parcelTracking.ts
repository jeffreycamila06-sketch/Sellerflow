// 7-11 賣貨便 PICKUP STATUS ("Chase Buyer") — client half (Part 5).
//
// READ-ONLY. One own-scoped SELECT from parcel_tracking on screen open (the
// extension scraper + the Render poller are the only WRITERS). ZERO app-side
// polling — the owner taps Refresh to re-read. The poller fills status /
// pickup_deadline / ship_type from SHOPMORE; this screen only reads + groups.
//
// GATE (Stage 1, 2026-09-29): admin, OR a PLUS/PRO/MASTER seller whose own row in
// the server-side allowlist parcel_tracking_access is enabled (read via the own-row
// RPC my_parcel_tracking_access(), sql/60). The SAME allowlist decides who the
// server poller polls — one list, no email constants in the bundle. The poll
// endpoint is independently gated by a server secret; this is a UI gate, not the
// security boundary.
import { useEffect } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { isAdminRole } from "../../lib/roles";

// ── Feature gate ──────────────────────────────────────────────────────────────
// Tiers that CAN be allowlisted (case-insensitive). The allowlist row is the switch.
export const PARCEL_TRACKING_TIERS = ["plus", "pro", "master"] as const;

export function parcelTrackingVisible(account: {
  role?: string | null;
  plan?: string | null;
  access?: boolean;       // own parcel_tracking_access.enabled (fail-closed: missing = false)
  marketHidden?: boolean; // off-market (non-TW, non-admin/preview) → hidden (admin bypass baked in)
} | null | undefined): boolean {
  if (!account) return false;
  if (account.marketHidden) return false; // market gate wins (NULL/TW → false → today's logic)
  if (isAdminRole(account.role)) return true;
  const tier = String(account.plan ?? "").trim().toLowerCase();
  if (!PARCEL_TRACKING_TIERS.includes(tier as (typeof PARCEL_TRACKING_TIERS)[number])) return false;
  return account.access === true;
}

// Own allowlist flag (SECURITY DEFINER RPC, own row only). FAIL-CLOSED: any error,
// no client, or no session → false. One call per app open (RedesignApp), zero poll.
export async function loadParcelTrackingAccess(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { data, error } = await supabase.rpc("my_parcel_tracking_access");
    return !error && data === true;
  } catch {
    return false;
  }
}

// ── Row shape ─────────────────────────────────────────────────────────────────
export interface ParcelTrackingRow {
  id: string;
  trackingNo: string;        // 交貨便服務代碼 (F/E-code)
  cmOrderNo: string | null;  // metadata only
  buyerUsername: string | null;
  recipientName: string | null;
  storeId: string | null;    // scraped store (name in Phase 1)
  recStore: string | null;   // SHOPMORE 取件門市 (once at store)
  status: string;
  statusMessage: string | null;
  pickupDeadline: string | null; // YYYY-MM-DD (raw SHOPMORE recDate)
  arrivedAt: string | null;
  shipType: string | null;
  specialType: string | null;
  terminal: boolean;
  lastPolledAt?: string | null; // last SHOPMORE check of this row (drives the Stale chip)
}

export function rowToTracking(row: Record<string, unknown>): ParcelTrackingRow {
  const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
  return {
    id: String(row.id),
    trackingNo: String(row.tracking_no ?? ""),
    cmOrderNo: s(row.cm_order_no),
    buyerUsername: s(row.buyer_username),
    recipientName: s(row.recipient_name),
    storeId: s(row.store_id),
    recStore: s(row.rec_store),
    status: String(row.status ?? "created"),
    statusMessage: s(row.status_message),
    pickupDeadline: s(row.pickup_deadline),
    arrivedAt: s(row.arrived_at),
    shipType: s(row.ship_type),
    specialType: s(row.special_type),
    terminal: row.terminal === true,
    lastPolledAt: s(row.last_polled_at),
  };
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

// Chaseable = a C2C store-pickup unit with no special flow (home delivery /
// return service). MIRRORS server/parcelTracking.js isChaseable byte-for-byte.
export function isChaseable(shipType: string | null | undefined, specialType: string | null | undefined): boolean {
  return String(shipType).trim().toUpperCase() === "C2C" && String(specialType || "").trim() === "";
}

// NOT CHECKED YET = a row the seller uploaded ("Sync from 賣貨便") that the poller has
// not reached: status is still the table default 'created'. It has no ship_type /
// deadline yet, so it can't be classified — it is shown under Waiting with an honest
// "next check within 4h" note (B2) and gets NO Chase action.
export function isUnchecked(row: Pick<ParcelTrackingRow, "status">): boolean {
  return row.status === "created";
}

// returning_soon is NOT a stored column — derive it from the raw statusMessage.
// SHOPMORE's warning "將退回物流…" means the parcel is about to be sent back
// (still at store, but the clock is red). The ACTUAL-return markers (退貨門市
// etc.) are a different, terminal state (status='returned') handled by the poller.
export function isReturningSoon(statusMessage: string | null | undefined): boolean {
  return String(statusMessage || "").includes("將退回");
}

// Whole days from `today` (Taipei YYYY-MM-DD) to a YYYY-MM-DD deadline. Negative
// = overdue. null when there is no deadline / an unparseable value. UTC-midnight
// parse on both sides so it never drifts by a timezone.
export function daysUntilDate(deadline: string | null | undefined, today: string): number | null {
  if (!deadline) return null;
  const d = Date.parse(`${deadline}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(t)) return null;
  return Math.round((d - t) / 86400000);
}

// A waiting-pickup parcel is URGENT when it's about to be returned OR the pickup
// deadline is ≤2 days away (including overdue). Only meaningful at_store.
export function isUrgent(row: ParcelTrackingRow, today: string): boolean {
  if (isReturningSoon(row.statusMessage)) return true;
  const dl = daysUntilDate(row.pickupDeadline, today);
  return dl !== null && dl <= 2;
}

export type ChaseTarget =
  | { kind: "open"; handle: string; url: string }  // handle-shaped → open TikTok profile (NOT DM)
  | { kind: "copy"; handle: string }               // present but not handle-shaped → copy it
  | { kind: "none" };                              // no username

// Open the TikTok profile ONLY for a PLAIN handle — letters/digits/dot/underscore,
// nothing else (after trimming whitespace incl full-width U+3000 / NBSP, dropping
// zero-width chars, and stripping leading @). Anything else → COPY only, never a link:
// the handle column is the 賣貨便 "其它資訊 (FB/LINE/IG帳號)" field, so a value with a
// platform marker ("x(IG)", "x（LINE）", "x fb"), parentheses, spaces or CJK is not a
// TikTok handle — opening tiktok.com/@x could land on a STRANGER's profile (B6).
// Opens the PROFILE (manual chase) — never a DM URL. The stored buyer_username is
// never altered; the sanitising is for the URL only.
export function chaseTarget(buyerUsername: string | null | undefined): ChaseTarget {
  const cleaned = String(buyerUsername ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")  // zero-width chars (trim doesn't remove these)
    .trim()                                   // trims spaces incl full-width U+3000 / NBSP
    .replace(/^@+/, "");                      // leading @(s)
  if (!cleaned) return { kind: "none" };
  if (/^[A-Za-z0-9._]{1,24}$/.test(cleaned)) return { kind: "open", handle: cleaned, url: `https://www.tiktok.com/@${cleaned}` };
  return { kind: "copy", handle: cleaned };   // platform-tagged / names / CJK / anything else → Copy
}

// On iOS the "Open profile" tap opens the direct tiktok.com/@handle link, which the
// TikTok app captures (universal link) and lands on the app HOME (not the profile) —
// but the seller is LOGGED IN there. So we ALSO copy "@handle" to the clipboard on the
// same tap, ready to paste into the app's Search → profile → Message. Returns the string
// to copy on iOS, or null on desktop (desktop goes straight to the profile, no copy
// needed). Never touches the stored buyer_username.
export function chaseCopyValue(handle: string, ios: boolean): string | null {
  return ios ? `@${handle}` : null;
}

export interface ParcelGroups {
  waitingPickup: ParcelTrackingRow[]; // chaseable + at_store (urgent-first)
  inTransit: ParcelTrackingRow[];     // chaseable + in_transit
  pickedUp: ParcelTrackingRow[];      // chaseable + picked_up
  returned: ParcelTrackingRow[];      // chaseable + returned
  other: ParcelTrackingRow[];         // non-chaseable, or created/not_found/unknown
}

// Sort by soonest deadline first; rows with no deadline sink to the bottom.
function byDeadline(today: string) {
  return (a: ParcelTrackingRow, b: ParcelTrackingRow): number => {
    const da = daysUntilDate(a.pickupDeadline, today);
    const db = daysUntilDate(b.pickupDeadline, today);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  };
}

// Group by status into the 4 actionable buckets (chaseable only) + one muted
// "other" bucket for non-chaseable / transient rows. waitingPickup is urgent-
// first then soonest deadline; the rest are soonest-deadline. Never mutates input.
export function groupParcels(rows: ParcelTrackingRow[], today: string): ParcelGroups {
  const g: ParcelGroups = { waitingPickup: [], inTransit: [], pickedUp: [], returned: [], other: [] };
  for (const r of rows) {
    // Not checked yet (uploaded, never polled — no ship_type yet): shown under Waiting
    // (B2) so a fresh sync is visible on the phone, where there is no "All" tab.
    if (isUnchecked(r)) { g.waitingPickup.push(r); continue; }
    if (!isChaseable(r.shipType, r.specialType)) { g.other.push(r); continue; }
    if (r.status === "at_store") g.waitingPickup.push(r);
    else if (r.status === "in_transit") g.inTransit.push(r);
    else if (r.status === "picked_up") g.pickedUp.push(r);
    else if (r.status === "returned") g.returned.push(r);
    else g.other.push(r); // created / not_found / unknown
  }
  const cmp = byDeadline(today);
  g.waitingPickup.sort((a, b) => {
    const ua = isUrgent(a, today), ub = isUrgent(b, today);
    if (ua !== ub) return ua ? -1 : 1; // urgent first
    return cmp(a, b);
  });
  g.inTransit.sort(cmp);
  g.pickedUp.sort(cmp);
  g.returned.sort(cmp);
  g.other.sort(cmp);
  return g;
}

// ── Status tabs (Pickup Status redesign — tabs on web, count cards on mobile) ──
// PURE, presentation-only. Same rows, same grouping semantics as groupParcels (chaseable
// C2C store-pickup parcels only in the 4 status tabs); "all" = EVERY row, including the
// non-chaseable / not-yet-updated ones groupParcels calls "other", so nothing disappears.
export type PickupTab = "all" | "waiting" | "transit" | "picked" | "returned";
// Display order follows the real parcel flow: in transit → buyer waiting for pickup →
// picked up → returned. (The screen still OPENS on "waiting" — the chase zone — and the
// "all" list still ranks waiting rows first by urgency; this is only the tab/card order.)
export const PICKUP_TABS: PickupTab[] = ["all", "transit", "waiting", "picked", "returned"];
export const PICKUP_STATUS_TABS: Exclude<PickupTab, "all">[] = ["transit", "waiting", "picked", "returned"];

// Which status tab a row belongs to (null = the "other" bucket → "all" only). MIRRORS
// groupParcels' bucketing exactly (parity-tested).
export function rowTab(row: ParcelTrackingRow): Exclude<PickupTab, "all"> | null {
  if (isUnchecked(row)) return "waiting"; // not checked yet → Waiting (B2), same as groupParcels
  if (!isChaseable(row.shipType, row.specialType)) return null;
  if (row.status === "at_store") return "waiting";
  if (row.status === "in_transit") return "transit";
  if (row.status === "picked_up") return "picked";
  if (row.status === "returned") return "returned";
  return null;
}

// "Left" column content. Only a waiting (at_store) parcel has a meaningful countdown:
// days = daysUntilDate (negative = overdue, null = no deadline), urgent = isUrgent
// (≤2 days incl. overdue, OR returning-soon) → rendered red. In transit / other → "—";
// picked up → "Done"; returned → "Returned".
export type LeftCell =
  | { kind: "unchecked" } // uploaded, not polled yet → "Not checked yet — next check within 4h"
  | { kind: "days"; days: number | null; urgent: boolean }
  | { kind: "none" }
  | { kind: "done" }
  | { kind: "returned" };
export function leftCell(row: ParcelTrackingRow, today: string): LeftCell {
  if (isUnchecked(row)) return { kind: "unchecked" };
  const tab = rowTab(row);
  if (tab === "waiting") return { kind: "days", days: daysUntilDate(row.pickupDeadline, today), urgent: isUrgent(row, today) };
  if (tab === "picked") return { kind: "done" };
  if (tab === "returned") return { kind: "returned" };
  return { kind: "none" };
}

// Sort by days-left ascending (most urgent first). Only waiting parcels have a real
// countdown, so in the mixed "all" tab rows are ranked by status first (waiting →
// transit → picked → returned → other) — a picked-up parcel's stale past deadline must
// never float it above a live waiting one. Within a rank: days-left ascending, no
// deadline last, returning-soon first on a tie. Never mutates.
const TAB_RANK: Record<string, number> = { waiting: 0, transit: 1, picked: 2, returned: 3 };
export function sortByDaysLeft(rows: ParcelTrackingRow[], today: string): ParcelTrackingRow[] {
  const rank = (r: ParcelTrackingRow) => TAB_RANK[rowTab(r) ?? ""] ?? 4;
  const days = (r: ParcelTrackingRow) => daysUntilDate(r.pickupDeadline, today);
  return [...rows].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const da = days(a), db = days(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    const sa = isReturningSoon(a.statusMessage), sb = isReturningSoon(b.statusMessage);
    return sa === sb ? 0 : sa ? -1 : 1;
  });
}

// Rows for one tab (sorted), from the SAME groupParcels output the screen already loads.
export function tabRows(groups: ParcelGroups, tab: PickupTab, today: string): ParcelTrackingRow[] {
  const list =
    tab === "waiting" ? groups.waitingPickup
    : tab === "transit" ? groups.inTransit
    : tab === "picked" ? groups.pickedUp
    : tab === "returned" ? groups.returned
    : [...groups.waitingPickup, ...groups.inTransit, ...groups.pickedUp, ...groups.returned, ...groups.other];
  return sortByDaysLeft(list, today);
}

// totals (exact DB counts) override the derived numbers whenever present — all /
// picked / returned (their lists are capped) and, since S7 paging, waiting / transit
// too. Without totals every count is derived from the loaded rows.
export function tabCounts(groups: ParcelGroups, totals?: ParcelTotals): Record<PickupTab, number> {
  const derivedAll = groups.waitingPickup.length + groups.inTransit.length + groups.pickedUp.length + groups.returned.length + groups.other.length;
  return {
    all: totals?.all ?? derivedAll,
    waiting: totals?.waiting ?? groups.waitingPickup.length,
    transit: totals?.transit ?? groups.inTransit.length,
    picked: totals?.picked ?? groups.pickedUp.length,
    returned: totals?.returned ?? groups.returned.length,
  };
}

// ── Chase-point deadline filter (Waiting-pickup chips) ────────────────────────
// PURE bucketing over the waiting-pickup list for the seller's chase workflow.
// Days-left = daysUntilDate (Taipei whole-day diff; negative = overdue, null =
// no/unparseable deadline). Buckets: "all" (every waiting parcel) · exact 5/3/1
// days left · "overdue" (<0). A null-deadline row only ever matches "all".
// Frontend-only — no DB/server/poll/grouping/gate change.
export type DeadlineBucket = "all" | "d5" | "d3" | "d1" | "overdue";
export const DEADLINE_BUCKETS: DeadlineBucket[] = ["all", "d5", "d3", "d1", "overdue"];

export function matchesDeadlineBucket(daysLeft: number | null, bucket: DeadlineBucket): boolean {
  if (bucket === "all") return true;
  if (daysLeft == null) return false; // no deadline → "all" only
  if (bucket === "overdue") return daysLeft < 0;
  if (bucket === "d5") return daysLeft === 5;
  if (bucket === "d3") return daysLeft === 3;
  if (bucket === "d1") return daysLeft === 1;
  return false;
}

// Filter the waiting-pickup list to one bucket, sorted MOST-URGENT FIRST (soonest
// deadline: overdue → 1 → up; null-deadline sinks). Reuses byDeadline. Never mutates.
export function filterByDeadline(waiting: ParcelTrackingRow[], bucket: DeadlineBucket, today: string): ParcelTrackingRow[] {
  return waiting
    .filter((r) => matchesDeadlineBucket(daysUntilDate(r.pickupDeadline, today), bucket))
    .sort(byDeadline(today));
}

// Count per bucket for the chip badges. "all" = total; a null-deadline row counts
// only toward "all". Never mutates.
export function deadlineBucketCounts(waiting: ParcelTrackingRow[], today: string): Record<DeadlineBucket, number> {
  const counts: Record<DeadlineBucket, number> = { all: 0, d5: 0, d3: 0, d1: 0, overdue: 0 };
  for (const r of waiting) {
    counts.all += 1;
    const dl = daysUntilDate(r.pickupDeadline, today);
    if (dl == null) continue;
    if (dl < 0) counts.overdue += 1;
    else if (dl === 5) counts.d5 += 1;
    else if (dl === 3) counts.d3 += 1;
    else if (dl === 1) counts.d1 += 1;
  }
  return counts;
}

// ── Load (own-scoped SELECT; getSession = LOCAL; ZERO poll) — parcelScan pattern ─
async function uid(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ── Buyer NAME from Customer Details (display only) ──────────────────────────
// Pickup Status shows only the @handle; the same seller's Customer Details
// (parcel_customers) already holds the buyer's name under the same handle (notes).
// Match client-side. PURE key: zero-width chars dropped, trimmed, leading @(s)
// stripped, lower-cased — the handle half of chaseTarget's cleaning, nothing more
// (no IG/LINE/FB tag stripping). "" = no key.
export function normHandle(handle: string | null | undefined): string {
  return String(handle ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}
export const BUYER_NAMES_CHUNK = 500;
export const BUYER_NAMES_MAX = 2000;
let buyerNamesCapLogged = false;
// The seller's own parcel_customers rows that have notes (500 per page, stop at
// 2,000) → Map<normHandle, name> for the requested handles. ANY error → an empty
// Map (fail open: the screen renders exactly as without names). Never written to.
export async function loadBuyerNamesByHandle(handles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = new Set(handles.map(normHandle).filter(Boolean));
  if (!wanted.size || !isSupabaseConfigured || !supabase) return out;
  try {
    const me = await uid();
    if (!me) return out;
    for (let off = 0; off < BUYER_NAMES_MAX; off += BUYER_NAMES_CHUNK) {
      const { data, error } = await supabase.from("parcel_customers").select("notes, name")
        .eq("user_id", me).not("notes", "is", null).neq("notes", "")
        .order("id", { ascending: true }).range(off, off + BUYER_NAMES_CHUNK - 1);
      if (error) return new Map();
      const page = (data ?? []) as { notes?: string | null; name?: string | null }[];
      for (const c of page) {
        const k = normHandle(c.notes);
        const name = String(c.name ?? "").trim();
        if (k && name && wanted.has(k) && !out.has(k)) out.set(k, name); // first non-empty name wins
      }
      if (page.length < BUYER_NAMES_CHUNK) return out;
    }
    if (!buyerNamesCapLogged) { buyerNamesCapLogged = true; console.warn(`[pickup] buyer names: stopped at ${BUYER_NAMES_MAX} customer rows`); }
    return out;
  } catch { return new Map(); }
}

export const PARCEL_TRACKING_PAGE = 500;
export const PT_SELECT = "id, tracking_no, cm_order_no, buyer_username, recipient_name, store_id, rec_store, status, status_message, pickup_deadline, arrived_at, ship_type, special_type, terminal, last_polled_at";

// Exact per-tab totals that survive the page cap (see the starvation note below).
// live = every non-terminal row (drives "Load more"); waiting / transit = exact counts
// for those two tabs (S7), so a seller with >500 unfinished parcels sees true numbers.
export interface ParcelTotals { all: number; picked: number; returned: number; live?: number; waiting?: number; transit?: number }

// 2026-09-27 STARVATION FIX — the old single query (deadline ASC nulls-last,
// LIMIT 500) let hundreds of old picked_up rows (past deadlines sort FIRST)
// crowd out everything behind them: the Returned tab showed 0 with real returns
// at positions ~874/885, and even the WAITING chase zone was partially starved.
// Now THREE DISJOINT bounded queries (statuses partition the table, so no
// dedupe): (1) non-terminal — the live chase zone, complete; (2) returned —
// the owner-prescribed dedicated query, complete (365-day retention keeps this
// small); (3) picked_up — NEWEST first (the only tab where recency matters),
// display capped at 500 but with an EXACT count so the tab number is true.
// totals: all/picked/returned are exact DB counts (count:"exact" rides the
// same requests — no extra round trips); waiting/transit stay derived from the
// complete non-terminal set.
// The unfinished (non-terminal) list is PAGED (S7): deadline ASC nulls-last, then id —
// a stable order, so "Load more" (liveOffset) never repeats or skips a row.
function livePage(me: string, from: number) {
  return supabase!.from("parcel_tracking").select(PT_SELECT, { count: "exact" }).eq("user_id", me).eq("terminal", false)
    .order("pickup_deadline", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + PARCEL_TRACKING_PAGE - 1);
}

// Exact counts for the two tabs built from the (paged) unfinished list. Mirrors
// groupParcels: waiting = chaseable at_store + not-checked-yet ('created'); transit =
// chaseable in_transit. Chaseable = ship_type C2C with no special_type.
function headCount(me: string) {
  return supabase!.from("parcel_tracking").select("id", { count: "exact", head: true }).eq("user_id", me);
}

export async function loadParcelTracking(): Promise<{ ok: boolean; rows: ParcelTrackingRow[]; totals?: ParcelTotals; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const base = () => supabase!.from("parcel_tracking").select(PT_SELECT, { count: "exact" }).eq("user_id", me);
  const chaseable = (q: ReturnType<typeof headCount>) => q.eq("ship_type", "C2C").or("special_type.is.null,special_type.eq.");
  const [live, returned, picked, atStore, unchecked, transit] = await Promise.all([
    livePage(me, 0),
    base().eq("status", "returned")
      .order("returned_at", { ascending: false, nullsFirst: false })
      .limit(PARCEL_TRACKING_PAGE),
    base().eq("status", "picked_up")
      .order("picked_up_at", { ascending: false, nullsFirst: false })
      .limit(PARCEL_TRACKING_PAGE),
    chaseable(headCount(me).eq("terminal", false).eq("status", "at_store")),
    headCount(me).eq("terminal", false).eq("status", "created"),
    chaseable(headCount(me).eq("terminal", false).eq("status", "in_transit")),
  ]);
  const err = live.error || returned.error || picked.error || atStore.error || unchecked.error || transit.error;
  if (err) return { ok: false, rows: [], error: err.message }; // never partial (the S1 rule)
  const rows = [...(live.data ?? []), ...(returned.data ?? []), ...(picked.data ?? [])]
    .map((r) => rowToTracking(r as Record<string, unknown>));
  const totals: ParcelTotals = {
    all: (live.count ?? 0) + (returned.count ?? 0) + (picked.count ?? 0),
    picked: picked.count ?? 0,
    returned: returned.count ?? 0,
    live: live.count ?? 0,
    waiting: (atStore.count ?? 0) + (unchecked.count ?? 0),
    transit: transit.count ?? 0,
  };
  return { ok: true, rows, totals };
}

// S7 — the next page of the unfinished list, starting at `offset` (= how many are loaded).
export async function loadMoreLive(offset: number): Promise<{ ok: boolean; rows: ParcelTrackingRow[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const { data, error } = await livePage(me, Math.max(0, offset));
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => rowToTracking(r as Record<string, unknown>)) };
}

// ── Stage 2: on-demand "Check now" (sql/63) ─────────────────────────────────────
// The seller presses Check now (once per Taipei day, never twice within 12h); the
// server worker runs it as a job. While a job is active the screen re-reads the tiny
// status RPC every 15 s (CHECK_POLL_MS) — only then, never otherwise.
export const CHECK_POLL_MS = 15_000;
export const STALE_MS = 24 * 60 * 60 * 1000;

export interface TrackingJob {
  id: string; kind: string; status: string; error?: string | null;
  parcels_checked?: number | null; parcels_total?: number | null; finished_at?: string | null; requested_at?: string;
}
export interface TrackingStatus {
  last_completed_at: string | null;   // the ONLY source of "Last checked" (a finished manual check)
  next_available_at: string | null;
  used_today: boolean;
  urgent_used_today: boolean;
  active_job: TrackingJob | null;
  last_job: TrackingJob | null;
}
export type CheckReason =
  | "queued" | "disabled" | "not_allowed" | "used_today" | "too_soon" | "already_queued"
  | "not_eligible" | "urgent_used_today" | "bad_kind" | "error";
export interface CheckResult { ok: boolean; reason: CheckReason; next_available_at?: string | null }

export async function loadTrackingStatus(): Promise<TrackingStatus | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("parcel_tracking_status");
    return error || !data ? null : (data as TrackingStatus);
  } catch {
    return null;
  }
}

export async function requestCheck(kind: "manual" | "urgent"): Promise<CheckResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: "error" };
  try {
    const { data, error } = await supabase.rpc("parcel_tracking_request_check", { p_kind: kind });
    if (error || !data) return { ok: false, reason: "error" };
    return data as CheckResult;
  } catch {
    return { ok: false, reason: "error" };
  }
}

// PURE — the Check now button: busy while a job is queued/running, locked until
// next_available_at, otherwise ready. Unknown status (RPC failed) → ready: the server
// still enforces every rule and answers with a plain reason.
// ── Automatic check (sql/83) ──────────────────────────────────────────────────
// The app asks at most once per 30 min per account (app open, return to the app,
// entering Pickup Status). The DATABASE decides whether a check is queued; this is
// only a throttle so we don't call it on every tab switch. Never throws.
export const AUTO_CHECK_THROTTLE_MS = 30 * 60 * 1000;
const autoCheckMemory = new Map<string, number>(); // fallback when localStorage is unavailable

// PURE — may we ask again?
export function autoCheckDue(lastMs: number | null | undefined, nowMs: number): boolean {
  const last = Number(lastMs);
  if (!Number.isFinite(last) || last <= 0) return true;
  return nowMs - last >= AUTO_CHECK_THROTTLE_MS || nowMs < last; // a clock set back never blocks for long
}

const autoKey = (uid: string) => `sfl_pt_auto_${uid}`;
function readAutoLast(uid: string): number | null {
  try {
    const v = localStorage.getItem(autoKey(uid));
    if (v != null) return Number(v);
  } catch { /* storage blocked → memory */ }
  return autoCheckMemory.get(uid) ?? null;
}
function writeAutoLast(uid: string, ms: number): void {
  autoCheckMemory.set(uid, ms);
  try { localStorage.setItem(autoKey(uid), String(ms)); } catch { /* memory only */ }
}

export type AutoCheckReason = "throttled" | "queued" | "error" | string;
export async function requestAutoCheck(
  uid: string | null | undefined,
  nowMs: number = Date.now(),
  rpc?: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<AutoCheckReason> {
  if (!uid) return "error";
  if (!autoCheckDue(readAutoLast(uid), nowMs)) return "throttled";
  writeAutoLast(uid, nowMs); // before the call: a slow or failed call still counts
  const sb = isSupabaseConfigured ? supabase : null;
  const call = rpc ?? (sb ? (fn: string) => sb.rpc(fn) : null);
  if (!call) return "error";
  try {
    const { data, error } = await call("parcel_tracking_auto_check");
    if (error) return "error";
    const reason = (data as { reason?: unknown } | null)?.reason;
    return typeof reason === "string" ? reason : "error";
  } catch {
    return "error";
  }
}

// App open + every return to the app (visibilitychange → visible). requestAutoCheck
// throttles; the database decides.
export function useAutoPickupCheck(enabled: boolean, uid: string | null | undefined): void {
  useEffect(() => {
    if (!enabled || !uid) return;
    void requestAutoCheck(uid);
    const onVisible = () => { if (document.visibilityState === "visible") void requestAutoCheck(uid); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, uid]);
}

export type CheckButton = { kind: "ready" } | { kind: "busy" } | { kind: "locked"; nextAt: string };
export function checkButtonState(status: TrackingStatus | null, nowMs: number): CheckButton {
  if (!status) return { kind: "ready" };
  if (status.active_job) return { kind: "busy" };
  const next = status.next_available_at ? Date.parse(status.next_available_at) : NaN;
  if (Number.isFinite(next) && next > nowMs) return { kind: "locked", nextAt: status.next_available_at! };
  return { kind: "ready" };
}

// PURE — a live parcel whose last SHOPMORE check is more than 24h old.
export function isStale(row: Pick<ParcelTrackingRow, "terminal" | "status" | "lastPolledAt">, nowMs: number): boolean {
  if (row.terminal || isUnchecked(row) || !row.lastPolledAt) return false;
  const t = Date.parse(row.lastPolledAt);
  return Number.isFinite(t) && nowMs - t > STALE_MS;
}

// PURE — mirrors the server's urgent rule: an at-store live parcel due today or tomorrow.
export function urgentEligible(rows: ParcelTrackingRow[], today: string): boolean {
  return rows.some((r) => {
    if (r.terminal || r.status !== "at_store") return false;
    const d = daysUntilDate(r.pickupDeadline, today);
    return d !== null && d <= 1;
  });
}

// PURE — "MM/DD HH:mm" in Taipei time (numeric, language-neutral).
export function formatTaipei(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}
