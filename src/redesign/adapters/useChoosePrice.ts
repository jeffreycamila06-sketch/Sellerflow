// "Choose price before print" — a per-seller list of up to 6 prices + an ON/OFF switch.
// Stored the same way as "Same price for all items" (useSamePrice): ONE read of the
// seller_price_choices row (sql/180) on mount + ONE upsert per change. ZERO polling.
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

export interface UseChoosePrice {
  enabled: boolean;
  prices: number[];
  active: boolean;
  loading: boolean;
  // ON needs a non-empty list (the `prices` argument, else the saved list); OFF keeps the list.
  setEnabled: (on: boolean, prices?: number[]) => Promise<void>;
  // Change the list. Refused (no-op) when it would leave the switch ON with no price.
  setPrices: (prices: number[]) => Promise<void>;
  saveErrors: number; // bumps when a save fails; the value reverts
}

export function useChoosePrice(): UseChoosePrice {
  const [enabled, setEnabledState] = useState(false);
  const [prices, setPricesState] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveErrors, setSaveErrors] = useState(0);

  const uid = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase) { if (alive) setLoading(false); return; }
      const id = await uid();
      if (!id) { if (alive) setLoading(false); return; }
      const { data, error } = await supabase
        .from("seller_price_choices")
        .select("enabled,prices")
        .eq("user_id", id)
        .maybeSingle();
      if (!alive) return;
      if (!error && data) {
        const list = normalizePriceList(data.prices);
        setPricesState(list);
        setEnabledState(!!data.enabled && canEnableChoosePrice(list)); // never ON with no price
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [uid]); // READ-ON-LOAD ONLY — no interval/poll

  const persist = useCallback(async (nextEnabled: boolean, nextPrices: number[], prevEnabled: boolean, prevPrices: number[]) => {
    if (!isSupabaseConfigured || !supabase) return;
    const id = await uid();
    if (!id) return;
    const { error } = await supabase
      .from("seller_price_choices")
      .upsert({ user_id: id, enabled: nextEnabled, prices: nextPrices, updated_at: new Date().toISOString() });
    if (error) {
      log.error("Choose-price save error:", error.message);
      setEnabledState(prevEnabled); setPricesState(prevPrices); // revert — the database is the source of truth
      setSaveErrors((c) => c + 1);
    }
  }, [uid]);

  const setEnabled = useCallback(async (on: boolean, next?: number[]) => {
    const list = next !== undefined ? normalizePriceList(next) : prices;
    if (on && !canEnableChoosePrice(list)) return; // blocked — the Settings screen asks for a price first
    const prevEnabled = enabled, prevPrices = prices;
    setEnabledState(on); setPricesState(list);
    await persist(on, list, prevEnabled, prevPrices);
  }, [enabled, prices, persist]);

  const setPrices = useCallback(async (next: number[]) => {
    const list = normalizePriceList(next);
    if (enabled && !canEnableChoosePrice(list)) return; // keep at least one price while ON
    const prevPrices = prices;
    setPricesState(list);
    await persist(enabled, list, enabled, prevPrices);
  }, [enabled, prices, persist]);

  return { enabled, prices, active: enabled && canEnableChoosePrice(prices), loading, setEnabled, setPrices, saveErrors };
}
