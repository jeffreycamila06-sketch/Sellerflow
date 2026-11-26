// Admin → Controls → "Receipt add-on" (sql/223). The add-on = an enabled fb_receipt_access row: the
// Messenger receipt for that seller. It has no date and no price of its own — it ends when the
// seller's plan ends (plan_expiry). Every call goes through an is_admin()-checked function; a seller
// who is not admin gets [] / not_admin. Every call answers (never throws).
import { createContext, useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { planDaysLeft } from "../../lib/planWindow";

export interface ReceiptAddon {
  userId: string;
  email: string;
  shop: string | null;
  plan: string;
  planStatus: string;
  planExpiry: string | null;
  since: string | null;
  note: string;
}
export type AddonResult = "added" | "enabled" | "already" | "removed" | "not_enabled" | "not_found" | "not_admin" | "error";

const client = () => (isSupabaseConfigured && supabase ? supabase : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** The rows of admin_receipt_addon_list() → ReceiptAddon[]; anything that is not a row is dropped. PURE. */
export function addonsFromRpc(data: unknown): ReceiptAddon[] {
  if (!Array.isArray(data)) return [];
  const out: ReceiptAddon[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || !str(r.user_id)) continue;
    out.push({
      userId: str(r.user_id), email: str(r.email), shop: strOrNull(r.shop), plan: str(r.plan),
      planStatus: str(r.plan_status), planExpiry: strOrNull(r.plan_expiry), since: strOrNull(r.since), note: str(r.note),
    });
  }
  return out;
}

/** → the list, or null when it could not be read. */
export async function loadReceiptAddons(): Promise<ReceiptAddon[] | null> {
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("admin_receipt_addon_list");
    if (error || !Array.isArray(data)) return null;
    return addonsFromRpc(data);
  } catch { return null; }
}

const resultOf = (data: unknown): AddonResult => {
  const x = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (x.ok === true) {
    const r = str(x.result);
    return (["added", "enabled", "already", "removed", "not_enabled"] as const).find((k) => k === r) ?? "error";
  }
  const e = str(x.error);
  return e === "not_found" || e === "not_admin" ? e : "error";
};

/** on = add (or turn a removed one back on) · off = remove (the row is kept, enabled false). */
export async function setReceiptAddon(email: string, on: boolean, note?: string): Promise<AddonResult> {
  const sb = client(); if (!sb) return "error";
  try {
    const { data, error } = await sb.rpc("admin_receipt_addon_set", { p_email: email, p_on: on, p_note: note ?? null });
    return error ? "error" : resultOf(data);
  } catch { return "error"; }
}

export async function setReceiptAddonNote(userId: string, note: string): Promise<boolean> {
  const sb = client(); if (!sb) return false;
  try {
    const { data, error } = await sb.rpc("admin_receipt_addon_note", { p_user: userId, p_note: note });
    return !error && !!data && (data as { ok?: unknown }).ok === true;
  } catch { return false; }
}

/** Amber when the plan (and so the add-on) ends in under 7 days, or has ended. No end date = never. PURE. */
export const ADDON_WARN_DAYS = 7;
export function addonEndsSoon(planExpiry: string | null, now: number = Date.now()): boolean {
  if (!planExpiry) return false;
  const d = planDaysLeft(planExpiry, now);
  return Number.isFinite(d) && d < ADDON_WARN_DAYS;
}
export function addonEnded(planExpiry: string | null, now: number = Date.now()): boolean {
  if (!planExpiry) return false;
  const t = Date.parse(planExpiry);
  return Number.isFinite(t) && t <= now;
}

/** Search by shop or email (contains, any case). Empty search = everyone. PURE. */
export function filterAddons(list: ReceiptAddon[], q: string): ReceiptAddon[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((a) => a.email.toLowerCase().includes(s) || (a.shop || "").toLowerCase().includes(s));
}

/** Lower-cased emails of the sellers who have the add-on — for the "+ Receipt" badge in the other
 *  admin lists. Provided by AdminPanel; null outside it (no badge). */
export const ReceiptAddonCtx = createContext<ReadonlySet<string> | null>(null);
export const addonEmailSet = (list: ReceiptAddon[]): ReadonlySet<string> => new Set(list.map((a) => a.email.trim().toLowerCase()).filter(Boolean));

export type AddonListState = "idle" | "loading" | "ready" | "error";
/** One read when `enabled` turns on (an admin panel opens), and again on reload(). No timer. */
export function useReceiptAddons(enabled: boolean): { list: ReceiptAddon[]; state: AddonListState; reload: () => void } {
  const [list, setList] = useState<ReceiptAddon[]>([]);
  const [state, setState] = useState<AddonListState>("idle");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Promise.resolve().then(() => { if (live) setState((s) => (s === "ready" ? s : "loading")); });
    void loadReceiptAddons().then((r) => {
      if (!live) return;
      if (r) { setList(r); setState("ready"); } else setState("error");
    });
    return () => { live = false; };
  }, [enabled, tick]);
  return { list, state, reload };
}
