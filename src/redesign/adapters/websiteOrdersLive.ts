// Seller Website (audit 5) — new / updated website orders arrive by themselves while the app is open:
// Supabase Realtime on public.website_orders, OWN rows only (the filter is the seller's user id and
// the table's RLS lets a seller see only own rows). One channel per signed-in seller; it is removed
// on sign-out, when the user changes, and when the website feature is off. A burst of changes
// (e.g. an order + its receipt) is folded into one callback (1.5 s).
import { useEffect, useRef } from "react";
import { supabase } from "../../supabase";

export const WEBSITE_LIVE_DEBOUNCE_MS = 1500;
type RealtimeLike = {
  channel: (name: string) => { on: (...a: unknown[]) => { subscribe: () => unknown } };
  removeChannel: (ch: unknown) => unknown;
};

/** Subscribe; returns the unsubscribe. Pure wiring over an injectable client (tested with a fake). */
export function subscribeWebsiteOrders(client: RealtimeLike, userId: string, onChange: () => void, debounceMs = WEBSITE_LIVE_DEBOUNCE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; onChange(); }, debounceMs); };
  const ch = client
    .channel(`website-orders:${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "website_orders", filter: `user_id=eq.${userId}` }, fire)
    .subscribe();
  return () => { if (timer) clearTimeout(timer); timer = null; void client.removeChannel(ch); };
}

/** React hook: subscribed only while `enabled` (signed in + feature on) with a user id. */
export function useWebsiteOrdersLive(enabled: boolean, userId: string | null | undefined, onChange: () => void): void {
  const cb = useRef(onChange);
  useEffect(() => { cb.current = onChange; });
  useEffect(() => {
    if (!enabled || !userId || !supabase) return;
    return subscribeWebsiteOrders(supabase as unknown as RealtimeLike, userId, () => cb.current());
  }, [enabled, userId]);
}
