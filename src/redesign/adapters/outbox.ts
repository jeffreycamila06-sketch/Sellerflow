// FAMILY A (#1 durability) — a durable localStorage retry queue for the ONE
// live_session_orders write. Scaled to ~30 near-always-online sellers: the queue
// is normally empty and only holds the rare transient blip (seconds, not the
// hours-offline case a full IndexedDB/Service-Worker outbox is built for).
//
// SCOPE (audit-locked): live_session_orders ONLY. It is the operational backbone
// (buyer# + cross-device rebuild) and the ONLY write we can make idempotent
// without touching the SACRED billing `orders` ledger. orders/customers stay
// fire-and-forget-once (their failures are surfaced, not retried — a retry would
// double-count the free-cap trigger and the CRM tally; see useOrders).
//
// IDEMPOTENCY (the classic outbox trap: server commits, ACK lost, client retries
// → duplicate): the retry lands the SAME (user_id, comment_msg_id) → the unique
// index ux_lso_user_msgid rejects it with 23505 → we classify that as SUCCESS
// (the row already exists). This is why ONLY msgId-bearing writes are enqueued
// (a comment without a stable id — Facebook — cannot be deduped, so it is never
// retried; the caller writes it once, fire-and-forget). The index MUST exist
// before the queue drains for real — it is the whole safety proof.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveSessionOrderInput } from "../../db";
import { NO_SESSION_ERROR } from "../../lib/noSession";

export const OUTBOX_KEY = "sfl_rd_outbox_v1";
// Audit Oct 22 (1): a network / retryable failure is retried with backoff for up to 24 h (was 8
// attempts ≈ 1 minute — a 3-minute outage dropped the order). Real terminal errors still drop.
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_QUEUE = 200;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

// The write function's result (saveLiveSessionOrder's shape). It may also THROW
// (a network/fetch rejection) — the drain wraps the call in try/catch.
export interface WriteResult { success: boolean; data?: unknown; skipped?: boolean; error?: unknown }
export type WriteFn = (payload: LiveSessionOrderInput) => Promise<WriteResult | void>;

// ownerId (Audit Oct 13 item 5): the user who queued it. A shared device never writes one
// shop's queued order into another shop's account. Legacy items (no ownerId) are written
// for whoever is signed in, as before.
export interface OutboxItem { id: string; payload: LiveSessionOrderInput; msgId: string; retries: number; firstAt: number; ownerId?: string }

/** May this item be written now? Owned items only for their owner; legacy items for anyone. */
export function itemWritableBy(item: OutboxItem, currentUserId: string | null | undefined): boolean {
  if (!item.ownerId) return true;
  return !!currentUserId && item.ownerId === currentUserId;
}
export type ExhaustKind = "terminal" | "exhausted" | "overflow";

// Audit Oct 22 (1): the login expired (401 / JWT expired / no local session while online). NOT
// terminal — the item waits, untouched, until the seller signs in again (the ownerId change
// drains it). Checked BEFORE the retryable allow-list.
export function isAuthExpiredError(err: unknown): boolean {
  const e = err as { message?: string; code?: string; status?: number; name?: string } | undefined;
  if (!e) return false;
  if (e.name === NO_SESSION_ERROR) return typeof navigator === "undefined" || navigator.onLine !== false;
  if (e.status === 401 || e.code === "PGRST301") return true;
  return /jwt expired|invalid jwt|not authenticated|unauthorized/i.test(String(e.message || ""));
}

// ── Pure classification (unit-tested; the highest-risk logic — wrong here = an
//    infinite loop OR silent loss) ─────────────────────────────────────────────

// DUPLICATE = the retry hit one of our idempotency indexes. Match the CONSTRAINT
// NAME, not a bare 23505 — so a genuine OTHER unique violation is NOT swallowed
// (it falls through to terminal and surfaces). Ruling #2.
//   • ux_lso_user_msgid          — the same message written twice (retry idempotency)
//   • ux_lso_session_handle_code — Auto Mode Rule 1: a second auto order for the same
//     (session, handle, code) slipped past the client dedup (cross-device race). The
//     row must NOT be written; treat as a benign duplicate (drop, no error, no loop).
export function isDuplicateMsgId(err: unknown): boolean {
  const e = err as { code?: string; message?: string; details?: string } | undefined;
  if (!e) return false;
  const text = `${e.message || ""} ${e.details || ""}`;
  return e.code === "23505" && (text.includes("ux_lso_user_msgid") || text.includes("ux_lso_session_handle_code"));
}

// RETRYABLE = an explicit ALLOW-LIST (network / timeout / HTTP 5xx). Everything
// else — cap, auth, 4xx, unknown — is DEFAULT-TERMINAL (Addition B). Never
// inverted: an unknown error must never loop forever.
export function isRetryableError(err: unknown): boolean {
  const e = err as { message?: string; code?: string; status?: number; name?: string } | undefined;
  if (!e) return false;
  if (e.name === "AbortError") return true; // fetch timeout / abort
  // Audit Oct 13 (4): no local session (db.ts NoSessionError). Offline → keep it (the
  // session may simply not be readable yet); online + signed out → terminal.
  if (e.name === NO_SESSION_ERROR) return typeof navigator !== "undefined" && navigator.onLine === false;
  const msg = String(e.message || e || "").toLowerCase();
  if (/failed to fetch|network ?error|fetch failed|load failed|timeout|timed out|econnreset|etimedout|socket hang up|network request failed/.test(msg)) return true;
  const status = typeof e.status === "number" ? e.status : Number(e.code);
  if (Number.isFinite(status) && status >= 500 && status < 600) return true;
  return false;
}

export type Outcome = "ok" | "duplicate" | "retryable" | "terminal" | "auth";

// Classify a single write attempt. A THROW is inspected the same way as a
// RETURNED {success:false} (db.ts returns errors, it does not throw them —
// Trap 1). undefined/void result = success (defensive; the real fn always
// returns an object, and the test mocks return void).
export function classifyOutcome(result: WriteResult | void, error: unknown): Outcome {
  if (error !== undefined && error !== null) return classifyError(error);
  if (!result) return "ok";
  if (result.success === false) return classifyError(result.error);
  return "ok"; // success:true or skipped
}
function classifyError(err: unknown): Outcome {
  if (isDuplicateMsgId(err)) return "duplicate";
  if (isRetryableError(err)) return "retryable";
  if (isAuthExpiredError(err)) return "auth";
  return "terminal";
}

// Exponential backoff + equal jitter, capped. (App runtime — Math.random/Date.now
// are fine here; they are only forbidden inside workflow scripts.)
export function backoffMs(retries: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, retries));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

// ── Persistence (best-effort; a disabled/full localStorage degrades to an
//    in-memory session queue rather than throwing) ─────────────────────────────
export function loadQueue(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as OutboxItem[]).filter((i) => i && i.payload && i.msgId) : [];
  } catch { return []; }
}
// The hook's live queue (same array it mutates) — queuedOutboxRows reads it without the hook.
let liveQueue: OutboxItem[] | null = null;
export function saveQueue(items: OutboxItem[]): void {
  liveQueue = items;
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch { /* best-effort */ }
}

// Audit Oct 22 (1): the still-queued orders as session rows, so a board (re)load can count them
// (next buyer number) and the "already ordered" check knows their msgId. created_at = when they
// were queued (the order's own time); `queued` marks them for callers that care.
export type QueuedRow = LiveSessionOrderInput & { created_at: string; comment_msg_id: string; queued: true };
export function queuedOutboxRows(ownerId: string | null | undefined): QueuedRow[] {
  return (liveQueue ?? loadQueue())
    .filter((i) => itemWritableBy(i, ownerId))
    .map((i) => ({ ...i.payload, comment_msg_id: i.msgId, created_at: new Date(i.firstAt || Date.now()).toISOString(), queued: true as const }));
}

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ── The hook ─────────────────────────────────────────────────────────────────
export interface UseOutbox {
  // Enqueue the SAME liveSessionPayload the direct write used. msgId is REQUIRED
  // (the caller only enqueues msgId-bearing writes; FB has none → written direct).
  enqueue: (payload: LiveSessionOrderInput, msgId: string) => void;
  pending: () => number;
  /** Items the CURRENT owner still has queued (what a logout would leave unsaved). */
  pendingMine: () => number;
  /** One drain now (awaits the one in flight if any) — the "final save" before logout. */
  flush: () => Promise<void>;
  /** Logout: drop the signing-out user's queued items (memory + storage). */
  dropOwner: (ownerId: string | null | undefined) => void;
}

export function useOutbox(opts: { write: WriteFn; onExhausted?: (kind: ExhaustKind) => void; drainSignal?: unknown; ownerId?: string | null }): UseOutbox {
  const { write, onExhausted, drainSignal, ownerId } = opts;
  const [initialQueue] = useState(() => { const q = loadQueue(); liveQueue = q; return q; });
  const queueRef = useRef<OutboxItem[]>(initialQueue);
  const drainingRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest callbacks without re-creating drain each render. The
  // useRef initializer sets .current for the first render; the effect refreshes
  // it after later renders (ref writes during render are lint-banned).
  const writeRef = useRef(write);
  const exhaustRef = useRef(onExhausted);
  const ownerRef = useRef(ownerId || null);
  useEffect(() => { writeRef.current = write; exhaustRef.current = onExhausted; ownerRef.current = ownerId || null; });

  const scheduleDrain = useCallback((drain: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const minRetries = queueRef.current.reduce((m, i) => Math.min(m, i.retries), 30);
    timerRef.current = setTimeout(drain, backoffMs(Number.isFinite(minRetries) ? minRetries : 0));
  }, []);

  const drain = useCallback(function run(): Promise<void> {
    if (drainingRef.current) return drainingRef.current;
    if (!queueRef.current.length) return Promise.resolve();
    const p = (async () => {
      const me = ownerRef.current;
      const batch = queueRef.current.filter((i) => itemWritableBy(i, me)); // another user's items wait for them
      const done = new Set<string>();               // ok / duplicate / terminal / exhausted → remove
      const held = new Set<string>();               // auth: waits for a sign-in, no backoff timer
      const retryUpdates = new Map<string, number>(); // id → new retry count
      for (const item of batch) {
        let result: WriteResult | void; let error: unknown;
        try { result = await writeRef.current(item.payload); } catch (e) { error = e; }
        const outcome = classifyOutcome(result, error);
        if (outcome === "ok" || outcome === "duplicate") { done.add(item.id); continue; }
        if (outcome === "terminal") { done.add(item.id); exhaustRef.current?.("terminal"); continue; }
        if (outcome === "auth") { held.add(item.id); continue; }
        // retryable: keep for up to MAX_AGE_MS since it was queued, then surface + drop
        if (Date.now() - (item.firstAt || Date.now()) >= MAX_AGE_MS) { done.add(item.id); exhaustRef.current?.("exhausted"); continue; }
        retryUpdates.set(item.id, item.retries + 1);
      }
      // Rebuild from the LIVE ref so items enqueued DURING the drain survive.
      const next = queueRef.current
        .filter((i) => !done.has(i.id))
        .map((i) => (retryUpdates.has(i.id) ? { ...i, retries: retryUpdates.get(i.id)! } : i));
      queueRef.current = next;
      saveQueue(next);
      // backoff self-reschedule while OUR retryable items remain (auth-held ones wait for a sign-in)
      if (next.some((i) => !held.has(i.id) && itemWritableBy(i, ownerRef.current))) scheduleDrain(() => { void run(); });
    })().finally(() => { drainingRef.current = null; });
    drainingRef.current = p;
    return p;
  }, [scheduleDrain]);

  const enqueue = useCallback((payload: LiveSessionOrderInput, msgId: string) => {
    const m = String(msgId || "").trim();
    if (!m) return;                                  // never enqueue a keyless write
    const q = queueRef.current;
    if (q.length >= MAX_QUEUE) { q.shift(); exhaustRef.current?.("overflow"); } // bounded — drop oldest + surface
    q.push({ id: uid(), payload, msgId: m, retries: 0, firstAt: Date.now(), ...(ownerRef.current ? { ownerId: ownerRef.current } : {}) });
    saveQueue(q);
    void drain();                                    // attempt immediately (common path = inline success)
  }, [drain]);

  // Drain triggers: mount, return-to-visible, the browser's `online` event, and a reconnect
  // signal (any platform's connection rising — the caller passes a value that changes on each).
  useEffect(() => {
    void drain();
    const onVis = () => { if (document.visibilityState === "visible") void drain(); };
    const onOnline = () => { void drain(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [drain, drainSignal, ownerId]); // a new user signing in drains their own items

  const dropOwner = useCallback((who: string | null | undefined) => {
    if (!who) return;
    queueRef.current = queueRef.current.filter((i) => i.ownerId !== who);
    saveQueue(queueRef.current);
  }, []);

  const pendingMine = useCallback(() => queueRef.current.filter((i) => itemWritableBy(i, ownerRef.current)).length, []);
  return { enqueue, pending: () => queueRef.current.length, pendingMine, flush: drain, dropOwner };
}
