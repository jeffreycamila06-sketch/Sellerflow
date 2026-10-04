// BUYER ALERT — Phase 1 (alerts only, 2026-10-04). During a live the Dashboard warns the
// seller on comment rows about:
//   red   — a buyer with ≥ BUYER_ALERT_RED_AT RETURNED parcels (minus the ones she forgave)
//   amber — a buyer with a parcel at a 7-11 whose pickup deadline is 0..3 days away (Asia/Taipei)
// Reminder only: no banners, no toasts, nothing on the order / print path.
//
// DATA: ONE SECURITY DEFINER RPC, buyer_alert_lookup() (sql/72), returns a map keyed by the
// normalised buyer handle. Loaded when the live starts, refreshed every 10 min. Each comment
// row is an O(1) Map lookup — never a query per comment.
//
// GATE: admin + emails starting with "budgetukay" (the pinToPrint rule). The RPC enforces the
// same rule server-side. Everyone else: the hook never calls the RPC and the Dashboard gets no
// map → byte-identical rows.
import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

// ⚠️ ONE-LINE SWITCH to public (flip v_public in sql/72 at the same time): every seller,
// each reading their OWN parcel_tracking rows instead of the test owner's.
export const BUYER_ALERT_PUBLIC = false;
// Test-phase data owner — the RPC reads THIS account's rows (pinned against sql/72 by a test).
export const BUYER_ALERT_DATA_OWNER_EMAIL = "googletest@gmail.com";
export const BUYER_ALERT_RED_AT = 3;          // returns (after forgive) for the red alert
export const BUYER_ALERT_NEAR_DAYS = 3;       // amber: 0..3 days to the pickup deadline
export const BUYER_ALERT_REFRESH_MS = 10 * 60 * 1000;

export function buyerAlertAllowed(email: string | undefined | null, role?: string | null): boolean {
  if (BUYER_ALERT_PUBLIC) return true;
  if (String(role || "").trim().toLowerCase() === "admin") return true;
  return String(email || "").trim().toLowerCase().startsWith("budgetukay");
}

// trim → strip ONE leading "@" → lowercase. Same as sql/72. Exact match only.
export const normHandle = (h: string | null | undefined): string =>
  String(h ?? "").trim().replace(/^@/, "").toLowerCase();

// ── Taipei calendar math (UTC+8, no DST) ─────────────────────────────────────
const DAY_MS = 86_400_000;
export const taipeiDate = (nowMs: number): string => new Date(nowMs + 8 * 3_600_000).toISOString().slice(0, 10);
export function daysLeft(deadline: string, nowMs: number): number | null {
  const d = Date.parse(`${String(deadline).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d)) return null;
  return Math.round((d - Date.parse(`${taipeiDate(nowMs)}T00:00:00Z`)) / DAY_MS);
}

// ── Shapes ───────────────────────────────────────────────────────────────────
export interface BuyerReturn { id: string; returnedAt: string | null; store: string; amount: number | null; forgiven: boolean }
export interface BuyerRecord { returned: BuyerReturn[]; near: { store: string; deadline: string }[]; atStore: number; pickedUp: number }
export type BuyerAlertData = Map<string, BuyerRecord>;
export interface BuyerAlertView { returns: number; red: boolean; near: { days: number; store: string } | null }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

// RPC jsonb → Map. Defensive: anything malformed is dropped, never thrown.
export function parseLookup(data: unknown): BuyerAlertData {
  const out: BuyerAlertData = new Map();
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [h, raw] of Object.entries(data as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const key = normHandle(h);
    if (!key) continue;
    out.set(key, {
      returned: arr(r.returned).filter((x) => typeof x.id === "string").map((x) => ({
        id: x.id as string, returnedAt: typeof x.returned_at === "string" ? x.returned_at : null,
        store: String(x.store ?? ""), amount: x.amount == null ? null : num(x.amount), forgiven: x.forgiven === true,
      })),
      near: arr(r.near).filter((x) => typeof x.deadline === "string").map((x) => ({ store: String(x.store ?? ""), deadline: x.deadline as string })),
      atStore: num(r.at_store), pickedUp: num(r.picked_up),
    });
  }
  return out;
}

export const isForgiven = (r: BuyerReturn, overrides: Record<string, boolean>): boolean =>
  r.id in overrides ? overrides[r.id] : r.forgiven;

export function viewFor(rec: BuyerRecord, overrides: Record<string, boolean>, nowMs: number): BuyerAlertView {
  const returns = rec.returned.filter((r) => !isForgiven(r, overrides)).length;
  let near: BuyerAlertView["near"] = null;
  for (const n of rec.near) {               // recomputed with the device clock → right across midnight
    const d = daysLeft(n.deadline, nowMs);
    if (d === null || d < 0 || d > BUYER_ALERT_NEAR_DAYS) continue;
    if (!near || d < near.days) near = { days: d, store: n.store };
  }
  return { returns, red: returns >= BUYER_ALERT_RED_AT, near };
}

// One pass over the lookup (NOT over the comments). Rows then do views.get(normHandle(handle)).
export function buildViews(data: BuyerAlertData, overrides: Record<string, boolean>, nowMs: number): Map<string, BuyerAlertView> {
  const out = new Map<string, BuyerAlertView>();
  for (const [h, rec] of data) out.set(h, viewFor(rec, overrides, nowMs));
  return out;
}

export async function loadBuyerAlertLookup(): Promise<BuyerAlertData | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("buyer_alert_lookup");
    return error ? null : parseLookup(data);
  } catch { return null; }
}

async function writeForgive(id: string, on: boolean): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const t = supabase.from("buyer_alert_forgive");
    const { error } = on ? await t.insert({ parcel_tracking_id: id }) : await t.delete().eq("parcel_tracking_id", id);
    return !error || (on && error.code === "23505"); // already forgiven = done
  } catch { return false; }
}

// allowed = gate; live = a comment source is connected. Off → no RPC, views undefined.
export function useBuyerAlert(allowed: boolean, live: boolean) {
  const [data, setData] = useState<BuyerAlertData | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!allowed || !live) return;
    let alive = true;
    const load = async () => {
      const m = await loadBuyerAlertLookup();
      if (alive && m) { setData(m); setNowMs(Date.now()); }
    };
    void load();
    const iv = setInterval(() => void load(), BUYER_ALERT_REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [allowed, live]);
  const views = useMemo(() => (allowed && data ? buildViews(data, overrides, nowMs) : undefined), [allowed, data, overrides, nowMs]);
  // Optimistic; reverted when the write fails. Returns whether it saved.
  const setForgiven = useCallback(async (id: string, on: boolean) => {
    let prev: boolean | undefined;
    setOverrides((o) => { prev = o[id]; return { ...o, [id]: on }; });
    const ok = await writeForgive(id, on);
    if (!ok) setOverrides((o) => { const n = { ...o }; if (prev === undefined) delete n[id]; else n[id] = prev; return n; });
    return ok;
  }, []);
  return { data: allowed ? data : null, views, overrides, nowMs, setForgiven };
}
