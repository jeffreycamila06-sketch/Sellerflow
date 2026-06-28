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
import { useCallback } from "react";
import { buildOrderFromComment } from "../../lib/orderLogic";
import type { Comment as ProdComment, Buyer, LiveOrder } from "../../lib/orderTypes";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../db";
import { isCapError } from "./useFreeCap";
import { decrementStockAndTouch } from "./productsDb";

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
  return {
    buyer_number: order.bNum,
    handle: c.handle,
    customer_name: c.name || c.handle,
    platform: c.platform,
    product: order.item,
    price: order.price,
    session_date: sessionDate,
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
  afterWrite?: () => void;                                 // resync usage counter (free users)
  onPrint?: (singleOrderBuyer: Buyer) => void;             // 5g — print the slip (App.tsx:4341)
  onEnsureWindow?: () => void;                             // multi-day — open window if needed (once/window; N=1 no-op)
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

export function useOrders({ getBuyers, applyOrder, sessionDate, isCapped, onCapBlocked, onCapReached, afterWrite, onPrint, onEnsureWindow }: UseOrdersDeps): UseOrders {
  const createOrder = useCallback((c: ProdComment, price: number, opts?: CreateOrderOpts): LiveOrder | null => {
    // 0) Free-tier HARD STOP soft block (App.tsx:4330). The DB trigger is still
    //    authoritative; this is the friendly block before we try.
    if (isCapped?.()) { onCapBlocked?.(); return null; }
    // 0b) Multi-day: open the window if none active (writes window_start once per
    //     window; N=1 → no-op). Does NOT affect this order's numbering (that comes
    //     from the loaded window buyers); fire-and-forget, like the DB writes.
    onEnsureWindow?.();
    // 1) SAME pure builder production uses (buyer numbering + orderNum epoch ms).
    const { order, nextBuyers, singleOrderBuyer } = buildOrderFromComment(c, getBuyers(), price, new Date());
    // 2) optimistic local update so the summary strip + Orders tab reflect it now.
    applyOrder(nextBuyers, order);
    // 3) print the slip BEFORE the writes (App.tsx:4341-4345) — singleOrderBuyer is
    //    the buyer carrying just this order, exactly what production prints.
    onPrint?.(singleOrderBuyer);
    // 4) SAME three exported writes, SAME payload shapes, fire-and-forget (non-atomic
    //    by design — matches production; do not "improve").
    void Promise.all([
      saveOrderToDatabase(orderDbPayload(c, order)),
      saveLiveSessionOrder(liveSessionPayload(c, order, sessionDate)),
      saveCustomerToDatabase(customerDbPayload(c, order)),
    ]).catch((err) => {
      // If a race got past the soft block, the DB cap trigger rejects the insert —
      // surface the hard-stop popup (5f). Other errors: log only.
      if (isCapError(err)) onCapReached?.(err);
      else console.warn("Background database save failed", err);
    });
    // 4b) Auto Mode linkage (gated): for a code-driven order, atomically decrement the
    //     product stock + stamp last_ordered_at via the RPC. Fire-and-forget, like the
    //     writes above. Manual orders pass no opts → this never runs (5e byte-identical).
    if (opts?.productLocalId) void decrementStockAndTouch(opts.productLocalId).catch(() => {});
    // 5) resync the usage counter (App.tsx:4384 — free users).
    afterWrite?.();
    return order;
  }, [getBuyers, applyOrder, sessionDate, isCapped, onCapBlocked, onCapReached, afterWrite, onPrint, onEnsureWindow]);

  return { createOrder };
}
