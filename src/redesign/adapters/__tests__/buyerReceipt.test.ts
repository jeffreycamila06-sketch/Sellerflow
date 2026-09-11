// Buyer receipt helper (2026-09-11) — a numeric Orders search shows one grouped
// card: buyer #N's orders this session + total. PURE, zero I/O. Total =
// buyer.totalSpent (never re-summed); EXACT num match (never #10/#11 for "1").
import { describe, it, expect } from "vitest";
import { buyerReceipt } from "../useReadData";
import type { Buyer, LiveOrder } from "../../../lib/orderTypes";

const ord = (item: string, total: number): LiveOrder => ({
  orderNum: 1e12 + total, item, qty: 1, price: total, total, time: "1:00:00 PM",
  handle: "@x", name: "X", bNum: 1, platform: "TikTok", status: "New", date: "2026-09-11",
});
const buyer = (num: number, name: string, orders: LiveOrder[], totalSpent: number): Buyer =>
  ({ handle: `@${name.toLowerCase()}`, name, platform: "TikTok", num, orders, totalSpent, totalOrders: orders.length });

const buyers: Buyer[] = [
  buyer(1, "Maria", [ord("Red dress M", 550), ord("Blue top L", 380), ord("Sneakers 38", 890)], 1820),
  buyer(10, "Ken", [ord("Cap", 200)], 200),
  buyer(11, "Lia", [ord("Bag", 900)], 900),
];

describe("buyerReceipt", () => {
  it("returns the buyer's lines, count, and precomputed total", () => {
    const r = buyerReceipt(buyers, 1)!;
    expect(r.num).toBe(1);
    expect(r.name).toBe("Maria");
    expect(r.handle).toBe("@maria");
    expect(r.lines).toEqual([
      { item: "Red dress M", total: 550 },
      { item: "Blue top L", total: 380 },
      { item: "Sneakers 38", total: 890 },
    ]);
    expect(r.count).toBe(3);
    expect(r.total).toBe(1820); // buyer.totalSpent, NOT re-summed
  });

  it("EXACT num match — 1 is buyer #1, never #10/#11", () => {
    expect(buyerReceipt(buyers, 1)!.name).toBe("Maria");
    expect(buyerReceipt(buyers, 10)!.name).toBe("Ken");
    expect(buyerReceipt(buyers, 11)!.name).toBe("Lia");
  });

  it("null when no buyer has that number", () => {
    expect(buyerReceipt(buyers, 99)).toBeNull();
    expect(buyerReceipt([], 1)).toBeNull();
  });

  it("falls back to the handle when the name is blank", () => {
    const b = buyer(5, "", [ord("Item", 100)], 100);
    b.name = "";
    expect(buyerReceipt([b], 5)!.name).toBe("@");
  });

  it("handles a large buyer (137 orders) — count + total intact", () => {
    const many = Array.from({ length: 137 }, (_, i) => ord(`Item ${i + 1}`, 100));
    const r = buyerReceipt([buyer(2, "Big", many, 13700)], 2)!;
    expect(r.lines).toHaveLength(137);
    expect(r.count).toBe(137);
    expect(r.total).toBe(13700);
  });
});
