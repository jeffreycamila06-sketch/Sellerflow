// Sales aggregation — pure, byte-faithful to App.tsx `Sales` (1977-2009): totals
// over the CURRENT live session (orders + buyers), top products by revenue, and
// the TikTok/Facebook revenue split. Same data the redesign already loads
// (liveSession.session). Unit-tested. NO weekly history — production has none.
import type { LiveOrder, Buyer } from "../../lib/orderTypes";

export interface SalesTopItem { item: string; qty: number; rev: number }
export interface SalesPlatform { count: number; rev: number; share: number }
export interface SalesSummary {
  total: number; orders: number; buyers: number; avg: number;
  top: SalesTopItem[];
  tiktok: SalesPlatform;
  facebook: SalesPlatform;
}

export function computeSales(orders: LiveOrder[], buyers: Buyer[]): SalesSummary {
  const total = orders.reduce((s, o) => s + (o.total || 0), 0);                          // App.tsx:1978
  const ttR = orders.filter((o) => o.platform === "TikTok").reduce((s, o) => s + (o.total || 0), 0);   // 1979
  const fbR = orders.filter((o) => o.platform === "Facebook").reduce((s, o) => s + (o.total || 0), 0); // 1980
  const ttCount = orders.filter((o) => o.platform === "TikTok").length;
  const fbCount = orders.filter((o) => o.platform === "Facebook").length;
  // per-item {qty, rev}, top 8 by revenue (1981-1983).
  const im: Record<string, { qty: number; rev: number }> = {};
  orders.forEach((o) => { if (!im[o.item]) im[o.item] = { qty: 0, rev: 0 }; im[o.item].qty += o.qty; im[o.item].rev += o.total; });
  const top = Object.entries(im).sort((a, b) => b[1].rev - a[1].rev).slice(0, 8).map(([item, d]) => ({ item, qty: d.qty, rev: d.rev }));
  return {
    total,
    orders: orders.length,
    buyers: buyers.length,
    avg: orders.length ? Math.round(total / orders.length) : 0,    // 1994
    top,
    tiktok: { count: ttCount, rev: ttR, share: total ? Math.round((ttR / total) * 100) : 0 },   // 2005
    facebook: { count: fbCount, rev: fbR, share: total ? Math.round((fbR / total) * 100) : 0 },  // 2006
  };
}
