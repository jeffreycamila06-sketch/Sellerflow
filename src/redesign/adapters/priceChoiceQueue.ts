// "Choose price before print" — the queue of comments waiting for a price (pure, unit-tested).
// RedesignApp keeps it in React state; one pop-up shows the FIRST item, in arrival order.
//
// The queue belongs to ONE live session (`sessionKey`): when the key changes (the session ended
// or a new one started) the old items are gone — `queueItems` shows nothing and the next push
// starts a fresh list. No effect, no timer.
import type { Comment as ProdComment } from "../../lib/orderTypes";

export interface PriceChoiceItem {
  key: string;              // "click:<row id>" or "pin:<msgId>"
  kind: "click" | "pin";
  rowId: string | null;     // the feed row a 1-Click tap came from (null for a pin)
  msgId: string;            // "" when unknown (Facebook)
  name: string;
  handle: string;
  comment: string;
  // The FULL comment the order is made from (1-Click: the feed comment at tap time; pin: the built
  // pin comment). The order never re-reads the feed, so a cleared / scrolled feed loses nobody.
  source: ProdComment;
  // The seller already answered "sold out — continue?" for this comment at tap time (1-Click).
  soldOutOk: boolean;
}

// What a price tap did. "blocked" = nothing was created and the comment keeps waiting.
export type PriceCommit = "ordered" | "duplicate" | "blocked";
// "capped" = the free order limit was reached while the comment waited: the item is dropped
// quietly (the limit pop-up explains).
export type PickResult = PriceCommit | "busy" | "capped" | { soldOut: string };

export interface PriceChoiceQueue { sessionKey: string; items: PriceChoiceItem[] }

export const EMPTY_PRICE_QUEUE: PriceChoiceQueue = { sessionKey: "", items: [] };

// The items of the CURRENT session only.
export function queueItems(q: PriceChoiceQueue, sessionKey: string): PriceChoiceItem[] {
  return q.sessionKey === sessionKey ? q.items : [];
}

// Add at the end. The same comment never waits twice (same key, or same msgId — a 1-Click
// tap and a pin of the same comment are one comment).
export function enqueuePriceChoice(q: PriceChoiceQueue, sessionKey: string, item: PriceChoiceItem): PriceChoiceQueue {
  const items = queueItems(q, sessionKey);
  const dup = items.some((x) => x.key === item.key || (!!item.msgId && x.msgId === item.msgId));
  if (dup) return q.sessionKey === sessionKey ? q : { sessionKey, items };
  return { sessionKey, items: [...items, item] };
}

// Remove one item (after an order, a duplicate or Skip).
export function dropPriceChoice(q: PriceChoiceQueue, sessionKey: string, key: string): PriceChoiceQueue {
  const items = queueItems(q, sessionKey);
  return { sessionKey, items: items.filter((x) => x.key !== key) };
}

export function isQueued(q: PriceChoiceQueue, sessionKey: string, key: string, msgId?: string): boolean {
  return queueItems(q, sessionKey).some((x) => x.key === key || (!!msgId && x.msgId === msgId));
}

// How many waiting comments a key change throws away (0 = nothing to say).
export function clearedCount(q: PriceChoiceQueue, sessionKey: string): number {
  return q.sessionKey !== sessionKey ? q.items.length : 0;
}

// The pop-up ignores every tap for this long after it appears (a second fast tap on the same spot
// must not land on the NEXT waiting comment's button).
export const TAP_GUARD_MS = 400;

// Long price labels ("NT$12,000", "€1,234.50") get a smaller font so they never clip at 360px.
export function priceLabelSize(label: string): number {
  const n = [...label].length;
  return n <= 5 ? 19 : n <= 7 ? 17 : n <= 9 ? 14 : n <= 11 ? 12 : 10.5;
}
