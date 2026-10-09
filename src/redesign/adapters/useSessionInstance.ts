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

export interface SessionStatus { running: boolean; sessionId: string | null; platform: string | null }

// PURE — the failure fallback. On an RPC error we must NOT fall back to the
// device clock (owner lock). The safe, no-reset degradation: if we already know a
// current_session_id (from the mount read or a prior create), RESUME it
// (running=true) — matches the locked decision "a session that ends mid-selling
// continues until the seller explicitly re-Connects"; resuming never resets buyer#.
// Only when there is genuinely nothing to resume do we report not-running (→ the
// picker), because there is no session to continue. Unit-tested.
// platform: null on fallback (the session's platform is unknown when the RPC failed) →
// the client's switch rule treats NULL as "continue" (never a forced reset on a degraded
// read — the safe direction).
export function statusFallback(knownSessionId: string | null): SessionStatus {
  return knownSessionId ? { running: true, sessionId: knownSessionId, platform: null } : { running: false, sessionId: null, platform: null };
}

// sql/86 — start_session's first-connect path raises this when a session is already running
// on a DIFFERENT known platform (another device started it meanwhile). startSession returns
// SESSION_SWITCH_NEEDED instead of an id; the caller routes to the switch confirm.
export const SESSION_SWITCH_NEEDED = "session_switch_needed";
export const isSwitchNeeded = (err: unknown): boolean =>
  String((err as { message?: unknown } | null)?.message ?? "").includes(SESSION_SWITCH_NEEDED);

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
  loaded: boolean;                          // mount read resolved (for the CURRENT enabled value)
  // true only when current_session_id is DEFINITIVELY known: the read answered (a row or
  // no row), or a checkStatus succeeded. A failed read or a missing user id is UNKNOWN —
  // never "no session" (that is what let a day-only board renumber a running session).
  known: boolean;
  retry: () => void;                        // re-run the read now (also automatic on focus / visible while unknown)
  // Resolves once the mount read (current_session_id) has completed. Connect awaits
  // this BEFORE deciding running-vs-not, so a tap during a still-pending mount read
  // can't fall back to a null id → wrongful new session (audit LOW #2). Always
  // resolves (the mount read always sets loaded, even unauthed/errored) → no deadlock.
  ensureLoaded: () => Promise<void>;
  checkStatus: () => Promise<SessionStatus>; // server-authoritative running/ended check (call on Connect)
  // H1/H2: platform = the connecting platform (stamped on a mint; NULL-safe). force =
  // true only on a cross-platform SWITCH (always mint); false (default) = reuse-if-running
  // (a running session's id is returned unchanged — converges a first-connect race).
  startSession: (days: number, platform?: string | null, force?: boolean) => Promise<string | null>;
  // End the running session (E2, owner-gated caller): end_session() nulls
  // current_session_id + stamps session_ended_at. After this the next Start begins
  // buyer# at #1. Returns true on success. ADDITIVE — non-owner code never calls it.
  endSession: () => Promise<boolean>;
  // Build 13 (display only): the seller ENDED the session with End Session — no running
  // session and the database row carries the end stamp (session_ended_at). Read on app open,
  // set by endSession(), cleared by a new startSession(). Never used for Connect decisions.
  closed: boolean;
}

// Read state TAGGED with the enabled value it belongs to. Before sign-in finishes the hook
// runs with enabled=false; a plain `loaded` flag set then stayed true when enabled turned
// true, so the live-session load ran before the real read had answered (the numbering race).
// Deriving loaded/known from the tag makes them false IN THE SAME RENDER enabled turns true.
type ReadStatus = "pending" | "known" | "unknown";
type ReadState = { forEnabled: boolean; status: ReadStatus };

// fix = the session-numbering fix is on for this account (sessionNumberingGate). false =
// today's code path, unchanged (plain loaded flag, a failed read counts as resolved).
export function useSessionInstance(enabled: boolean, fix = false): UseSessionInstance {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setStartedAt] = useState<string | null>(null);
  const [sessionWindowDays, setWinDays] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [closed, setClosed] = useState(false); // Build 13: ended with End Session (display only)
  const [loadedOld, setLoaded] = useState(false); // fix off: today's plain flag
  // The read result is TAGGED with the enabled value it belongs to, so loaded/known are false
  // in the very render enabled turns true. Signing out resets the tag (in the read effect), so
  // a result from an earlier sign-in never counts for the next one.
  const [read, setRead] = useState<ReadState>({ forEnabled: !enabled, status: "pending" });
  const loaded = fix ? read.forEnabled === enabled && read.status !== "pending" : loadedOld;
  const known = fix ? read.forEnabled === enabled && read.status === "known" : true;
  // Mirrors for checkStatus (updated in an effect, never during render).
  const knownRef = useRef(known);
  const enabledRef = useRef(enabled);
  useEffect(() => { knownRef.current = known; enabledRef.current = enabled; }, [known, enabled]);
  const lastEnabledRef = useRef(false); // enabled value of the previous read run (effects only)
  const [retryTick, setRetryTick] = useState(0);
  const retry = useCallback(() => setRetryTick((n) => n + 1), []);
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
  // Disabled / unconfigured = nothing to read → known (no session), as before.
  // Missing user id or a failed read → UNKNOWN (loaded, but not known): retried on focus /
  // visible and by retry(); a successful checkStatus also resolves it.
  useEffect(() => {
    let active = true;
    // fix OFF: today's mount read, verbatim.
    const old = async () => {
      if (!enabled || !isSupabaseConfigured || !supabase) { if (active) setLoaded(true); return; }
      const id = await uid();
      if (!id) { if (active) setLoaded(true); return; }
      const { data, error } = await supabase
        .from("seller_session_config")
        .select("current_session_id,session_started_at,session_window_days,session_ended_at")
        .eq("user_id", id)
        .maybeSingle();
      if (!active) return;
      if (!error) {
        setId((data?.current_session_id as string) || null);
        setStartedAt((data?.session_started_at as string) || null);
        setWinDays(data?.session_window_days != null ? Number(data.session_window_days) : null);
        setClosed(!data?.current_session_id && !!data?.session_ended_at); // Build 13
      }
      setLoaded(true);
    };
    const firstRunOfSignIn = enabled && !lastEnabledRef.current;
    lastEnabledRef.current = enabled;
    const p = !fix ? old() : (async () => {
      if (firstRunOfSignIn) { setId(null); setStartedAt(null); setWinDays(null); setClosed(false); } // new sign-in: never keep the previous user's session id
      if (!enabled || !isSupabaseConfigured || !supabase) { if (active) setRead({ forEnabled: enabled, status: "known" }); return; }
      let id: string | null;
      try { id = await uid(); } catch { id = null; }
      if (!active) return;
      if (!id) { setRead((r) => (r.forEnabled === enabled && r.status === "known" ? r : { forEnabled: enabled, status: "unknown" })); return; }
      let res: { data: Record<string, unknown> | null; error: unknown };
      try {
        res = await supabase
          .from("seller_session_config")
          .select("current_session_id,session_started_at,session_window_days,session_ended_at")
          .eq("user_id", id)
          .maybeSingle() as unknown as { data: Record<string, unknown> | null; error: unknown };
      } catch (e) { res = { data: null, error: e }; }
      if (!active) return;
      const { data, error } = res;
      if (!error) {
        setId((data?.current_session_id as string) || null);
        setStartedAt((data?.session_started_at as string) || null);
        setWinDays(data?.session_window_days != null ? Number(data.session_window_days) : null);
        setClosed(!data?.current_session_id && !!data?.session_ended_at); // Build 13
        setRead({ forEnabled: enabled, status: "known" });
      } else {
        // Keep "known" if a checkStatus already resolved it meanwhile; else unknown.
        setRead((r) => (r.forEnabled === enabled && r.status === "known" ? r : { forEnabled: enabled, status: "unknown" }));
      }
    })();
    mountDoneRef.current = p;
    return () => { active = false; };
  }, [enabled, uid, setId, fix, retryTick]);
  // Signed out → reset the tag (both modes; only the fix reads it), so the next sign-in waits
  // for its own read.
  useEffect(() => {
    if (enabled) return;
    let on = true;
    void Promise.resolve().then(() => { if (on) setRead((r) => (r.forEnabled === false && r.status === "known" ? r : { forEnabled: false, status: "known" })); });
    return () => { on = false; };
  }, [enabled]);

  // Unknown → re-read when the app comes back to the foreground (no interval poll).
  const unknownNow = fix && enabled && read.forEnabled === enabled && read.status === "unknown";
  useEffect(() => {
    if (!unknownNow || typeof window === "undefined") return;
    const again = () => { if (typeof document === "undefined" || document.visibilityState !== "hidden") retry(); };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [unknownNow, retry]);

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
      // H1: the running session's OWN platform (sql/46). Drives server-anchored
      // switch-detection in RedesignApp. NULL = legacy/unknown → treated as continue.
      const platform = (row?.session_platform as string) || null;
      // A successful answer makes the id KNOWN. If the mount read had failed (unknown), take
      // the server's current_session_id as-is (running or not), like the mount read would;
      // otherwise keep the existing rule (sync only a running id).
      if (!knownRef.current) {
        setId(sessionId);
        knownRef.current = true;
        setRead({ forEnabled: enabledRef.current, status: "known" });
      } else if (running && sessionId) setId(sessionId);
      // Server-authoritative ended flag: session exists AND server says not running
      // → its Taipei window has passed (drives the "continues" animation). session_id
      // is returned regardless of running (it's current_session_id).
      setEnded(!!sessionId && !running);
      return { running, sessionId: running ? sessionId : null, platform: running ? platform : null };
    } catch {
      return statusFallback(idRef.current);
    }
  }, [setId]);

  // Create a NEW session instance (server stamps start + id). Returns the new id,
  // or null on failure (caller must NOT start a feed session-less on null).
  const startSession = useCallback(async (days: number, platform: string | null = null, force = false): Promise<string | null> => {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data, error } = await supabase.rpc("start_session", { p_days: days, p_platform: platform, p_force: force });
      if (error && isSwitchNeeded(error)) return SESSION_SWITCH_NEEDED; // nothing changed on the server
      if (error || !data) return null;
      const id = String(data);
      setId(id);
      setEnded(false); // a session the server just started/returned is running, by definition
      setClosed(false); // Build 13: a new session is not "ended with End Session"
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

  // End the running session (owner-gated caller). end_session() nulls
  // current_session_id + stamps session_ended_at server-side; we then clear the local
  // mirror so the next Connect asks for a fresh Start (→ #1). Best-effort: an RPC error
  // returns false (caller keeps the session; no partial local clear).
  const endSession = useCallback(async (): Promise<boolean> => {
    if (!isSupabaseConfigured || !supabase) return false;
    try {
      const { error } = await supabase.rpc("end_session");
      if (error) return false;
      setId(null);
      setStartedAt(null);
      setWinDays(null);
      setEnded(false);
      setClosed(true); // Build 13: the Live screen goes back to the picker (display only)
      return true;
    } catch {
      return false;
    }
  }, [setId]);

  // Refresh the ended flag on each Asia/Taipei day rollover (useTaipeiDayId advances
  // via focus/visibility + a single midnight timeout — no interval poll). The device
  // clock only TRIGGERS the re-ask; session_status (server) DECIDES ended, so two
  // devices agree. Read-only: checkStatus re-syncs the same id (harmless) + sets
  // ended; it never touches numbering or the feed load. Skips until a session exists.
  const dayId = useTaipeiDayId();
  useEffect(() => { if (idRef.current) void checkStatus(); }, [dayId, checkStatus]);
  // App open: once the mount read has a session id, ask the SERVER whether it is still
  // running (never the device clock) so an already-ended session shows as ended right
  // away instead of only after the next Taipei day rollover. Read-only; an RPC error
  // keeps ended=false (statusFallback) → nothing is hidden on a failed read.
  useEffect(() => { if (loaded && idRef.current) void checkStatus(); }, [loaded, checkStatus]);

  return { currentSessionId, sessionStartedAt, sessionWindowDays, ended, loaded, known, retry, ensureLoaded, checkStatus, startSession, endSession, closed };
}
