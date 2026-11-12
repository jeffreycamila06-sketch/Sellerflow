// Scan QR → fill the buyer's saved details from the seller's OWN Customers of THIS screen
// (7-11 Parcel Scan → parcel_customers.notes · FamilyMart Parcel Scan → fm_parcel_customers.buyer_username).
// Jeff 2026-11-12. The sticker QR, the QR parser, printing, the save and the export are untouched.
//
// It only READS Customers. Saving a parcel writes to Customers exactly as it always did — nothing here changes that.
//
// What happens (nothing new is ever shown on screen):
//  • the username has a record → name, phone and store come from the NEWEST record (last updated; same time → id)
//  • something is already typed in name, phone or store → nothing is filled
//  • the username's records have 3 or more DIFFERENT phones (a word the seller uses for many buyers, e.g. "user",
//    not one person's username) → nothing is filled
//  • no record / error / more than 4 s → exactly as before (username only), no message
//
// Which records belong to a username (rule #4):
//  • the saved text is exactly "pedro123" or "@pedro123" (any letter case), or
//  • it starts with "@" and the FIRST word after it (a space may come first) is exactly pedro123:
//    "@pedro123 (U)", "@pedro123 #3", "@ pedro123", "@pedro123 Garcia (NA)"
//  • never: "@pedro12", "@pedro1234", "(U) @pedro123", "Pedro Garcia", or anything with a space that does not start with "@"
//  • the record's app is TikTok or none; "unknown" and blank are never looked up.
//
// ONE read per scan (a user action), own rows only (explicit user_id + RLS + a check in the app), no poll.
// The database is asked for near matches ("_" stands for any one character there); the app makes the FINAL
// exact check on every returned row — nothing the database returns is trusted as a match.
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
  /** ISO time the Customers record was last written. */
  updatedAt: string;
}
/** A Customers row as read (before the exact check). */
export interface ScanQrLookupRaw extends ScanQrLookupRow {
  username: string;
  platform: string | null;
}
/** rows: every record of the username, newest first — recordToFill(rows) says which one is used, if any. */
export type ScanQrLookupResult = { ok: true; rows: ScanQrLookupRow[] } | { ok: false };

/** The scanned username: trim → drop ONE leading "@" → lower case. */
export function lookupKey(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/^@/, "").trim().toLowerCase();
}
/** Only a username-shaped key is ever looked up; "unknown" and blank never are. */
export function isLookupable(key: string): boolean {
  return /^[a-z0-9._]{1,50}$/.test(key) && key !== "unknown";
}

// "Space" here = the plain ones only (space, tab, new line …).
const WS = " \\t\\n\\r\\f\\v";
const KEY_EXACT = new RegExp(`^[${WS}]*([A-Za-z0-9._]{1,50})[${WS}]*$`);
const KEY_AT = new RegExp(`^[${WS}]*@[${WS}]*([A-Za-z0-9._]{1,50})(?:[${WS}][\\s\\S]*)?$`);
// the username, then a note that starts with "(" or "#" — with or without "@", with or without a space before it
const KEY_NOTE = new RegExp(`^[${WS}]*@?[${WS}]*([A-Za-z0-9._]{1,50})[${WS}]*[(#][\\s\\S]*$`);
/**
 * The username a saved contact text stands for, lower case — "" when it stands for none.
 * "pedro123" / "@pedro123" / "@pedro123 (U)" / "@ pedro123" / "pedro123 (U)" / "pedro123(U)" / "pedro123 #3" /
 * "@pedro123(U)" → "pedro123";
 * "(U) @pedro123" / "Pedro Garcia" / "pedro123 Garcia" / "@pedro123," / "unknown" → "".
 */
export function usernameKeyOf(text: string | null | undefined): string {
  const v = String(text ?? "");
  const m = KEY_EXACT.exec(v) ?? KEY_AT.exec(v) ?? KEY_NOTE.exec(v);
  const k = m ? m[1].toLowerCase() : "";
  return k === "unknown" ? "" : k;
}

// TikTok is saved as "no app" (NULL); an explicit "tiktok" counts too. Any other app never matches.
function platformOk(p: string | null | undefined): boolean {
  const v = String(p ?? "").trim().toLowerCase();
  return v === "" || v === "tiktok";
}

/**
 * The FINAL check, in the app: the record stands for exactly this username, TikTok / no app.
 * Newest "last updated" first (same time → by id, so the order never jumps) — the first one is used.
 */
export function matchLookupRows(rows: readonly ScanQrLookupRaw[], key: string): ScanQrLookupRow[] {
  if (!isLookupable(key)) return [];
  return rows
    .filter((r) => platformOk(r.platform) && usernameKeyOf(r.username) === key)
    .map((r) => ({ id: r.id, name: r.name, phone: r.phone, storeId: r.storeId, updatedAt: r.updatedAt }))
    .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.updatedAt < b.updatedAt ? 1 : -1));
}

/** This many DIFFERENT phones under one "username" = a word used for many buyers, not one person → nothing is filled. */
export const SCAN_QR_SHARED_PHONES = 3;

/** How many different phones these records have (digits only, so "0911 222 333" = "0911222333"; blank = not counted). Pure. */
export function distinctPhones(rows: readonly { phone: string }[]): number {
  const seen = new Set<string>();
  for (const r of rows) {
    const p = String(r.phone ?? "").trim();
    const digits = p.replace(/\D/g, "");
    if (p !== "") seen.add(digits !== "" ? digits : p);
  }
  return seen.size;
}

/**
 * The record the form is filled from: the newest one (rows are newest first) — or null when there is none, or when
 * the records have 3 or more different phones (then the scanned text is a word shared by many buyers). Pure.
 */
export function recordToFill(rows: readonly ScanQrLookupRow[]): ScanQrLookupRow | null {
  if (distinctPhones(rows) >= SCAN_QR_SHARED_PHONES) return null;
  return rows[0] ?? null;
}

/**
 * What the database is asked for: the shapes a record of this username can have. The app's own check
 * (matchLookupRows) decides afterwards — the database only narrows the candidates. Pure.
 */
export function lookupFilter(col: string, key: string): string {
  // key is [a-z0-9._] only (isLookupable) — nothing in it can change the filter.
  const plain = [`${key}`, `@${key}`, `@${key} %`, `@ ${key}`, `@ ${key} %`].map((p) => `${col}.ilike.${p}`);
  // a note that starts with "(" or "#" ("@key (…" and "@key #…" are already in "@key %"). These hold a
  // bracket, so each value is in double quotes.
  const note = [`${key} (%`, `${key}(%`, `${key} #%`, `${key}#%`, `@${key}(%`, `@${key}#%`, `@ ${key}(%`, `@ ${key}#%`].map((p) => `${col}.ilike."${p}"`);
  return [...plain, ...note].join(",");
}

/**
 * After a fill for `key`: does the text now in the username field still say that username? Yes when — without
 * the spaces and one "@" in front, in lower case — it starts with it and what follows is not a username
 * character: "pedro123", "@Pedro123", "pedro123 (U)", "pedro123(U)", "pedro123 #3". No for "pedro12",
 * "pedro1234", "maria88", "". Pure.
 */
export function sameUsernameTyped(text: string | null | undefined, key: string): boolean {
  if (key === "") return false;
  const v = String(text ?? "").replace(/^\s*@?\s*/, "").toLowerCase();
  if (!v.startsWith(key)) return false;
  const next = v.charAt(key.length);
  return next === "" || !/[a-z0-9._]/.test(next);
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * Every Customers record of this screen that stands for `handle`, newest first.
 * ok:false = could not be read (no sign-in, error, more than `timeoutMs`) — the screen then does nothing.
 * Never throws.
 */
export async function lookupCustomersByHandle(store: ScanQrLookupStore, handle: string, timeoutMs = SCAN_QR_LOOKUP_TIMEOUT_MS): Promise<ScanQrLookupResult> {
  const key = lookupKey(handle);
  if (!isLookupable(key)) return { ok: true, rows: [] };
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
      let q = sb.from(src.table)
        .select(`id, user_id, phone, name, store_id, ${src.col}, contact_platform, updated_at`)
        .eq("user_id", me)
        .or(lookupFilter(src.col, key))
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
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
      // A full page = not every record was seen → "could not read": never a false "none", and never a fill
      // from a list whose phones could not all be counted.
      if (got.length >= SCAN_QR_LOOKUP_LIMIT) return { ok: false };
      return { ok: true, rows };
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

// ── What the form remembers about a fill (kept with the ⇄ draft of its own screen only) ────────
export interface LookupFields { name: string; phone: string; store: string }
/** The lookup wrote these details for this username. Nothing of it is shown; it only lets a later scan take them back. */
export interface ScanQrLookupMark { handle: string; filled: LookupFields }

/** The fields a new scan must blank: written by the lookup and not touched since. Pure. */
export function untouchedFilled(mark: ScanQrLookupMark | null, cur: LookupFields): Partial<LookupFields> {
  const out: Partial<LookupFields> = {};
  if (!mark) return out;
  for (const k of ["name", "phone", "store"] as const) {
    if (mark.filled[k] !== "" && cur[k] === mark.filled[k]) out[k] = "";
  }
  return out;
}

/** On when the global switch is on OR this login is on the list. Off + not listed = exactly as before. */
export function scanQrLookupVisible(a: { switchOn: boolean; previewKey: boolean }): boolean {
  return a.switchOn === true || a.previewKey === true;
}

/** Put the cursor in `el` — unless the seller is typing in a field right now (never pull the cursor away). */
export function focusUnlessTyping(el: HTMLElement | null): void {
  if (!el || typeof document === "undefined") return;
  const a = document.activeElement as HTMLElement | null;
  if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
  try { el.focus(); } catch { /* not focusable now */ }
}
