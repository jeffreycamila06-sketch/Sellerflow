// Phase 5e — ORDER CREATION / 1-Click fan-out (tangled-zone #5). Reimplements
// production's createOrderFromComment (App.tsx:4326-4385) EXACTLY, using the SAME
// pure core + the SAME exported db writes — no App.tsx touch.
//
// Production sequence (App.tsx:4334-4384) we mirror byte-for-byte:
//   1. buildOrderFromComment(c, buyers, price, new Date())  ← SAME pure builder
//      (orderNum = epoch ms — the BT-sticker-protected value — is untouched)
//   2. apply buyers + append order to the live session state (optimistic)
//   3. Promise.all([ saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase ])
//      — same three exported writes, same payload shapes, NON-ATOMIC by design
//   4. (refreshFreeStatus + the free-cap soft block are 5f — not here)
//
// SAFETY: every write is RLS-scoped to the signed-in user (googletest) — the db
// functions read supabase.auth.getUser() and stamp user_id. The billing `orders`
// free-cap trigger (check_and_increment_free_order, now 100) stays authoritative and
// UNTOUCHED — we insert via the existing saveOrderToDatabase; if a free account
// is over cap the trigger rejects the insert and we surface it in 5f.
import { useCallback, useRef } from "react";
import { buildOrderFromComment } from "../../lib/orderLogic";
import type { Comment as ProdComment, Buyer, LiveOrder } from "../../lib/orderTypes";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase, type LiveSessionOrderInput } from "../../db";
import { isCapError } from "./useFreeCap";
import { decrementStockAndTouch } from "./productsDb";

const msgIdOf = (c: ProdComment): string => String((c as ProdComment & { msgId?: string }).msgId || "").trim();
// A returned db-write result is a FAILURE only when it is an object with
// success===false. void/undefined (the real skip path + the test mocks) = success
// — this is Trap 1: db.ts RETURNS {success:false,error}, it does not throw it, so
// the old Promise.all(...).catch() never saw returned failures.
const writeError = (res: unknown): unknown =>
  res && typeof res === "object" && (res as { success?: boolean }).success === false
    ? (res as { error?: unknown }).error
    : undefined;

// ── Pure write-payload builders — mirror App.tsx:4348-4372 EXACTLY (parity-tested) ──

export function orderDbPayload(c: ProdComment, order: LiveOrder) {
  return {
    customer_name: c.name || c.handle,
    product: order.item,
    total_amount: order.total,
    status: "Pending",
  };
}

export function liveSessionPayload(c: ProdComment, order: LiveOrder, sessionDate: string) {
  // Orderable earlier-comments (sql/18): store the source comment's TikTok
  // msgId so a later restored copy of the same message renders "Ordered ✓".
  // E3 hygiene: empty → undefined → NULL in the row (never a matchable "").
  const msgId = String((c as ProdComment & { msgId?: string }).msgId || "").trim();
  return {
    buyer_number: order.bNum,
    handle: c.handle,
    customer_name: c.name || c.handle,
    platform: c.platform,
    product: order.item,
    price: order.price,
    session_date: sessionDate,
    comment_msg_id: msgId || undefined,
  };
}

export function customerDbPayload(c: ProdComment, order: LiveOrder) {
  return {
    name: c.name || c.handle,
    handle: c.handle,
    platform: c.platform,
    total_orders: 1,
    total_spent: order.total,
  };
}

export interface UseOrdersDeps {
  getBuyers: () => Buyer[];                                 // current session buyers (live)
  applyOrder: (nextBuyers: Buyer[], order: LiveOrder) => void; // optimistic session update
  sessionDate: string;                                     // Taipei day == write/read bucket
  // 5f free-cap integration (optional):
  isCapped?: () => boolean;                                // soft block before creating
  onCapBlocked?: () => void;                               // show hard popup when blocked
  onCapReached?: (err: unknown) => void;                   // DB trigger rejected (over cap)
  // Buyer#-stability fix (2026-08): block creation while the session load is in
  // flight or FAILED, so a new order never assigns from an empty/uncertain buyer
  // list and resells from #1 (the parcel-sorting backbone) or poisons the
  // hydrate-on-empty guard. See useLiveSession.isSessionUnready. Genuinely-empty
  // (resolved, no error) is NOT blocked → a real new session still starts at #1.
  isSessionLoadPending?: () => boolean;                    // true → do not mint a buyer number yet
  onSessionNotReady?: () => void;                          // show the "reconnecting, try again" toast
  onWriteError?: (err: unknown) => void;                   // Batch D (#7): non-cap background write failed — surface it
  onStockError?: (err: unknown) => void;                   // M1: the stock-decrement RPC failed — surface it (was a silent empty catch → Auto Mode could oversell)
  afterWrite?: () => void;                                 // resync usage counter (free users)
  onPrint?: (singleOrderBuyer: Buyer) => void;             // 5g — print the slip (App.tsx:4341)
  onEnsureWindow?: () => void;                             // multi-day — open window if needed (once/window; N=1 no-op)
  // FAMILY A (#1 durability): route the live_session_orders write through the
  // retry outbox. Only msgId-bearing writes are enqueued (idempotent via
  // ux_lso_user_msgid); when absent (Facebook) or unwired (tests) the write
  // falls back to the direct fire-and-forget path below — byte-unchanged.
  enqueueLiveSession?: (payload: LiveSessionOrderInput, msgId: string) => void;
  // FAMILY A (#7 dedup): "already ordered by this stable msgId" from the loaded
  // window (liveSession.orderedMsgIds). Complements the in-hook synchronous
  // same-tick guard; covers restored/cross-load rows.
  isMsgIdOrdered?: (msgId: string) => boolean;
}

// Auto Mode (Step 4): an order created from a code carries its product's local_id so
// the SAME fan-out can also decrement that product's stock + stamp last_ordered_at
// (the Part-2 link) via the atomic RPC. Manual 1-Click/Enterprise pass no opts → the
// three writes are byte-identical (no RPC), preserving 5e parity.
export interface CreateOrderOpts { productLocalId?: number }

export interface UseOrders {
  // returns null when the free-tier soft block prevented creation.
  createOrder: (c: ProdComment, price: number, opts?: CreateOrderOpts) => LiveOrder | null;
}

export function useOrders({ getBuyers, applyOrder, sessionDate, isCapped, onCapBlocked, onCapReached, isSessionLoadPending, onSessionNotReady, onWriteError, onStockError, afterWrite, onPrint, onEnsureWindow, enqueueLiveSession, isMsgIdOrdered }: UseOrdersDeps): UseOrders {
  // FAMILY A (#7): synchronous same-tick dedup by stable TikTok msgId. Two relays
  // of the SAME comment carry DIFFERENT commentKeys (server-stamped timestamp),
  // so the printed/autoProcessed guards (keyed on commentKey) can't stop the
  // double order — this ref does. msgIds are globally unique per message, so an
  // entry never needs clearing (blocking a duplicate forever is the correct,
  // idempotent, safe direction). The DB unique index is the cross-device backstop.
  const processedMsgIdsRef = useRef<Set<string>>(new Set());
  const createOrder = useCallback((c: ProdComment, price: number, opts?: CreateOrderOpts): LiveOrder | null => {
    // 0) #7 DEDUP FIRST — an already-ordered msgId creates NOTHING (returns null
    //    WITHOUT the cap popup; the seams treat null exactly like a soft block →
    //    Auto Mode refunds its synchronous stock claim, so no stock leaks).
    const msgId = msgIdOf(c);
    if (msgId && (processedMsgIdsRef.current.has(msgId) || isMsgIdOrdered?.(msgId))) return null;
    // 0a2) Buyer#-stability: if the session load is still in flight or FAILED, do
    //      NOT mint a buyer number (buyers may be empty/undercounted → #1 collision
    //      + hydrate-on-empty poisoning). Return null (seams treat it as a soft
    //      block → Auto Mode refunds its stock claim) and surface a "reconnecting"
    //      toast so the seller re-taps once the load resolves (usually seconds).
    if (isSessionLoadPending?.()) { onSessionNotReady?.(); return null; }
    // 0b) Free-tier HARD STOP soft block (App.tsx:4330). The DB trigger is still
    //    authoritative; this is the friendly block before we try.
    if (isCapped?.()) { onCapBlocked?.(); return null; }
    // 0c) Multi-day: open the window if none active (writes window_start once per
    //     window; N=1 → no-op). Does NOT affect this order's numbering (that comes
    //     from the loaded window buyers); fire-and-forget, like the DB writes.
    onEnsureWindow?.();
    // 1) SAME pure builder production uses (buyer numbering + orderNum epoch ms).
    const { order, nextBuyers, singleOrderBuyer } = buildOrderFromComment(c, getBuyers(), price, new Date());
    // 1b) mark this msgId processed SYNCHRONOUSLY, before any write, so a same-tick
    //     second relay is blocked at step 0 above.
    if (msgId) processedMsgIdsRef.current.add(msgId);
    // 2) optimistic local update so the summary strip + Orders tab reflect it now.
    applyOrder(nextBuyers, order);
    // 3) print the slip BEFORE the writes (App.tsx:4341-4345) — singleOrderBuyer is
    //    the buyer carrying just this order, exactly what production prints.
    onPrint?.(singleOrderBuyer);
    // 4) BILLING + CRM writes: SAME payload shapes, fire-and-forget-once (NOT retried
    //    — the `orders` free-cap trigger and the `customers` +1 tally are not
    //    idempotent, so a retry would double-count; the billing ledger is sacred).
    //    Trap 1: inspect the RETURNED result (db.ts returns {success:false}, it does
    //    not throw) AND catch a network throw. The local order is KEPT either way
    //    (production fire-and-forget semantics — the order is real, only its cloud
    //    copy is missing; the toast tells the seller to check the connection).
    void Promise.all([
      saveOrderToDatabase(orderDbPayload(c, order)),
      saveCustomerToDatabase(customerDbPayload(c, order)),
    ]).then(([orderRes, custRes]) => {
      const orderErr = writeError(orderRes);
      if (orderErr) { if (isCapError(orderErr)) onCapReached?.(orderErr); else onWriteError?.(orderErr); }
      const custErr = writeError(custRes);
      if (custErr) onWriteError?.(custErr);
    }).catch((err) => {
      if (isCapError(err)) onCapReached?.(err);
      else { console.warn("Background database save failed", err); onWriteError?.(err); }
    });
    // 4b) SESSION write (the operational backbone). msgId-bearing → the durable
    //     retry outbox (idempotent via ux_lso_user_msgid). No msgId (Facebook) or
    //     no outbox wired (tests) → direct fire-and-forget, byte-unchanged, with the
    //     same failure surfacing.
    const livePayload = liveSessionPayload(c, order, sessionDate);
    if (msgId && enqueueLiveSession) {
      enqueueLiveSession(livePayload, msgId);
    } else {
      void Promise.resolve(saveLiveSessionOrder(livePayload)).then((res) => {
        const err = writeError(res);
        if (err && !isCapError(err)) onWriteError?.(err);
      }).catch((err) => { if (!isCapError(err)) onWriteError?.(err); });
    }
    // 4c) Auto Mode linkage (gated): atomically decrement stock + stamp
    //     last_ordered_at. M1: a failure is SURFACED now (was a silent empty catch
    //     → Auto Mode could oversell with no signal). Manual orders pass no opts →
    //     never runs (5e byte-identical).
    if (opts?.productLocalId) {
      void decrementStockAndTouch(opts.productLocalId).catch((err) => {
        console.warn("Stock decrement failed", err); onStockError?.(err);
      });
    }
    // 5) resync the usage counter (App.tsx:4384 — free users).
    afterWrite?.();
    return order;
  }, [getBuyers, applyOrder, sessionDate, isCapped, onCapBlocked, onCapReached, isSessionLoadPending, onSessionNotReady, onWriteError, onStockError, afterWrite, onPrint, onEnsureWindow, enqueueLiveSession, isMsgIdOrdered]);

  return { createOrder };
}
