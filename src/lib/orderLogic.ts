// Pure order-assembly core, extracted from App.tsx createOrderFromComment
// (Phase 2b). NO side effects: no setState, no localStorage, no DB, no
// printing, no clock reads — the caller supplies `now` once.
//
// Behaviour notes (load-bearing, do not "fix" casually):
//   - buyerNum uses `existing?.num || buyers.length+1` (|| not ??) — kept
//     byte-identical to the original.
//   - order.orderNum = now.getTime() (epoch ms). The Android BT sticker
//     pipeline re-derives Taiwan local time from this when >1e12.
//   - order.date = now.toISOString().slice(0,10) — UTC calendar day,
//     intentionally NOT unified with device-local liveDayId; changing that
//     is a separate owner decision.
import type { Comment, Buyer, LiveOrder } from "./orderTypes";

export interface OrderBuildResult {
  order: LiveOrder;
  nextBuyer: Buyer;
  singleOrderBuyer: Buyer;
  nextBuyers: Buyer[];
  existing: Buyer | undefined;
}

export function buildOrderFromComment(c: Comment, buyers: Buyer[], price: number, now: Date): OrderBuildResult {
  const existing = buyers.find(b => b.handle === c.handle && b.platform === c.platform);
  const buyerNum = existing?.num || buyers.length + 1;
  const orderItem = price > 0 ? String(price) : (c.comment || "Live comment order");
  const order: LiveOrder = {
    orderNum: now.getTime(),
    item: orderItem,
    qty: 1,
    price,
    total: price,
    time: c.time || now.toLocaleTimeString(),
    handle: c.handle,
    name: c.name || c.handle,
    bNum: buyerNum,
    platform: c.platform,
    status: "New",
    date: now.toISOString().slice(0, 10),
  };
  const nextBuyer: Buyer = existing
    ? { ...existing, name: c.name || existing.name, orders: [...existing.orders, order], totalOrders: existing.totalOrders + 1, totalSpent: existing.totalSpent + order.total }
    : { handle: c.handle, name: c.name || c.handle, platform: c.platform, num: buyerNum, orders: [order], totalOrders: 1, totalSpent: order.total };
  const singleOrderBuyer: Buyer = { ...nextBuyer, orders: [order], totalOrders: 1, totalSpent: order.total };

  const nextBuyers = existing ? buyers.map(b => b.handle === c.handle && b.platform === c.platform ? nextBuyer : b) : [...buyers, nextBuyer];

  return { order, nextBuyer, singleOrderBuyer, nextBuyers, existing };
}
