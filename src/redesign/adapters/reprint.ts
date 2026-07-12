// REPRINT (FLive-parity, Jeff 2026-07-12) — print a COPY of an existing
// order's sticker/slip: NO new order, NO buyer#, NO stock decrement, NO DB
// write of any kind. "Reprint lang, di magiging bagong order, di mababago ang
// lahat."
//
// ZERO-WRITE CONTRACT (pinned by reprint.test.ts): this module imports ONLY
// the pure lib rebuild + the existing print entry point. It must NEVER import
// db.ts / useOrders / productsDb / useFreeCap — a reprint is printSlip and
// nothing else (the proven onPrintWinner pattern: RedesignApp prints a buyer
// through printSlip with zero order-creation, live since the raffle feature).
//
// DATA SOURCES (zero new queries — egress discipline):
//   • restored / after-refresh rows: the SAME window-load rows that already
//     feed the ordered-check (useLiveSession keeps a msgId → row Map now);
//   • in-session orders: a row-shaped snapshot captured at the three
//     create-success sites (1-Click / Enterprise / Auto) from (comment, order).
//
// PARITY BY CONSTRUCTION: the reprint Buyer is built by the REAL
// rebuildSessionFromRows on a single row — the exact code path that rebuilds
// the session after a refresh. No duplicated math to drift; orderNum round-
// trips through created_at (epoch ms → ISO → epoch ms), so the reprinted
// sticker derives the ORIGINAL order's Taiwan time, not "now".
import { rebuildSessionFromRows, type LiveSessionRow } from "../../lib/orderLogic";
import type { Buyer, Comment as ProdComment, LiveOrder } from "../../lib/orderTypes";
import { printSlip, type Settings, type PrintResult } from "./printing";

// A reprint snapshot IS a session row (the load already returns this shape).
export type ReprintRow = LiveSessionRow;

// Row-shaped snapshot from an in-session create — the three success sites have
// (comment, order) in hand. created_at carries order.orderNum (the epoch-ms
// value the BT sticker pipeline derives Taiwan time from) so the reprint
// renders the ORIGINAL order time. Mirrors liveSessionPayload's field choices
// (handle / name-fallback / product=item / price) — the same values the DB row
// of this order will contain after the fire-and-forget write lands.
export function snapshotFromCreate(c: ProdComment, order: LiveOrder): ReprintRow {
  return {
    buyer_number: order.bNum,
    handle: c.handle,
    customer_name: c.name || c.handle,
    platform: c.platform,
    product: order.item,
    price: order.price,
    created_at: new Date(order.orderNum).toISOString(),
    session_date: order.date,
  };
}

// Single-order Buyer for printSlip — via the REAL rebuild (parity, not a copy).
export function reprintBuyer(row: ReprintRow | null | undefined): Buyer | null {
  if (!row) return null;
  const { buyers } = rebuildSessionFromRows([row]);
  return buyers[0] || null;
}

// The whole reprint action: rebuild the original buyer → printSlip. Nothing
// else — no order creation, no state change, no write (contract-tested).
export function performReprint(row: ReprintRow, cur: string, storeName: string, settings: Settings): PrintResult {
  const buyer = reprintBuyer(row);
  if (!buyer) return { ok: false, via: "none" };
  return printSlip(buyer, cur, storeName, settings);
}
