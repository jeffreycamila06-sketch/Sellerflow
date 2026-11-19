// "Choose price before print" — a per-seller list of up to 6 prices + an ON/OFF switch.
// Stored the same way as "Same price for all items" (useSamePrice): ONE read of the
// seller_price_choices row (sql/180) per signed-in user + ONE upsert per change. ZERO polling.
//
// READY AT APP START: the last known { enabled, prices } of each user is kept in localStorage
// (written after every successful read / save) and is the FIRST state — a seller with the switch
// ON gets the pop-up from the first tap, before the database answers. Nothing ever waits for the
// read: with no saved copy the switch is simply OFF (today's 1-Click, zero delay).
//
//   enabled — the switch. Can never be ON with an empty list (setEnabled guards).
//   prices  — kept while OFF. First = the default (highlighted in the pop-up).
//   active  — enabled && prices.length > 0 → the pop-up asks before each 1-Click / pin print.
//             RedesignApp also requires "Same price" to be OFF (only one can be on).
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { log } from "../../lib/log";
import { normalizeSamePrice } from "./useSamePrice";

export const MAX_CHOICE_PRICES = 6;

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

// Same rule as Same price: blank / 0 / negative / not a number → null.
export const normalizeChoicePrice = normalizeSamePrice;

// Any stored value → a clean list: positive numbers only, no duplicates (first kept), max 6.
export function normalizePriceList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = normalizeChoicePrice(x);
    if (n == null || out.includes(n)) continue;
    out.push(n);
    if (out.length >= MAX_CHOICE_PRICES) break;
  }
  return out;
}

export type AddPriceResult = { ok: true; prices: number[] } | { ok: false; reason: "bad" | "dup" | "max" };

// Add a typed price at the END (the default stays the default).
export function addChoicePrice(list: number[], raw: unknown): AddPriceResult {
  const n = normalizeChoicePrice(raw);
  if (n == null) return { ok: false, reason: "bad" };
  if (list.includes(n)) return { ok: false, reason: "dup" };
  if (list.length >= MAX_CHOICE_PRICES) return { ok: false, reason: "max" };
  return { ok: true, prices: [...list, n] };
}

export function removeChoicePrice(list: number[], price: number): number[] {
  return list.filter((p) => p !== price);
}

// Make a price the default = move it to the front.
export function makeDefaultPrice(list: number[], price: number): number[] {
  if (!list.includes(price)) return list;
  return [price, ...list.filter((p) => p !== price)];
}

export function canEnableChoosePrice(list: number[]): boolean {
  return list.length > 0;
}

// ── The per-user saved copy (localStorage; every access try/catch) ────────────
export const choiceCacheKey = (uid: string) => `sfl_rd_choose_price:${uid}`;

export function readChoiceCache(uid: string | null | undefined): { enabled: boolean; prices: number[] } | null {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(choiceCacheKey(uid));
    if (!raw) return null;
    const v = JSON.parse(raw) as { enabled?: unknown; prices?: unknown };
    const prices = normalizePriceList(v?.prices);
    return { enabled: v?.enabled === true && canEnableChoosePrice(prices), prices };
  } catch { return null; }
}

export function writeChoiceCache(uid: string | null | undefined, enabled: boolean, prices: number[]): void {
  if (!uid) return;
  try { localStorage.setItem(choiceCacheKey(uid), JSON.stringify({ enabled, prices })); } catch { /* private mode / full — the read on the next open still answers */ }
}

export interface UseChoosePrice {
  enabled: boolean;
  prices: number[];
  active: boolean;
  loading: boolean;   // the database read has not answered yet (never blocks anything)
  // ON needs a non-empty list (the `prices` argument, else the saved list); OFF keeps the list.
  // Answers true when the change was kept, false when it was refused or the save failed.
  setEnabled: (on: boolean, prices?: number[]) => Promise<boolean>;
  // Change the list. Refused (false) when it would leave the switch ON with no price.
  setPrices: (prices: number[]) => Promise<boolean>;
  saveErrors: number; // bumps when a save fails; the value reverts
}

type St = { uid: string | null; enabled: boolean; prices: number[]; loading: boolean };
const startState = (uid: string | null): St => {
  const c = readChoiceCache(uid);
  return { uid, enabled: !!c?.enabled, prices: c?.prices ?? [], loading: !!uid && isSupabaseConfigured && !!supabase };
};

// userId = the signed-in user's id (null / undefined while signed out). A different user starts
// from THAT user's saved copy and is read again.
export function useChoosePrice(userId?: string | null): UseChoosePrice {
  const uid = userId || null;
  const [stored, setSt] = useState<St>(() => startState(uid));
  // The user changed → this render already shows the new user's saved copy (no frame of the old one).
  const st = stored.uid === uid ? stored : startState(uid);
  if (stored.uid !== uid) setSt(st);
  const [saveErrors, setSaveErrors] = useState(0);
  const patch = useCallback((forUid: string | null, p: Partial<St>) => setSt((s) => (s.uid === forUid ? { ...s, ...p } : s)), []);

  useEffect(() => {
    if (!uid || !isSupabaseConfigured || !supabase) return;
    let alive = true;
    void (async () => {
      const { data, error } = await supabase
        .from("seller_price_choices")
        .select("enabled,prices")
        .eq("user_id", uid)
        .maybeSingle();
      if (!alive) return;
      if (error) { patch(uid, { loading: false }); return; }   // keep the saved copy
      const list = normalizePriceList(data?.prices);
      const on = !!data?.enabled && canEnableChoosePrice(list);  // never ON with no price; no row = OFF
      writeChoiceCache(uid, on, list);
      patch(uid, { enabled: on, prices: list, loading: false });
    })();
    return () => { alive = false; };
  }, [uid, patch]); // ONE read per signed-in user — no interval/poll

  const persist = useCallback(async (nextEnabled: boolean, nextPrices: number[], prevEnabled: boolean, prevPrices: number[]): Promise<boolean> => {
    if (!uid) return false;                              // nobody signed in → nothing was saved
    if (!isSupabaseConfigured || !supabase) return true;
    const { error } = await supabase
      .from("seller_price_choices")
      .upsert({ user_id: uid, enabled: nextEnabled, prices: nextPrices, updated_at: new Date().toISOString() });
    if (error) {
      log.error("Choose-price save error:", error.message);
      patch(uid, { enabled: prevEnabled, prices: prevPrices }); // revert — the database is the source of truth
      setSaveErrors((c) => c + 1);
      return false;
    }
    writeChoiceCache(uid, nextEnabled, nextPrices);
    return true;
  }, [uid, patch]);

  const { enabled, prices } = st;
  const setEnabled = useCallback(async (on: boolean, next?: number[]) => {
    if (!uid) return false; // no signed-in user → nothing changes, nothing is saved
    const list = next !== undefined ? normalizePriceList(next) : prices;
    if (on && !canEnableChoosePrice(list)) return false; // blocked — the Settings screen asks for a price first
    patch(uid, { enabled: on, prices: list });
    return persist(on, list, enabled, prices);
  }, [uid, enabled, prices, persist, patch]);

  const setPrices = useCallback(async (next: number[]) => {
    if (!uid) return false; // no signed-in user → nothing changes, nothing is saved
    const list = normalizePriceList(next);
    if (enabled && !canEnableChoosePrice(list)) return false; // keep at least one price while ON
    patch(uid, { prices: list });
    return persist(enabled, list, enabled, prices);
  }, [uid, enabled, prices, persist, patch]);

  return { enabled, prices, active: enabled && canEnableChoosePrice(prices), loading: st.loading, setEnabled, setPrices, saveErrors };
}
