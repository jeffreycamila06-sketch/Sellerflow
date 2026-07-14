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
import { useCallback, useEffect, useRef } from "react";
import type { LiveSessionOrderInput } from "../../db";

export const OUTBOX_KEY = "sfl_rd_outbox_v1";
export const MAX_RETRIES = 8;
export const MAX_QUEUE = 200;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

// The write function's result (saveLiveSessionOrder's shape). It may also THROW
// (a network/fetch rejection) — the drain wraps the call in try/catch.
export interface WriteResult { success: boolean; data?: unknown; skipped?: boolean; error?: unknown }
export type WriteFn = (payload: LiveSessionOrderInput) => Promise<WriteResult | void>;

export interface OutboxItem { id: string; payload: LiveSessionOrderInput; msgId: string; retries: number; firstAt: number }
export type ExhaustKind = "terminal" | "exhausted" | "overflow";

// ── Pure classification (unit-tested; the highest-risk logic — wrong here = an
//    infinite loop OR silent loss) ─────────────────────────────────────────────

// DUPLICATE = the retry hit our EXACT idempotency index. Match the CONSTRAINT
// NAME, not a bare 23505 — so a genuine OTHER unique violation is NOT swallowed
// (it falls through to terminal and surfaces). Ruling #2.
export function isDuplicateMsgId(err: unknown): boolean {
  const e = err as { code?: string; message?: string; details?: string } | undefined;
  if (!e) return false;
  const text = `${e.message || ""} ${e.details || ""}`;
  return e.code === "23505" && text.includes("ux_lso_user_msgid");
}

// RETRYABLE = an explicit ALLOW-LIST (network / timeout / HTTP 5xx). Everything
// else — cap, auth, 4xx, unknown — is DEFAULT-TERMINAL (Addition B). Never
// inverted: an unknown error must never loop forever.
export function isRetryableError(err: unknown): boolean {
  const e = err as { message?: string; code?: string; status?: number; name?: string } | undefined;
  if (!e) return false;
  if (e.name === "AbortError") return true; // fetch timeout / abort
  const msg = String(e.message || e || "").toLowerCase();
  if (/failed to fetch|network ?error|fetch failed|load failed|timeout|timed out|econnreset|etimedout|socket hang up|network request failed/.test(msg)) return true;
  const status = typeof e.status === "number" ? e.status : Number(e.code);
  if (Number.isFinite(status) && status >= 500 && status < 600) return true;
  return false;
}

export type Outcome = "ok" | "duplicate" | "retryable" | "terminal";

// Classify a single write attempt. A THROW is inspected the same way as a
// RETURNED {success:false} (db.ts returns errors, it does not throw them —
// Trap 1). undefined/void result = success (defensive; the real fn always
// returns an object, and the test mocks return void).
export function classifyOutcome(result: WriteResult | void, error: unknown): Outcome {
  if (error !== undefined && error !== null) {
    if (isDuplicateMsgId(error)) return "duplicate";
    return isRetryableError(error) ? "retryable" : "terminal";
  }
  if (!result) return "ok";
  if (result.success === false) {
    if (isDuplicateMsgId(result.error)) return "duplicate";
    return isRetryableError(result.error) ? "retryable" : "terminal";
  }
  return "ok"; // success:true or skipped
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
export function saveQueue(items: OutboxItem[]): void {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch { /* best-effort */ }
}

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ── The hook ─────────────────────────────────────────────────────────────────
export interface UseOutbox {
  // Enqueue the SAME liveSessionPayload the direct write used. msgId is REQUIRED
  // (the caller only enqueues msgId-bearing writes; FB has none → written direct).
  enqueue: (payload: LiveSessionOrderInput, msgId: string) => void;
  pending: () => number;
}

export function useOutbox(opts: { write: WriteFn; onExhausted?: (kind: ExhaustKind) => void; drainSignal?: unknown }): UseOutbox {
  const { write, onExhausted, drainSignal } = opts;
  const queueRef = useRef<OutboxItem[]>(loadQueue());
  const drainingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest callbacks without re-creating drain each render. The
  // useRef initializer sets .current for the first render; the effect refreshes
  // it after later renders (ref writes during render are lint-banned).
  const writeRef = useRef(write);
  const exhaustRef = useRef(onExhausted);
  useEffect(() => { writeRef.current = write; exhaustRef.current = onExhausted; });

  const scheduleDrain = useCallback((drain: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const minRetries = queueRef.current.reduce((m, i) => Math.min(m, i.retries), MAX_RETRIES);
    timerRef.current = setTimeout(drain, backoffMs(Number.isFinite(minRetries) ? minRetries : 0));
  }, []);

  const drain = useCallback(async function run(): Promise<void> {
    if (drainingRef.current) return;
    if (!queueRef.current.length) return;
    drainingRef.current = true;
    try {
      const batch = [...queueRef.current];
      const done = new Set<string>();               // ok / duplicate / terminal / exhausted → remove
      const retryUpdates = new Map<string, number>(); // id → new retry count
      for (const item of batch) {
        let result: WriteResult | void; let error: unknown;
        try { result = await writeRef.current(item.payload); } catch (e) { error = e; }
        const outcome = classifyOutcome(result, error);
        if (outcome === "ok" || outcome === "duplicate") { done.add(item.id); continue; }
        if (outcome === "terminal") { done.add(item.id); exhaustRef.current?.("terminal"); continue; }
        const retries = item.retries + 1; // retryable
        if (retries >= MAX_RETRIES) { done.add(item.id); exhaustRef.current?.("exhausted"); continue; }
        retryUpdates.set(item.id, retries);
      }
      // Rebuild from the LIVE ref so items enqueued DURING the drain survive.
      const next = queueRef.current
        .filter((i) => !done.has(i.id))
        .map((i) => (retryUpdates.has(i.id) ? { ...i, retries: retryUpdates.get(i.id)! } : i));
      queueRef.current = next;
      saveQueue(next);
      if (next.length) scheduleDrain(run);           // backoff self-reschedule while items remain
    } finally {
      drainingRef.current = false;
    }
  }, [scheduleDrain]);

  const enqueue = useCallback((payload: LiveSessionOrderInput, msgId: string) => {
    const m = String(msgId || "").trim();
    if (!m) return;                                  // never enqueue a keyless write
    const q = queueRef.current;
    if (q.length >= MAX_QUEUE) { q.shift(); exhaustRef.current?.("overflow"); } // bounded — drop oldest + surface
    q.push({ id: uid(), payload, msgId: m, retries: 0, firstAt: Date.now() });
    saveQueue(q);
    void drain();                                    // attempt immediately (common path = inline success)
  }, [drain]);

  // Drain triggers: mount, return-to-visible, and a reconnect signal.
  useEffect(() => {
    void drain();
    const onVis = () => { if (document.visibilityState === "visible") void drain(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [drain, drainSignal]);

  return { enqueue, pending: () => queueRef.current.length };
}
