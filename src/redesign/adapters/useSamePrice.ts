// "Same price for all items" — per-seller fixed unit price, as an ON/OFF toggle
// with a REMEMBERED price. Follows the useRaffleConfig pattern: ONE read of the
// seller_same_price row on mount + ONE upsert per change. ZERO polling. DB-backed
// so it works across phone + laptop; no auto-clear on a new session.
//
//   enabled  — the toggle. The override applies ONLY when enabled AND price > 0.
//   price    — remembered even while OFF, so the next ON is one tap. Editing the
//              price while ON saves immediately (blur/Enter). The toggle can never
//              be ON with a blank/0 price (setEnabled guards; the UI shows a hint).
//   active   — enabled && price > 0 ? price : null — the value RedesignApp applies
//              to the order price INPUT (1-Click / Pin / Auto) and pre-fills into
//              Enterprise. When null, every order keeps its own price → the pure
//              builder (buildOrderFromComment) output is byte-identical.
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

// ── Pure helpers (no Supabase / React — unit-tested) ──────────────────────────

// Blank / 0 / negative / non-finite → null. A finite value > 0 is the price
// (generic — a ₱/€ decimal is fine).
export function normalizeSamePrice(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A price the toggle can be turned ON with.
export function canEnableSamePrice(price: number | null): boolean {
  return price != null && price > 0;
}

// The active override: only when enabled AND the price is valid.
export function activeSamePrice(enabled: boolean, price: number | null): number | null {
  return enabled && canEnableSamePrice(price) ? price : null;
}

// The price INPUT for a 1-Click / Pin / Auto order: the active fixed price when
// set, else the caller's base (0 for 1-Click, the code price for Auto) →
// byte-identical to before when the override is inactive.
export function effectiveOrderPrice(base: number, active: number | null): number {
  return active != null && active > 0 ? active : base;
}

// Enterprise price-field pre-fill: the active price as a string, else "".
export function entPrefill(active: number | null): string {
  return active != null && active > 0 ? String(active) : "";
}

export interface UseSamePrice {
  enabled: boolean;
  price: number | null;   // remembered price (persists across OFF)
  active: number | null;  // enabled && price > 0 ? price : null (the override value)
  loading: boolean;
  // Toggle. `draft` lets the switch commit a typed-but-not-yet-blurred price.
  // Turning ON with no valid price is a no-op (the UI shows "Enter a price first").
  setEnabled: (on: boolean, draft?: unknown) => Promise<void>;
  // Edit the price (blur/Enter). Saves immediately; a blank/0 value also forces OFF
  // (the toggle can't stay ON without a price).
  setPrice: (v: unknown) => Promise<void>;
  // Bumps when a DB write fails; the optimistic value REVERTS (the DB is the
  // cross-device source of truth). The UI watches this to show a notice.
  saveErrors: number;
}

export function useSamePrice(): UseSamePrice {
  const [enabled, setEnabledState] = useState(false);
  const [price, setPriceState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveErrors, setSaveErrors] = useState(0);

  const uid = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase) { if (active) setLoading(false); return; }
      const id = await uid();
      if (!id) { if (active) setLoading(false); return; }
      const { data, error } = await supabase
        .from("seller_same_price")
        .select("enabled,same_price")
        .eq("user_id", id)
        .maybeSingle();
      if (!active) return;
      if (!error && data) {
        const p = normalizeSamePrice(data.same_price);
        setPriceState(p);
        setEnabledState(!!data.enabled && canEnableSamePrice(p)); // never ON without a price
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [uid]); // READ-ON-LOAD ONLY — no interval/poll

  const persist = useCallback(async (nextEnabled: boolean, nextPrice: number | null, prevEnabled: boolean, prevPrice: number | null) => {
    if (!isSupabaseConfigured || !supabase) return;
    const id = await uid();
    if (!id) return;
    const { error } = await supabase
      .from("seller_same_price")
      .upsert({ user_id: id, enabled: nextEnabled, same_price: nextPrice, updated_at: new Date().toISOString() });
    if (error) {
      console.error("Same-price save error:", error.message);
      setEnabledState(prevEnabled); setPriceState(prevPrice); // revert — DB is source of truth
      setSaveErrors((c) => c + 1);
    }
  }, [uid]);

  const setPrice = useCallback(async (v: unknown) => {
    const p = normalizeSamePrice(v);
    const nextEnabled = enabled && canEnableSamePrice(p); // clearing the price forces OFF
    const prevEnabled = enabled, prevPrice = price;
    setPriceState(p); setEnabledState(nextEnabled); // optimistic
    await persist(nextEnabled, p, prevEnabled, prevPrice);
  }, [enabled, price, persist]);

  const setEnabled = useCallback(async (on: boolean, draft?: unknown) => {
    const p = draft !== undefined ? normalizeSamePrice(draft) : price;
    if (on && !canEnableSamePrice(p)) return; // blocked — UI shows "Enter a price first"
    const prevEnabled = enabled, prevPrice = price;
    setEnabledState(on); if (draft !== undefined) setPriceState(p); // optimistic
    await persist(on, p, prevEnabled, prevPrice);
  }, [enabled, price, persist]);

  return { enabled, price, active: activeSamePrice(enabled, price), loading, setEnabled, setPrice, saveErrors };
}
