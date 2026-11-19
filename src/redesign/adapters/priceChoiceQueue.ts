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
  rowId: string | null;     // the feed row (1-Click: always; pin: when the pinned comment is in the feed)
  msgId: string;            // "" when unknown (Facebook)
  name: string;
  handle: string;
  comment: string;
  pin?: ProdComment & { msgId: string }; // the built pin comment (kind "pin")
}

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

// Remove one item (after a price, Type price or Skip).
export function dropPriceChoice(q: PriceChoiceQueue, sessionKey: string, key: string): PriceChoiceQueue {
  const items = queueItems(q, sessionKey);
  return { sessionKey, items: items.filter((x) => x.key !== key) };
}

export function isQueued(q: PriceChoiceQueue, sessionKey: string, key: string, msgId?: string): boolean {
  return queueItems(q, sessionKey).some((x) => x.key === key || (!!msgId && x.msgId === msgId));
}
