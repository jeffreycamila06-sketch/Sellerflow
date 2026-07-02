// Raffle Roleta (Games) — Phase 1 config hook. Follows the useSessionWindow
// pattern: ONE read of the user's raffle_config row on mount + ONE upsert per
// toggle. ZERO polling (egress rule). Entries are NOT computed here (Phase 2) —
// this hook owns only the DB-backed on/off state + the enabled_at anchor, so the
// raffle survives an app close / break mid-live.
//
// Imports only the shared supabase singleton — does NOT touch useLiveSession /
// useOrders / useLiveFeed. Sample/unauthed mode: the toggle still flips local
// state (preview-friendly) but skips the DB write.
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

export interface UseRaffleConfig {
  enabled: boolean;
  enabledAt: string | null; // ISO timestamp when collecting started (null = off)
  loading: boolean;         // initial row read in flight
  toggle: (on: boolean) => Promise<void>;
}

export function useRaffleConfig(): UseRaffleConfig {
  const [enabled, setEnabled] = useState(false); // default OFF (no row = off)
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // getSession() is LOCAL (no network) — same uid pattern as useSessionWindow.
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
        .from("raffle_config")
        .select("enabled,enabled_at")
        .eq("user_id", id)
        .maybeSingle();
      if (!active) return;
      if (!error && data) {
        setEnabled(!!data.enabled);
        setEnabledAt((data.enabled_at as string) || null);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [uid]); // READ-ON-LOAD ONLY — no interval/poll

  const toggle = useCallback(async (on: boolean) => {
    const at = on ? new Date().toISOString() : null;
    setEnabled(on); setEnabledAt(at); // optimistic; local-only in sample mode
    if (!isSupabaseConfigured || !supabase) return;
    const id = await uid();
    if (!id) return;
    await supabase
      .from("raffle_config")
      .upsert({ user_id: id, enabled: on, enabled_at: at, updated_at: new Date().toISOString() });
  }, [uid]);

  return { enabled, enabledAt, loading, toggle };
}
