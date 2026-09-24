// 7-11 賣貨便 PICKUP STATUS ("Chase Buyer") — client half (Part 5).
//
// READ-ONLY. One own-scoped SELECT from parcel_tracking on screen open (the
// extension scraper + the Render poller are the only WRITERS). ZERO app-side
// polling — the owner taps Refresh to re-read. The poller fills status /
// pickup_deadline / ship_type from SHOPMORE; this screen only reads + groups.
//
// PHASE 1 = OWNER + googletest ONLY (parcelTrackingVisible, kiosk-allowlist
// pattern). The poll endpoint is independently gated by a server secret — this
// is a UI gate, not the security boundary.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { isAdminRole } from "../../lib/roles";

// ── Feature gate (canSeeKioskLauncher pattern) ────────────────────────────────
// While Pickup Status is Phase 1, these emails see it (admins always do). ONE
// place — widen or empty this list to open it more broadly.
export const PARCEL_TRACKING_EMAILS = ["googletest@gmail.com"];

export function parcelTrackingVisible(account: {
  role?: string | null;
  email?: string | null;
  plan?: string | null;
  marketHidden?: boolean; // off-market (non-TW, non-admin/preview) → hidden (admin bypass baked in)
} | null | undefined): boolean {
  if (!account) return false;
  if (account.marketHidden) return false; // market gate wins (NULL/TW → false → today's logic)
  if (isAdminRole(account.role)) return true;
  const email = String(account.email || "").trim().toLowerCase();
  if (PARCEL_TRACKING_EMAILS.includes(email)) return true;
  // ── PHASE 2 SEAM (do NOT enable yet) — open to paid tiers with a one-liner:
  //   return isActivePaid({ plan: account.plan ?? "", planStatus, daysLeft }) &&
  //          PARCEL_TRACKING_TIERS.includes(String(account.plan).toLowerCase());
  return false;
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
  };
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

// Chaseable = a C2C store-pickup unit with no special flow (home delivery /
// return service). MIRRORS server/parcelTracking.js isChaseable byte-for-byte.
export function isChaseable(shipType: string | null | undefined, specialType: string | null | undefined): boolean {
  return String(shipType).trim().toUpperCase() === "C2C" && String(specialType || "").trim() === "";
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

// TikTok handles are letters/digits/dot/underscore. A stored buyer_username that
// is a real name (spaces / CJK) is NOT handle-shaped → offer Copy instead. Opens
// the PROFILE (manual chase) — never a DM URL. The https://www.tiktok.com/@handle
// URL IS the TikTok universal link (opens the app to the profile on iOS if installed,
// else the web). We SANITIZE FOR THE URL ONLY — the stored buyer_username is never
// altered: strip leading @, trim whitespace incl full-width U+3000 / NBSP, drop
// zero-width chars (which trim leaves), and tolerate a trailing platform tag the
// seller may append (e.g. "Ashley102031(IG)" → opens @Ashley102031).
export function chaseTarget(buyerUsername: string | null | undefined): ChaseTarget {
  const cleaned = String(buyerUsername ?? "")
    .replace(/[​-‍﻿]/g, "")   // zero-width chars (trim doesn't remove these)
    .trim()                                   // trims spaces incl full-width U+3000 / NBSP
    .replace(/^@+/, "");                      // leading @(s)
  if (!cleaned) return { kind: "none" };
  if (/^[A-Za-z0-9._]{1,24}$/.test(cleaned)) return { kind: "open", handle: cleaned, url: `https://www.tiktok.com/@${cleaned}` };
  // tolerate a handle-shaped token trailed ONLY by a platform tag, e.g. "Ashley102031(IG)"
  const m = cleaned.match(/^([A-Za-z0-9._]{1,24})\s*[（(]?\s*(?:ig|fb|line|tiktok|tt)?\s*[）)]?$/i);
  if (m) return { kind: "open", handle: m[1], url: `https://www.tiktok.com/@${m[1]}` };
  return { kind: "copy", handle: cleaned };   // real names (spaces / CJK) → Copy
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
  | { kind: "days"; days: number | null; urgent: boolean }
  | { kind: "none" }
  | { kind: "done" }
  | { kind: "returned" };
export function leftCell(row: ParcelTrackingRow, today: string): LeftCell {
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

export function tabCounts(groups: ParcelGroups): Record<PickupTab, number> {
  return {
    all: groups.waitingPickup.length + groups.inTransit.length + groups.pickedUp.length + groups.returned.length + groups.other.length,
    waiting: groups.waitingPickup.length,
    transit: groups.inTransit.length,
    picked: groups.pickedUp.length,
    returned: groups.returned.length,
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

export const PARCEL_TRACKING_PAGE = 500; // Phase 1 is owner + googletest → tiny.

export async function loadParcelTracking(): Promise<{ ok: boolean; rows: ParcelTrackingRow[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, rows: [], error: "not configured" };
  const me = await uid();
  if (!me) return { ok: false, rows: [], error: "not signed in" };
  const { data, error } = await supabase
    .from("parcel_tracking")
    .select("id, tracking_no, cm_order_no, buyer_username, recipient_name, store_id, rec_store, status, status_message, pickup_deadline, arrived_at, ship_type, special_type, terminal")
    .eq("user_id", me)
    .order("pickup_deadline", { ascending: true, nullsFirst: false })
    .limit(PARCEL_TRACKING_PAGE);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: (data ?? []).map((r) => rowToTracking(r as Record<string, unknown>)) };
}
