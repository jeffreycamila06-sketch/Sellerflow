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
import { useTaipeiDayId } from "./useSessionWindow";

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
  // Sub-step 5 (UI-only): the running session's server start + length, for the
  // "Session ends: {date}" header label (computed server-Taipei from these — see
  // sessionEnd.ts). Null until a session exists / config read resolves.
  sessionStartedAt: string | null;
  sessionWindowDays: number | null;
  // Server-authoritative ended flag (from session_status().running — never the
  // device clock). true = the session's Taipei window has passed but the seller is
  // still connected (drives the "Session continues …" reassurance animation).
  // Refreshed at Connect + on each Taipei-day rollover (reuses useTaipeiDayId's
  // existing day signal to RE-ASK the server; the server decides, not the clock).
  ended: boolean;
  loaded: boolean;                          // mount read resolved
  // Resolves once the mount read (current_session_id) has completed. Connect awaits
  // this BEFORE deciding running-vs-not, so a tap during a still-pending mount read
  // can't fall back to a null id → wrongful new session (audit LOW #2). Always
  // resolves (the mount read always sets loaded, even unauthed/errored) → no deadlock.
  ensureLoaded: () => Promise<void>;
  checkStatus: () => Promise<SessionStatus>; // server-authoritative running/ended check (call on Connect)
  startSession: (days: number) => Promise<string | null>; // create a NEW session; returns its id (null on failure)
}

export function useSessionInstance(enabled: boolean): UseSessionInstance {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setStartedAt] = useState<string | null>(null);
  const [sessionWindowDays, setWinDays] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
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

  // The mount-read promise — Connect awaits this so it never decides on a
  // still-pending idRef (audit LOW #2). Captured in a ref (not state) so
  // ensureLoaded can await the SAME in-flight read without re-triggering it.
  const mountDoneRef = useRef<Promise<void> | null>(null);

  // Mount read: current_session_id only (one tiny row). No status/ended compute
  // here — that needs server "today", which we fetch on Connect via checkStatus.
  useEffect(() => {
    let active = true;
    const p = (async () => {
      if (!enabled || !isSupabaseConfigured || !supabase) { if (active) setLoaded(true); return; }
      const id = await uid();
      if (!id) { if (active) setLoaded(true); return; }
      const { data, error } = await supabase
        .from("seller_session_config")
        .select("current_session_id,session_started_at,session_window_days")
        .eq("user_id", id)
        .maybeSingle();
      if (!active) return;
      if (!error) {
        setId((data?.current_session_id as string) || null);
        setStartedAt((data?.session_started_at as string) || null);
        setWinDays(data?.session_window_days != null ? Number(data.session_window_days) : null);
      }
      setLoaded(true);
    })();
    mountDoneRef.current = p;
    return () => { active = false; };
  }, [enabled, uid, setId]);

  // Await the mount read (idRef populated) before Connect decides. Resolves
  // immediately once done; if the effect hasn't assigned the promise yet (should
  // not happen — effects run before a user tap), resolves immediately too. The
  // mount read ALWAYS sets loaded (unauthed/errored included) → never deadlocks.
  const ensureLoaded = useCallback(async (): Promise<void> => {
    const p = mountDoneRef.current;
    if (p) { try { await p; } catch { /* mount read never rejects; ignore defensively */ } }
  }, []);

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
      // Server-authoritative ended flag: session exists AND server says not running
      // → its Taipei window has passed (drives the "continues" animation). session_id
      // is returned regardless of running (it's current_session_id).
      setEnded(!!sessionId && !running);
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
      // Populate the header-indicator fields NOW so "Session ends: {date}" renders
      // immediately, without waiting for a refresh (bug fix). Read the SERVER values
      // back — start_session stamped session_started_at with server now() and
      // session_window_days with the pick — NEVER the device clock (owner lock:
      // server-Taipei only). Same own-scoped read as the mount effect; the upsert is
      // committed before the RPC returns, so this SELECT sees the new row.
      // Best-effort + ISOLATED: a read-back failure must never turn a successful
      // create into a null return (that would leave the caller session-less); on
      // failure the indicator simply waits for the next mount read, as before.
      try {
        const userId = await uid();
        if (userId) {
          const { data: row, error: readErr } = await supabase
            .from("seller_session_config")
            .select("session_started_at,session_window_days")
            .eq("user_id", userId)
            .maybeSingle();
          if (!readErr && row) {
            setStartedAt((row.session_started_at as string) || null);
            setWinDays(row.session_window_days != null ? Number(row.session_window_days) : null);
          }
        }
      } catch { /* read-back is best-effort; the indicator waits for the next mount read */ }
      return id;
    } catch {
      return null;
    }
  }, [setId, uid]);

  // Refresh the ended flag on each Asia/Taipei day rollover (useTaipeiDayId advances
  // via focus/visibility + a single midnight timeout — no interval poll). The device
  // clock only TRIGGERS the re-ask; session_status (server) DECIDES ended, so two
  // devices agree. Read-only: checkStatus re-syncs the same id (harmless) + sets
  // ended; it never touches numbering or the feed load. Skips until a session exists.
  const dayId = useTaipeiDayId();
  useEffect(() => { if (idRef.current) void checkStatus(); }, [dayId, checkStatus]);

  return { currentSessionId, sessionStartedAt, sessionWindowDays, ended, loaded, ensureLoaded, checkStatus, startSession };
}
