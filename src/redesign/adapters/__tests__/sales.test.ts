// Sales aggregation — parity with App.tsx Sales (1977-2009). Pure, no Supabase/React.
import { describe, it, expect } from "vitest";
import { computeSales } from "../sales";
import type { LiveOrder, Buyer } from "../../../lib/orderTypes";

const o = (over: Partial<LiveOrder> = {}): LiveOrder => ({
  orderNum: 1750000000000, item: "Lipstick", qty: 1, price: 100, total: 100, time: "9:00:00 PM",
  handle: "a", name: "Ann", bNum: 1, platform: "TikTok", status: "New", date: "2026-06-26", ...over,
});
const buyer = (n: number): Buyer => ({ handle: `h${n}`, name: `B${n}`, platform: "TikTok", num: n, orders: [], totalOrders: 1, totalSpent: 0 } as Buyer);

// VERBATIM reference (App.tsx:1978-1994, 2005-2006).
function ref(orders: LiveOrder[], buyers: Buyer[]) {
  const tot = orders.reduce((s, x) => s + x.total, 0);
  const ttR = orders.filter((x) => x.platform === "TikTok").reduce((s, x) => s + x.total, 0);
  const fbR = orders.filter((x) => x.platform === "Facebook").reduce((s, x) => s + x.total, 0);
  const im: Record<string, { qty: number; rev: number }> = {};
  orders.forEach((x) => { if (!im[x.item]) im[x.item] = { qty: 0, rev: 0 }; im[x.item].qty += x.qty; im[x.item].rev += x.total; });
  const top = Object.entries(im).sort((a, b) => b[1].rev - a[1].rev).slice(0, 8);
  return { tot, ttR, fbR, top, avg: orders.length ? Math.round(tot / orders.length) : 0, buyers: buyers.length };
}

describe("computeSales", () => {
  it("matches the App.tsx reference for totals / avg / platform split", () => {
    const orders = [o({ total: 320, platform: "TikTok", item: "Lipstick", qty: 2 }), o({ total: 150, platform: "Facebook", item: "Tumbler" }), o({ total: 250, platform: "TikTok", item: "Lipstick" })];
    const buyers = [buyer(1), buyer(2)];
    const s = computeSales(orders, buyers);
    const r = ref(orders, buyers);
    expect(s.total).toBe(r.tot);              // 720
    expect(s.tiktok.rev).toBe(r.ttR);          // 570
    expect(s.facebook.rev).toBe(r.fbR);        // 150
    expect(s.avg).toBe(r.avg);                 // round(720/3)=240
    expect(s.buyers).toBe(2);
    expect(s.orders).toBe(3);
    expect(s.tiktok.count).toBe(2);
    expect(s.facebook.count).toBe(1);
    expect(s.tiktok.share).toBe(Math.round(570 / 720 * 100)); // 79
    expect(s.facebook.share).toBe(Math.round(150 / 720 * 100)); // 21
  });
  it("aggregates per-item qty+revenue and sorts top by revenue (max 8)", () => {
    const orders = [o({ item: "A", total: 100, qty: 1 }), o({ item: "A", total: 100, qty: 3 }), o({ item: "B", total: 500, qty: 1 })];
    const s = computeSales(orders, []);
    expect(s.top[0]).toEqual({ item: "B", qty: 1, rev: 500 });
    expect(s.top[1]).toEqual({ item: "A", qty: 4, rev: 200 });
  });
  it("zero-safe on an empty session", () => {
    const s = computeSales([], []);
    expect(s).toMatchObject({ total: 0, orders: 0, buyers: 0, avg: 0, top: [] });
    expect(s.tiktok).toEqual({ count: 0, rev: 0, share: 0 });
  });
});
