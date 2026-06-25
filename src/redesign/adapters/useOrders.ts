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
// 200-cap trigger (check_and_increment_free_order) stays authoritative and
// UNTOUCHED — we insert via the existing saveOrderToDatabase; if a free account
// is over cap the trigger rejects the insert and we surface it in 5f.
import { useCallback } from "react";
import { buildOrderFromComment } from "../../lib/orderLogic";
import type { Comment as ProdComment, Buyer, LiveOrder } from "../../lib/orderTypes";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../db";

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
}

export interface UseOrders {
  createOrder: (c: ProdComment, price: number) => LiveOrder;
}

export function useOrders({ getBuyers, applyOrder, sessionDate }: UseOrdersDeps): UseOrders {
  const createOrder = useCallback((c: ProdComment, price: number): LiveOrder => {
    // 1) SAME pure builder production uses (buyer numbering + orderNum epoch ms).
    const { order, nextBuyers } = buildOrderFromComment(c, getBuyers(), price, new Date());
    // 2) optimistic local update so the summary strip + Orders tab reflect it now.
    applyOrder(nextBuyers, order);
    // 3) SAME three exported writes, SAME payload shapes, fire-and-forget (non-atomic
    //    by design — matches production; do not "improve").
    void Promise.all([
      saveOrderToDatabase(orderDbPayload(c, order)),
      saveLiveSessionOrder(liveSessionPayload(c, order, sessionDate)),
      saveCustomerToDatabase(customerDbPayload(c, order)),
    ]).catch((err) => {
      // Cap enforcement is the DB trigger's job; surfacing the popup is 5f.
      console.warn("Background database save failed", err);
    });
    return order;
  }, [getBuyers, applyOrder, sessionDate]);

  return { createOrder };
}
