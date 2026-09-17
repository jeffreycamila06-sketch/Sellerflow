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
import { decrementStockAndTouch, decrementProductStockBy } from "./productsDb";

const msgIdOf = (c: ProdComment): string => String((c as ProdComment & { msgId?: string }).msgId || "").trim();
// A returned db-write result is a FAILURE only when it is an object with
// success===false. void/undefined (the real skip path + the test mocks) = success
// — this is Trap 1: db.ts RETURNS {success:false,error}, it does not throw it, so
// the old Promise.all(...).catch() never saw returned failures.
const writeError = (res: unknown): unknown =>
  res && typeof res === "object" && (res as { success?: boolean }).success === false
    ? (res as { error?: unknown }).error
    : undefined;

// A THROWN rejection reaching the billing/session/stock chains is normally a real
// network/DB error (a Supabase/PostgREST error object, or a fetch/network TypeError) —
// those SHOULD surface to the seller. But on a kiosk, window.print() runs a BLOCKING
// nested event loop that drains these same promise continuations, and its reentrant
// hidden-iframe teardown can throw a FOREIGN "Failed to execute 'print' on 'Window':
// The provided callback is no longer runnable" INTO this chain even though every write
// returned 200/201. That is NOT a save failure — surfacing it fires a false
// "cloud save failed" banner on every kiosk order. So positively identify a genuine
// write/network error here; anything else (a print-side TypeError) is LOGGED ONLY, no
// banner. Real write FAILURES are already surfaced by the .then via writeError(res) —
// db.ts returns {success:false}, it does not throw — so this predicate only gates the
// .catch safety net, never the primary failure channel.
const looksLikeWriteError = (err: unknown): boolean => {
  if (!err) return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof e.code === "string" && e.code.length > 0) return true; // PostgREST/Supabase error code (e.g. "23505", "PGRST…")
  if (/AuthError|PostgrestError|FunctionsError|StorageError|FetchError|AbortError|NetworkError/i.test(String(e.name ?? ""))) return true;
  return /\bfetch\b|network|timeout|abort|connection|offline|supabase|econn|dns|refused|reset|unreachable/i.test(String(e.message ?? err));
};

// ── Pure write-payload builders — mirror App.tsx:4348-4372 EXACTLY (parity-tested) ──

export function orderDbPayload(c: ProdComment, order: LiveOrder) {
  return {
    customer_name: c.name || c.handle,
    product: order.item,
    total_amount: order.total,
    status: "Pending",
  };
}

export function liveSessionPayload(c: ProdComment, order: LiveOrder, sessionDate: string, sessionId?: string | null) {
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
    // Explicit session instance (sql/20). Additive: NULL when no session model is
    // active (legacy / rollback / pre-pick). Numbering + loading are UNCHANGED in
    // this step — this only records which session the order belongs to.
    session_id: sessionId || undefined,
    // Auto Mode Rules 1/2 (sql/38). qty > 1 only for Auto Mode; auto_code carries the
    // code for the Rule 1 (session,handle,code) unique index. Manual/enterprise leave
    // autoCode undefined → auto_code NULL → not part of the dedup index.
    // ⚠️ ACCEPTED (audit F-CAP-UNITS): a qty=N auto order is ONE saveOrderToDatabase =
    // ONE billing row = ONE count toward the free-tier cap (billing `orders` has no qty
    // column; total_amount = price*qty is correct). The cap is PER-ORDER, not per-unit
    // (Jeff's call, pending) — do NOT change this to per-unit without a decision.
    qty: order.qty,
    auto_code: order.autoCode || undefined,
  } satisfies LiveSessionOrderInput;
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
  // Explicit session model (sql/20/21): the active session instance to stamp on
  // each order row. NULL/undefined when no session picked → legacy row. Additive:
  // does NOT change this step's numbering or feed loading (still the old path).
  sessionId?: string | null;
  // 5f free-cap integration (optional):
  isCapped?: () => boolean;                                // soft block before creating
  onCapBlocked?: () => void;                               // show hard popup when blocked
  onCapReached?: (err: unknown) => void;                   // DB trigger rejected (over cap)
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
// Auto Mode: qty (Rule 2 — default 1; total = price*qty in the builder) + autoCode
// (Rule 1 — stamped on the order + row for the (session,handle,code) dedup index).
// Manual 1-Click/Enterprise pass NEITHER → qty defaults 1, autoCode stays undefined,
// and the three writes + builder output are byte-identical to 5e.
// itemOverride: AUTO orders print the seller's CODE as the item text ("A1" / "A1 ×2")
// for packing (Jeff) — replaces the pure builder's price-string item. Manual orders
// pass no override → the builder's item (price string / comment) is byte-unchanged.
export interface CreateOrderOpts { productLocalId?: number; qty?: number; autoCode?: string; itemOverride?: string }

export interface UseOrders {
  // returns null when the free-tier soft block prevented creation.
  createOrder: (c: ProdComment, price: number, opts?: CreateOrderOpts) => LiveOrder | null;
}

export function useOrders({ getBuyers, applyOrder, sessionDate, sessionId, isCapped, onCapBlocked, onCapReached, onWriteError, onStockError, afterWrite, onPrint, onEnsureWindow, enqueueLiveSession, isMsgIdOrdered }: UseOrdersDeps): UseOrders {
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
    // 0b) Free-tier HARD STOP soft block (App.tsx:4330). The DB trigger is still
    //    authoritative; this is the friendly block before we try.
    if (isCapped?.()) { onCapBlocked?.(); return null; }
    // 0c) Multi-day: open the window if none active (writes window_start once per
    //     window; N=1 → no-op). Does NOT affect this order's numbering (that comes
    //     from the loaded window buyers); fire-and-forget, like the DB writes.
    onEnsureWindow?.();
    // 1) SAME pure builder production uses (buyer numbering + orderNum epoch ms).
    //    Rule 2: qty (default 1 → byte-identical); Rule 1: stamp autoCode on the
    //    order so it persists on the row + feeds the (session,handle,code) dedup.
    const { order, nextBuyers, singleOrderBuyer } = buildOrderFromComment(c, getBuyers(), price, new Date(), opts?.qty ?? 1);
    if (opts?.autoCode) order.autoCode = opts.autoCode;
    // Auto Mode: the sticker/order item text is the CODE ("A1" / "A1 ×2"), not the
    // price string. singleOrderBuyer projects the SAME order object → the printed
    // slip + the persisted row + reprint all carry it. Manual passes no override.
    if (opts?.itemOverride) order.item = opts.itemOverride;
    // 1b) mark this msgId processed SYNCHRONOUSLY, before any write, so a same-tick
    //     second relay is blocked at step 0 above.
    if (msgId) processedMsgIdsRef.current.add(msgId);
    // 2) optimistic local update so the summary strip + Orders tab reflect it now.
    applyOrder(nextBuyers, order);
    // 3) print the slip — singleOrderBuyer is the buyer carrying just this order,
    //    exactly what production prints. DEFERRED off the synchronous write tick
    //    (setTimeout 0): on a kiosk, window.print() is a BLOCKING call whose nested
    //    event loop would otherwise run on TOP of the billing Promise.all continuations
    //    dispatched just below, letting a print-side teardown TypeError bleed into the
    //    save chain. Deferring runs it in a fresh macrotask AFTER all three writes are
    //    dispatched. Print is already async (printSlip just enqueues the web job / fires
    //    the native bridge), so this is not user-visible; ordering vs the writes does not
    //    affect correctness (the buyer + order are already built and applied).
    setTimeout(() => onPrint?.(singleOrderBuyer), 0);
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
      if (isCapError(err)) { onCapReached?.(err); return; }
      // Kiosk false-alarm fix: a print-side TypeError ("callback is no longer runnable")
      // can bleed into this chain even though the writes returned 200/201. Only a genuine
      // DB/network rejection raises the "cloud save failed" banner; log everything else.
      console.warn("Background database save failed", err);
      if (looksLikeWriteError(err)) onWriteError?.(err);
    }).finally(() => {
      // (5) NEAR-CAP TIMING FIX: resync the free-tier usage counter (App.tsx:4384 —
      //     free users) AFTER this billing write has SETTLED, not synchronously mid-tick.
      //     saveOrderToDatabase fires the DB check_and_increment_free_order trigger;
      //     running afterWrite (→ afterOrder → free_tier_status_for_user refetch) here in
      //     .finally means refresh() reads the COMMITTED post-increment count, so the
      //     near-cap modal appears at encode-time instead of only on the next reload.
      //     .finally runs EXACTLY ONCE (success or failure) → no new double-fire (the
      //     old code also refreshed twice in the cap case: onCapReached + the sync
      //     afterWrite — the modal guards make that safe). afterWrite is a no-op for
      //     non-free users. Off the synchronous return path — the order is already in
      //     the feed, printed, and buyer-numbered before this runs.
      afterWrite?.();
    });
    // 4b) SESSION write (the operational backbone). msgId-bearing → the durable
    //     retry outbox (idempotent via ux_lso_user_msgid). No msgId (Facebook) or
    //     no outbox wired (tests) → direct fire-and-forget, byte-unchanged, with the
    //     same failure surfacing.
    const livePayload = liveSessionPayload(c, order, sessionDate, sessionId);
    if (msgId && enqueueLiveSession) {
      enqueueLiveSession(livePayload, msgId);
    } else {
      void Promise.resolve(saveLiveSessionOrder(livePayload)).then((res) => {
        const err = writeError(res);
        if (err && !isCapError(err)) onWriteError?.(err);
      }).catch((err) => {
        // Same kiosk false-alarm guard as the billing chain above.
        if (isCapError(err)) return;
        console.warn("Live session save failed", err);
        if (looksLikeWriteError(err)) onWriteError?.(err);
      });
    }
    // 4c) Auto Mode linkage (gated): atomically decrement stock + stamp
    //     last_ordered_at. M1: a failure is SURFACED now (was a silent empty catch
    //     → Auto Mode could oversell with no signal). Manual orders pass no opts →
    //     never runs (5e byte-identical).
    if (opts?.productLocalId) {
      // Rule 2: decrement by qty when Auto Mode passes it (atomic, whole-or-nothing);
      // the old 1-arg RPC stays the path for any caller that doesn't pass qty. A -1
      // return = the DB rejected a cross-device short (client plan already blocked the
      // common in-device short) → surface it like any stock error (M1).
      // ⚠️ ACCEPTED RESIDUAL (audit F-STOCK-ORDER / F-RPC-NEG): this decrement + the
      // billing/session inserts above are INDEPENDENT fire-and-forget calls, none
      // awaited or conditional on each other (production fire-and-forget parity). So a
      // cross-device duplicate that reaches here leaves stock decremented + a billing
      // row written even though the session row is later rejected (23505 on
      // ux_lso_session_handle_code), and a -1 does NOT refund/cancel the order. This is
      // the SAME cross-device class as the documented multi-device buyer# caveat — the
      // client dedup ref + hydration gate are the primary guards; the DB index protects
      // session/buyer# integrity; a true refund would need an increment RPC (out of
      // scope). onStockError surfaces it so the seller can reconcile manually.
      const localId = opts.productLocalId;
      const dec = opts.qty != null ? decrementProductStockBy(localId, opts.qty) : decrementStockAndTouch(localId);
      void dec.then((newStock) => { if (newStock === -1) onStockError?.(new Error("stock_short")); })
        .catch((err) => {
          // Same kiosk false-alarm guard: only a genuine RPC/network error is a stock error.
          console.warn("Stock decrement failed", err);
          if (looksLikeWriteError(err)) onStockError?.(err);
        });
    }
    // (5) — the free-user usage-counter resync now runs post-commit in the billing
    //      write's .finally() above (NEAR-CAP TIMING FIX), not synchronously here, so
    //      the refetch reads the incremented count. Nothing to do on the sync path.
    return order;
  }, [getBuyers, applyOrder, sessionDate, sessionId, isCapped, onCapBlocked, onCapReached, onWriteError, onStockError, afterWrite, onPrint, onEnsureWindow, enqueueLiveSession, isMsgIdOrdered]);

  return { createOrder };
}
