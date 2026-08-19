// EXPLICIT SESSION MODEL — session lifecycle (sub-step 2). Owns the new
// current_session_id / server-authoritative ended-check, ISOLATED from the old
// useSessionWindow (which still drives numbering + feed loading this step — the
// cutover is a later step). READ-ON-LOAD + on-demand RPCs only; ZERO poll.
//
// Server-authoritative by design (owner lock: the ended-check must NOT use the
// device clock): session_status() computes running/ended entirely server-side
// (server now() at Asia/Taipei), start_session() stamps the start with server
// now(). Both RPCs are own-scoped (auth.uid()); see sql/21.
//
// This adapter DOES NOT touch window_start / window_days / buyer_number / order
// loading. It only: (a) tells Connect whether a session is running, (b) creates a
// new session on pick, (c) exposes current_session_id for stamping new orders.
import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

export interface SessionStatus { running: boolean; sessionId: string | null }

// PURE — the failure fallback. On an RPC error we must NOT fall back to the
// device clock (owner lock). The safe, no-reset degradation: if we already know a
// current_session_id (from the mount read or a prior create), RESUME it
// (running=true) — matches the locked decision "a session that ends mid-selling
// continues until the seller explicitly re-Connects"; resuming never resets buyer#.
// Only when there is genuinely nothing to resume do we report not-running (→ the
// picker), because there is no session to continue. Unit-tested.
export function statusFallback(knownSessionId: string | null): SessionStatus {
  return knownSessionId ? { running: true, sessionId: knownSessionId } : { running: false, sessionId: null };
}

export interface UseSessionInstance {
  currentSessionId: string | null;         // for stamping new orders (sql/20)
  loaded: boolean;                          // mount read resolved
  checkStatus: () => Promise<SessionStatus>; // server-authoritative running/ended check (call on Connect)
  startSession: (days: number) => Promise<string | null>; // create a NEW session; returns its id (null on failure)
}

export function useSessionInstance(enabled: boolean): UseSessionInstance {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Synchronous mirror so checkStatus/startSession see the latest id without
  // waiting for a re-render (mirrors the useSessionWindow ref pattern).
  const idRef = useRef<string | null>(null);
  const setId = useCallback((id: string | null) => { idRef.current = id; setCurrentSessionId(id); }, []);

  // getSession() is LOCAL (no network) — keeps the mount read egress-minimal.
  const uid = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }, []);

  // Mount read: current_session_id only (one tiny row). No status/ended compute
  // here — that needs server "today", which we fetch on Connect via checkStatus.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!enabled || !isSupabaseConfigured || !supabase) { if (active) setLoaded(true); return; }
      const id = await uid();
      if (!id) { if (active) setLoaded(true); return; }
      const { data, error } = await supabase
        .from("seller_session_config")
        .select("current_session_id")
        .eq("user_id", id)
        .maybeSingle();
      if (!active) return;
      if (!error) setId((data?.current_session_id as string) || null);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [enabled, uid, setId]);

  // Server-authoritative ended-check (call on Connect). Returns running + id.
  // On any RPC failure → statusFallback (resume if we know an id; never the device
  // clock). On running=true, syncs currentSessionId to the server's id.
  const checkStatus = useCallback(async (): Promise<SessionStatus> => {
    if (!isSupabaseConfigured || !supabase) return statusFallback(idRef.current);
    try {
      const { data, error } = await supabase.rpc("session_status");
      if (error) return statusFallback(idRef.current);
      const row = Array.isArray(data) ? data[0] : data;
      const running = !!row?.running;
      const sessionId = (row?.session_id as string) || null;
      if (running && sessionId) setId(sessionId);
      return { running, sessionId: running ? sessionId : null };
    } catch {
      return statusFallback(idRef.current);
    }
  }, [setId]);

  // Create a NEW session instance (server stamps start + id). Returns the new id,
  // or null on failure (caller must NOT start a feed session-less on null).
  const startSession = useCallback(async (days: number): Promise<string | null> => {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data, error } = await supabase.rpc("start_session", { p_days: days });
      if (error || !data) return null;
      const id = String(data);
      setId(id);
      return id;
    } catch {
      return null;
    }
  }, [setId]);

  return { currentSessionId, loaded, checkStatus, startSession };
}
