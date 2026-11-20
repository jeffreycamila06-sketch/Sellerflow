// BLACKLIST (sellers outside Taiwan, sql/190) — the seller's OWN list of buyers who did not check out
// or returned an item. On the live comment rows it is a reminder only: a red tint + a chip with the
// counts. It never touches order creation, printing or buyer numbers (the live row only READS a map).
//
// Data: table buyer_blacklist (own rows only, no update). Read when a live starts, when the Blacklist
// screen opens and after the seller adds / removes — NO timer. Add = blacklist_add() (the database makes
// the "Already added today" rule from the phone's time zone); Undo = delete that one row; Remove =
// blacklist_remove() (every row of that buyer).
//
// Exact match only:
//   TikTok   = the username, trimmed, ONE leading "@" removed, any case;
//   Facebook = the name, trimmed, any case (otherwise exactly as written).
// Same rule as sql/190 buyer_blacklist_key().
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { fetchAllPages } from "../../lib/fetchAllPages";
import { tpl, type RedesignT } from "../i18n";

export type BlPlatform = "tiktok" | "facebook";
export type BlReason = "not_checked_out" | "returned";
export const BL_REASONS: readonly BlReason[] = ["not_checked_out", "returned"];
export const BL_LABEL_MAX = 100;
export const BL_PAGE = 1000;

export interface BlRow { id: string; platform: BlPlatform; label: string; reason: BlReason; day: string; createdAt: string }
export interface BlEntry {
  key: string;            // blacklistKey(platform, label)
  platform: BlPlatform;
  label: string;          // as shown (newest row's spelling; TikTok without the "@")
  returned: number;
  notCheckedOut: number;
  lastDay: string;        // YYYY-MM-DD of the newest row
  lastAt: string;         // created_at of the newest row
  rows: BlRow[];          // newest first
}

// ── the rules (pure) ─────────────────────────────────────────────────────────
const trimAll = (s: unknown): string => String(s ?? "").trim();

// What is saved as the label: trimmed; TikTok also loses ONE leading "@".
export function blacklistLabel(platform: BlPlatform, raw: unknown): string {
  const s = trimAll(raw);
  return platform === "tiktok" ? s.replace(/^@/, "").trim() : s;
}
export function blacklistKey(platform: BlPlatform, raw: unknown): string {
  return blacklistLabel(platform, raw).toLowerCase();
}
// The Add button: something to save, not too long, a TikTok username has no spaces.
export function blacklistInputProblem(platform: BlPlatform, raw: unknown): "empty" | "space" | "long" | null {
  const l = blacklistLabel(platform, raw);
  if (!l) return "empty";
  if (l.length > BL_LABEL_MAX) return "long";
  if (platform === "tiktok" && /\s/.test(l)) return "space";
  return null;
}
export const displayBuyer = (platform: BlPlatform, label: string): string => (platform === "tiktok" ? `@${label}` : label);

// STRICT QR reader (the blacklist only — Parcel Scan keeps src/lib/tiktokHandle.ts unchanged):
// a TikTok PROFILE link (what the sticker prints: https://tiktok.com/@name, with or without https / www / m,
// nothing after the name but "/", "?…" or "#…"), or a text that starts with "@". Anything else → null
// ("This QR has no buyer"): a plain word, another site, a TikTok video or short link, a sentence.
export function blacklistHandleFromQr(raw: unknown): string | null {
  const s = trimAll(raw);
  if (!s) return null;
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i);
  if (url) return url[1];
  const at = s.match(/^@([A-Za-z0-9._]{1,30})$/);
  if (at) return at[1];
  return null;
}

const asPlatform = (v: unknown): BlPlatform | null => (v === "tiktok" || v === "facebook" ? v : null);
const asReason = (v: unknown): BlReason | null => (v === "returned" || v === "not_checked_out" ? v : null);

export function parseBlRows(data: unknown): BlRow[] {
  if (!Array.isArray(data)) return [];
  const out: BlRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const platform = asPlatform(r.platform), reason = asReason(r.reason);
    const label = trimAll(r.buyer_label);
    if (!platform || !reason || !label || typeof r.id !== "string") continue;
    out.push({ id: r.id, platform, reason, label, day: String(r.added_day ?? "").slice(0, 10), createdAt: String(r.created_at ?? "") });
  }
  return out;
}

const newer = (a: BlRow, b: BlRow): number => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);

// One entry per buyer (platform + key), newest buyer first; each entry's rows newest first.
export function groupBlacklist(rows: readonly BlRow[]): BlEntry[] {
  const by = new Map<string, BlRow[]>();
  for (const r of rows) {
    const k = `${r.platform}:${blacklistKey(r.platform, r.label)}`;
    const list = by.get(k);
    if (list) list.push(r); else by.set(k, [r]);
  }
  const out: BlEntry[] = [];
  for (const list of by.values()) {
    list.sort(newer);
    const top = list[0];
    out.push({
      key: blacklistKey(top.platform, top.label), platform: top.platform, label: top.label,
      returned: list.filter((r) => r.reason === "returned").length,
      notCheckedOut: list.filter((r) => r.reason === "not_checked_out").length,
      lastDay: top.day, lastAt: top.createdAt, rows: list,
    });
  }
  out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return out;
}

export function filterBlacklist(entries: readonly BlEntry[], q: string): BlEntry[] {
  const n = trimAll(q).replace(/^@/, "").toLowerCase();
  if (!n) return [...entries];
  return entries.filter((e) => e.key.includes(n));
}

export type BlMap = Map<string, BlEntry>;
export const blMapKey = (platform: BlPlatform, key: string): string => `${platform}:${key}`;
export function blacklistMap(entries: readonly BlEntry[]): BlMap {
  const m: BlMap = new Map();
  for (const e of entries) m.set(blMapKey(e.platform, e.key), e);
  return m;
}

// The live row: TikTok comment → its @username; Facebook comment → the commenter's name. Every other
// platform (Instagram, Shopee, …) and a Facebook "Unknown" name → never on the list. O(1).
export function blacklistForComment(map: BlMap | undefined | null, c: { platform?: string | null; name?: string | null; handle?: string | null }): BlEntry | null {
  if (!map || map.size === 0) return null;
  const p = String(c.platform ?? "").trim().toLowerCase();
  if (p === "tiktok") {
    const k = blacklistKey("tiktok", c.handle);
    return k ? map.get(blMapKey("tiktok", k)) ?? null : null;
  }
  if (p === "facebook") {
    const name = trimAll(c.name);
    if (!name || name === "Unknown") return null;
    return map.get(blMapKey("facebook", blacklistKey("facebook", name))) ?? null;
  }
  return null;
}

// "2× Return · 1× Not checked out" — Return first, a reason with 0 left out. Words come from the caller.
export function blacklistCountsText(e: Pick<BlEntry, "returned" | "notCheckedOut">, w: { cnt: (n: number, reason: string) => string; ret: string; notOut: string }): string {
  return [e.returned ? w.cnt(e.returned, w.ret) : "", e.notCheckedOut ? w.cnt(e.notCheckedOut, w.notOut) : ""].filter(Boolean).join(" · ");
}

// The live-row chip text in the app language: "2× Return · 1× Not checked out".
export function blacklistChipText(e: Pick<BlEntry, "returned" | "notCheckedOut">, t: RedesignT): string {
  return blacklistCountsText(e, { cnt: (n, reason) => tpl(t.rd_bl_cnt, { n, reason }), ret: t.rd_bl_ret_short, notOut: t.rd_bl_not_out_short });
}

// A saved day (YYYY-MM-DD, the seller's own calendar day) in the app language: "Nov 18" / "Nov 18, 2026".
// Read as a UTC date so no time zone can move it to another day.
export function formatBlacklistDay(day: string, lang: string, withYear = false): string {
  const ms = Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ms)) return "—";
  const tag = lang === "fil" ? "fil-PH" : lang;
  try {
    return new Intl.DateTimeFormat(tag, { timeZone: "UTC", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : null) }).format(ms);
  } catch {
    return String(day).slice(0, 10);
  }
}

// Who sees Blacklist: never Taiwan (the market; an admin's "all markets" view counts as outside), and
// then the switch (every plan), an admin, or a tester login (feature key "blacklist").
export function blacklistVisible(a: { country: string | null | undefined; adminUnion: boolean; switchOn: boolean; isAdmin: boolean; hasKey: boolean }): boolean {
  const outsideTaiwan = a.adminUnion || String(a.country ?? "").trim().toUpperCase() !== "TW";
  return outsideTaiwan && (a.switchOn || a.isAdmin || a.hasKey);
}

// The "NEW" badge on the Settings tile: until the seller opens Blacklist once on this phone.
export const BL_SEEN_KEY = "sfl_rd_blacklist_seen";
export function blacklistSeen(): boolean {
  try { return localStorage.getItem(BL_SEEN_KEY) === "1"; } catch { return false; }
}
export function markBlacklistSeen(): void {
  try { localStorage.setItem(BL_SEEN_KEY, "1"); } catch { /* per-phone convenience only */ }
}

export function localTimeZone(): string | null {
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z ? String(z) : null; } catch { return null; }
}

// ── reads / writes (never throw) ─────────────────────────────────────────────
export async function loadBlacklist(): Promise<BlRow[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const sb = supabase;
  try {
    const all = await fetchAllPages<Record<string, unknown>>(async (page) => {
      const { data, error } = await sb.from("buyer_blacklist")
        .select("id,platform,buyer_label,reason,added_day,created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(page * BL_PAGE, page * BL_PAGE + BL_PAGE - 1);
      return error || !Array.isArray(data) ? null : (data as Record<string, unknown>[]);
    }, BL_PAGE);
    return all === null ? null : parseBlRows(all);
  } catch {
    return null;
  }
}

export type BlAddResult = { kind: "added"; id: string; day: string } | { kind: "already"; day: string } | { kind: "error" };
export async function addToBlacklist(platform: BlPlatform, rawLabel: string, reason: BlReason, tz: string | null = localTimeZone()): Promise<BlAddResult> {
  if (!isSupabaseConfigured || !supabase) return { kind: "error" };
  if (blacklistInputProblem(platform, rawLabel)) return { kind: "error" };
  try {
    const { data, error } = await supabase.rpc("blacklist_add", { p_platform: platform, p_label: blacklistLabel(platform, rawLabel), p_reason: reason, p_tz: tz });
    if (error || !data || typeof data !== "object") return { kind: "error" };
    const d = data as Record<string, unknown>;
    if (d.result === "added" && typeof d.id === "string") return { kind: "added", id: d.id, day: String(d.day ?? "") };
    if (d.result === "already_today") return { kind: "already", day: String(d.day ?? "") };
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}
export async function undoBlacklistAdd(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;
  try {
    const { data, error } = await supabase.from("buyer_blacklist").delete().eq("id", id).select("id");
    return !error && Array.isArray(data) && data.length === 1;
  } catch {
    return false;
  }
}
export async function removeFromBlacklist(platform: BlPlatform, label: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.rpc("blacklist_remove", { p_platform: platform, p_label: label });
    return !error;
  } catch {
    return false;
  }
}

// ── the hook (RedesignApp) ───────────────────────────────────────────────────
// allowed = blacklistVisible(...); live = a live is connected (any platform). The list is read when a
// live STARTS (false → true), when the screen asks (reload) and after every add / undo / remove. No timer.
export function useBlacklist(allowed: boolean, live: boolean, userId: string) {
  const [rows, setRows] = useState<BlRow[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(async (): Promise<boolean> => {
    if (!allowed) return false;
    const my = ++seq.current;
    setLoading(true);
    const r = await loadBlacklist();
    if (my !== seq.current) return r !== null;
    setLoading(false);
    if (r === null) { setError(true); return false; }
    setError(false);
    setRows(r);
    return true;
  }, [allowed]);
  // a new user / the gate closing forgets the list (state reset during render; an older read is ignored)
  const scope = `${userId}|${allowed ? 1 : 0}`;
  const [seenScope, setSeenScope] = useState(scope);
  if (seenScope !== scope) { setSeenScope(scope); setRows(null); setError(false); setLoading(false); }
  useEffect(() => { seq.current++; }, [scope]);
  // read at live start (the rising edge only; a gate that opens while a live runs counts as a start)
  const wasLive = useRef(false);
  useEffect(() => {
    const on = allowed && live;
    const rise = on && !wasLive.current;
    wasLive.current = on;
    if (rise) void reload();
  }, [live, allowed, reload]);
  const add = useCallback(async (platform: BlPlatform, label: string, reason: BlReason): Promise<BlAddResult> => {
    if (!allowed) return { kind: "error" };
    const r = await addToBlacklist(platform, label, reason);
    if (r.kind === "added") void reload();
    return r;
  }, [allowed, reload]);
  const undo = useCallback(async (id: string): Promise<boolean> => {
    if (!allowed) return false;
    const ok = await undoBlacklistAdd(id);
    if (ok) void reload();
    return ok;
  }, [allowed, reload]);
  const remove = useCallback(async (entry: Pick<BlEntry, "platform" | "label">): Promise<boolean> => {
    if (!allowed) return false;
    const ok = await removeFromBlacklist(entry.platform, entry.label);
    if (ok) void reload();
    return ok;
  }, [allowed, reload]);
  const entries = useMemo(() => (allowed && rows ? groupBlacklist(rows) : []), [allowed, rows]);
  const map = useMemo(() => (allowed && rows ? blacklistMap(entries) : undefined), [allowed, rows, entries]);
  return { rows: allowed ? rows : null, entries, map, error: allowed && error, loading: allowed && loading, reload, add, undo, remove };
}
