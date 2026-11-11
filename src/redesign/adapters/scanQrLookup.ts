// Scan QR → look the scanned @username up in the seller's OWN Customers of THIS screen
// (7-11 Parcel Scan → parcel_customers.notes · FamilyMart Parcel Scan → fm_parcel_customers.buyer_username).
// Jeff 2026-11-11. The sticker QR, the QR parser, printing, the save and the export are untouched.
//
// Rules (Jeff's answers):
//  • EXACT username only: trim, drop ONE leading "@", lower case, then equal. "pedro123" never
//    matches "pedro12" (and the other way round); "_" and "." are ordinary characters.
//  • Records saved as TikTok or with no app picked (contact_platform NULL / "tiktok") only.
//  • "unknown" and blank are never looked up.
//  • Every record of that username comes back, newest "last updated" first — 2+ = the seller picks.
//  • A different username is a different person here: nothing is ever joined by phone or store.
//
// ONE read per scan (a user action), own rows only (explicit user_id + RLS), no poll. The query
// asks the database for a case-insensitive match with and without "@"; in that comparison "_"
// stands for any one character, so the app makes the FINAL exact check on every returned row
// (matchLookupRows) — nothing the database returns is trusted as a match.
import { isSupabaseConfigured, supabase } from "../../supabase";

export type ScanQrLookupStore = "711" | "fm";
export const SCAN_QR_LOOKUP_LIMIT = 100;
export const SCAN_QR_LOOKUP_TIMEOUT_MS = 4000;

const SOURCES = {
  "711": { table: "parcel_customers", col: "notes" },
  fm: { table: "fm_parcel_customers", col: "buyer_username" },
} as const;

export interface ScanQrLookupRow {
  id: string;
  name: string;
  phone: string;
  storeId: string;
  /** ISO time the Customers record was last WRITTEN ("last updated" — not "last used"). */
  updatedAt: string;
}
/** A Customers row as read (before the exact check). */
export interface ScanQrLookupRaw extends ScanQrLookupRow {
  username: string;
  platform: string | null;
}
export type ScanQrLookupResult = { ok: true; rows: ScanQrLookupRow[]; more: boolean } | { ok: false };

/** trim → drop ONE leading "@" → lower case. */
export function lookupKey(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/^@/, "").trim().toLowerCase();
}
/** Only a username-shaped key is ever looked up; "unknown" and blank never are. */
export function isLookupable(key: string): boolean {
  return /^[a-z0-9._]{1,50}$/.test(key) && key !== "unknown";
}
// TikTok is saved as "no app" (NULL); an explicit "tiktok" counts too. Any other app never matches.
function platformOk(p: string | null | undefined): boolean {
  const v = String(p ?? "").trim().toLowerCase();
  return v === "" || v === "tiktok";
}

/**
 * The FINAL check, in the app: exactly this username, TikTok / no app, never "unknown" or blank.
 * Newest "last updated" first (same time → by id, so the order never jumps).
 */
export function matchLookupRows(rows: readonly ScanQrLookupRaw[], key: string): ScanQrLookupRow[] {
  if (!isLookupable(key)) return [];
  return rows
    .filter((r) => platformOk(r.platform) && lookupKey(r.username) === key)
    .map((r) => ({ id: r.id, name: r.name, phone: r.phone, storeId: r.storeId, updatedAt: r.updatedAt }))
    .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.updatedAt < b.updatedAt ? 1 : -1));
}

/** What differs between the records of one username: the store wins, then the phone, else only the name. */
export function lookupDiffers(rows: readonly ScanQrLookupRow[]): "store" | "phone" | "name" {
  if (new Set(rows.map((r) => r.storeId.trim())).size > 1) return "store";
  if (new Set(rows.map((r) => r.phone.trim())).size > 1) return "phone";
  return "name";
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * Every Customers record of this screen whose username is exactly `handle`.
 * ok:false = could not be read (no sign-in, error, more than `timeoutMs`) → the screen says so in one short line.
 * Never throws.
 */
export async function lookupCustomersByHandle(store: ScanQrLookupStore, handle: string, timeoutMs = SCAN_QR_LOOKUP_TIMEOUT_MS): Promise<ScanQrLookupResult> {
  const key = lookupKey(handle);
  if (!isLookupable(key)) return { ok: true, rows: [], more: false };
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return { ok: false };
  const src = SOURCES[store];
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ScanQrLookupResult>((resolve) => {
    timer = setTimeout(() => { try { ctrl?.abort(); } catch { /* nothing to stop */ } resolve({ ok: false }); }, timeoutMs);
  });
  const read = (async (): Promise<ScanQrLookupResult> => {
    try {
      const { data: s } = await sb.auth.getSession();
      const me = s.session?.user?.id;
      if (!me) return { ok: false };
      // key is [a-z0-9._] only (isLookupable) — nothing in it can change the filter.
      let q = sb.from(src.table)
        .select(`id, user_id, phone, name, store_id, ${src.col}, contact_platform, updated_at`)
        .eq("user_id", me)
        .or(`${src.col}.ilike.${key},${src.col}.ilike.@${key}`)
        .order("updated_at", { ascending: false })
        .limit(SCAN_QR_LOOKUP_LIMIT);
      if (ctrl && typeof (q as { abortSignal?: unknown }).abortSignal === "function") q = q.abortSignal(ctrl.signal);
      const { data, error } = await q;
      if (error) return { ok: false };
      const got = (Array.isArray(data) ? data : []) as unknown as Record<string, unknown>[];
      // own rows only — a third time, in the app (after the explicit user_id filter and the database's own rule)
      const rows = matchLookupRows(got.filter((r) => str(r.user_id) === me).map((r) => ({
        id: str(r.id), name: str(r.name), phone: str(r.phone), storeId: str(r.store_id), updatedAt: str(r.updated_at),
        username: str(r[src.col]), platform: r.contact_platform == null ? null : str(r.contact_platform),
      })), key);
      const full = got.length >= SCAN_QR_LOOKUP_LIMIT;
      // A full page with no exact record in it = not everything was seen → say "could not look up", never "none".
      if (full && rows.length === 0) return { ok: false };
      return { ok: true, rows, more: full };
    } catch {
      return { ok: false };
    }
  })();
  try {
    return await Promise.race([read, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── What the form remembers about a lookup (kept with the ⇄ draft of its own screen only) ──────
export interface LookupFields { name: string; phone: string; store: string }
export interface ScanQrLookupMark {
  /** Details now in the form came from this username's record; `filled` = exactly what was written. */
  applied: { handle: string; updatedAt: string; filled: LookupFields } | null;
  /** Records found but NOT written: 1 = a suggestion ("Use"), 2+ = the seller picks. */
  pending: { handle: string; rows: ScanQrLookupRow[]; more: boolean } | null;
}
export type ScanQrLookupView =
  | { kind: "none" }
  | { kind: "failed" }
  | { kind: "found"; handle: string; updatedAt: string }
  | { kind: "mismatch"; handle: string }
  // `from` = details still in the form came from ANOTHER username's record (shown with the suggestion / list)
  | { kind: "suggest"; handle: string; row: ScanQrLookupRow; from: string | null }
  | { kind: "choose"; handle: string; rows: ScanQrLookupRow[]; differs: "store" | "phone" | "name"; more: boolean; from: string | null };

/**
 * What to show for the username that is in the field NOW. Pure.
 * `failedFor` = the username whose lookup could not be read (shown only while it is still in the field
 * and there is nothing else to show).
 */
export function lookupView(mark: ScanQrLookupMark | null, fieldHandle: string, failedFor: string | null = null): ScanQrLookupView {
  const now = lookupKey(fieldHandle);
  const a = mark?.applied ?? null;
  const p = mark?.pending ?? null;
  if (p && p.rows.length > 0 && p.handle === now) {
    const from = a && a.handle !== now ? a.handle : null;
    return p.rows.length === 1
      ? { kind: "suggest", handle: p.handle, row: p.rows[0], from }
      : { kind: "choose", handle: p.handle, rows: p.rows, differs: lookupDiffers(p.rows), more: p.more, from };
  }
  if (a) return a.handle === now ? { kind: "found", handle: a.handle, updatedAt: a.updatedAt } : { kind: "mismatch", handle: a.handle };
  if (failedFor !== null && failedFor !== "" && failedFor === now) return { kind: "failed" };
  return { kind: "none" };
}

/** The fields a new scan must blank: written by the lookup and not touched since. Pure. */
export function untouchedFilled(applied: ScanQrLookupMark["applied"], cur: LookupFields): Partial<LookupFields> {
  const out: Partial<LookupFields> = {};
  if (!applied) return out;
  for (const k of ["name", "phone", "store"] as const) {
    if (applied.filled[k] !== "" && cur[k] === applied.filled[k]) out[k] = "";
  }
  return out;
}

/** Visible when the global switch is on OR this login is on the list. Off + not listed = exactly as before. */
export function scanQrLookupVisible(a: { switchOn: boolean; previewKey: boolean }): boolean {
  return a.switchOn === true || a.previewKey === true;
}

/** "last updated" date, Taipei time, in the app language. "" when the time is unreadable. */
export function lookupDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Taipei", year: "numeric", month: "short", day: "numeric" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", { timeZone: "Asia/Taipei", year: "numeric", month: "short", day: "numeric" }).format(d);
  }
}

/** Put the cursor in `el` — unless the seller is typing in a field right now (never pull the cursor away). */
export function focusUnlessTyping(el: HTMLElement | null): void {
  if (!el || typeof document === "undefined") return;
  const a = document.activeElement as HTMLElement | null;
  if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
  try { el.focus(); } catch { /* not focusable now */ }
}
