// "Same price for all items" — per-seller fixed unit price override. Follows the
// useRaffleConfig pattern: ONE read of the seller's seller_same_price row on mount
// + ONE upsert per Save/Clear. ZERO polling (egress rule). DB-backed so it works
// across phone + laptop; no auto-clear on a new session (the row persists until
// the seller taps Clear).
//
// Applied by RedesignApp at the order call sites (NOT inside the pure builder):
//   1-Click / Pin / Auto → price INPUT overridden to `samePrice` (builder does
//   total = samePrice * qty, so Auto qty N → samePrice × N). Enterprise → the
//   price field is PRE-FILLED with `samePrice` but a seller-typed price wins.
// When the override is absent (samePrice == null) every call passes its original
// price → buildOrderFromComment output is byte-identical.
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

// ── Pure helpers (no Supabase / React — unit-tested) ──────────────────────────

// Blank / 0 / negative / non-finite → null (feature OFF). A finite value > 0 is
// the fixed unit price. Kept generic (no integer coercion) so a ₱/€ decimal is fine.
export function normalizeSamePrice(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The price INPUT for a 1-Click / Pin / Auto order: the fixed price when set,
// otherwise the caller's base price (0 for 1-Click, the code price for Auto) →
// byte-identical to before when the override is absent.
export function effectiveOrderPrice(base: number, samePrice: number | null): number {
  return samePrice != null && samePrice > 0 ? samePrice : base;
}

// Enterprise price-field pre-fill: the fixed price as a string when set, else "".
// The seller can still type over it (a discount) and whatever they type wins.
export function entPrefill(samePrice: number | null): string {
  return samePrice != null && samePrice > 0 ? String(samePrice) : "";
}

export interface UseSamePrice {
  samePrice: number | null; // null = off (normal code/comment pricing)
  loading: boolean;         // initial row read in flight
  save: (v: unknown) => Promise<void>; // normalize + upsert; blank/0/negative = Clear
  clear: () => Promise<void>;
  // Bumps when a Save/Clear DB write fails. The optimistic value REVERTS (the DB is
  // the source of truth across devices); the UI watches this to show a notice.
  saveErrors: number;
}

export function useSamePrice(): UseSamePrice {
  const [samePrice, setSamePrice] = useState<number | null>(null); // default OFF (no row)
  const [loading, setLoading] = useState(true);
  const [saveErrors, setSaveErrors] = useState(0);

  // getSession() is LOCAL (no network) — same uid pattern as useRaffleConfig.
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
        .select("same_price")
        .eq("user_id", id)
        .maybeSingle();
      if (!active) return;
      if (!error && data) setSamePrice(normalizeSamePrice(data.same_price));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [uid]); // READ-ON-LOAD ONLY — no interval/poll

  const save = useCallback(async (v: unknown) => {
    const next = normalizeSamePrice(v);
    const prev = samePrice; // for the failure revert
    setSamePrice(next); // optimistic; local-only in sample mode
    if (!isSupabaseConfigured || !supabase) return;
    const id = await uid();
    if (!id) return;
    const { error } = await supabase
      .from("seller_same_price")
      .upsert({ user_id: id, same_price: next, updated_at: new Date().toISOString() });
    if (error) {
      console.error("Same-price save error:", error.message);
      setSamePrice(prev); // revert — the DB is the cross-device source of truth
      setSaveErrors((c) => c + 1);
    }
  }, [uid, samePrice]);

  const clear = useCallback(() => save(null), [save]);

  return { samePrice, loading, save, clear, saveErrors };
}
