// Per-buyer basket count for the Live comment feed (Chotdon-inspired): each
// comment row shows 🛒N = how many CREATED ORDERS that buyer has in the CURRENT
// session window. DISPLAY-ONLY derivation over the existing client session state:
//
//   • Source = liveSession.session.buyers — each Buyer already carries
//     totalOrders, maintained by the SAME tangled-zone order logic
//     (buildOrderFromComment / rebuildSessionFromRows / applyOrder). No new
//     query, no polling, no new window math: the session state is ALREADY
//     window-scoped (the 1/2/3-day session load + midnight/window reset live in
//     useLiveSession/useSessionWindow), so a new window = empty buyers = counts
//     reset to 0 automatically.
//   • Identity key mirrors rebuildSessionFromRows EXACTLY: `${handle} ${platform}`
//     (handle raw, no @; platform "TikTok"/"Facebook").
//   • Performance: ONE Map built per session change (memoized by the caller);
//     each feed row does an O(1) lookup — never a per-row scan of the order list.
import type { Buyer } from "../../lib/orderTypes";

// Same composite key format the session rebuild uses (orderLogic.ts:94).
export const buyerBasketKey = (handle: string, platform: string): string => `${handle} ${platform}`;

export function buildBasketCounts(buyers: Buyer[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of buyers) {
    if (!b || !b.handle) continue;
    m.set(buyerBasketKey(b.handle, b.platform), b.totalOrders || 0);
  }
  return m;
}

// Feed rows carry the DISPLAY handle ("@maria") — strip the prefix to match the
// raw order-side handle. Missing platform/handle or no entry → 0 (no badge).
export function basketCountFor(counts: Map<string, number>, displayHandle: string, platform: string | undefined): number {
  const handle = String(displayHandle || "").replace(/^@+/, "").trim();
  if (!handle || !platform) return 0;
  return counts.get(buyerBasketKey(handle, platform)) || 0;
}
