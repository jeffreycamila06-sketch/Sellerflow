// 7-11 shipping (P1) — pure logic: session-window key, buyer grouping, 賣貨便
// validators (name width budget / phone / store / amount rules), draft builder.
import { describe, it, expect } from "vitest";
import {
  sessionKeyFor, buyerGroupsFrom, defaultProductDesc, draftEntryFor,
  nameLength, validateRecipientName, validPhone, validStore, validateAmounts,
  validateEntry, entryIsValid, codTotal,
  SHIP_DEFAULT_FEE, SHIP_TEMP_AMBIENT,
} from "../shipping";
import type { Buyer, LiveOrder } from "../../../lib/orderTypes";

const order = (over: Partial<LiveOrder>): LiveOrder => ({
  orderNum: 1750000000000, item: "A150", qty: 1, price: 150, total: 150, time: "10:00",
  handle: "lhey", name: "Lhey", bNum: 1, platform: "TikTok", status: "New", date: "2026-07-03", ...over,
});
const buyer = (num: number, handle: string, orders: LiveOrder[]): Buyer => ({
  handle, name: handle ? `${handle} name` : "", platform: "TikTok", num, orders,
  totalSpent: orders.reduce((s, o) => s + o.total, 0), totalOrders: orders.length,
});

describe("sessionKeyFor — one bucket per session window", () => {
  it("1-day window → the Taipei day id (byte-identical to the day bucket)", () => {
    expect(sessionKeyFor("2026-07-03", null, 1)).toBe("2026-07-03");
    expect(sessionKeyFor("2026-07-03", "2026-07-03", 1)).toBe("2026-07-03");
  });
  it("ACTIVE multi-day window → '<start>~<N>d' for every day in the window", () => {
    expect(sessionKeyFor("2026-07-03", "2026-07-02", 3)).toBe("2026-07-02~3d");
    expect(sessionKeyFor("2026-07-04", "2026-07-02", 3)).toBe("2026-07-02~3d"); // day 3, same bucket
  });
  it("EXPIRED window falls back to the day id (fresh bucket)", () => {
    expect(sessionKeyFor("2026-07-08", "2026-07-02", 3)).toBe("2026-07-08");
  });
});

describe("buyerGroupsFrom — one group per buyer# (the bag)", () => {
  it("maps buyers to groups sorted by buyer# with item counts + totals + order ids", () => {
    const groups = buyerGroupsFrom([
      buyer(5, "bea", [order({ bNum: 5, orderNum: 3, total: 300 })]),
      buyer(1, "ana", [order({ bNum: 1, orderNum: 1, total: 150 }), order({ bNum: 1, orderNum: 2, total: 200 })]),
    ]);
    expect(groups.map((g) => g.bNum)).toEqual([1, 5]);
    expect(groups[0]).toMatchObject({ handle: "ana", items: 2, total: 350, orderIds: [1, 2] });
    expect(groups[1]).toMatchObject({ handle: "bea", items: 1, total: 300 });
  });
  it("empty session → no groups", () => {
    expect(buyerGroupsFrom([])).toEqual([]);
  });
});

describe("draft entry", () => {
  it("defaultProductDesc carries the buyer# for bag matching", () => {
    expect(defaultProductDesc(7, 12)).toBe("#7 商品x12");
  });
  it("draftEntryFor prefills 賣貨便 defaults; username goes to col J, NEVER col A", () => {
    const g = buyerGroupsFrom([buyer(3, "kuyajohn_", [order({ bNum: 3, total: 500 })])])[0];
    const e = draftEntryFor(g, "2026-07-03", "id-1");
    expect(e).toMatchObject({
      buyerNumber: 3, bagNumber: 1, orderAmount: 500, shippingFee: SHIP_DEFAULT_FEE,
      tempLayer: SHIP_TEMP_AMBIENT, productDesc: "#3 商品x1", buyerUsername: "kuyajohn_",
      recipientName: "", status: "draft",
    });
  });
});

describe("取件人姓名 validator — width budget + forbidden chars", () => {
  it("Chinese counts 2 per char: 5 Chinese ok, 6 too long; 10 ASCII ok, 11 too long", () => {
    expect(nameLength("王小明")).toBe(6);
    expect(validateRecipientName("王小明陳大")).toBe("");           // 5 CJK = 10
    expect(validateRecipientName("王小明陳大王")).toBe("too_long");  // 6 CJK = 12
    expect(validateRecipientName("Anna Cruzab")).toBe("too_long");   // 11 ASCII
    expect(validateRecipientName("Anna Cruza")).toBe("");            // 10 ASCII (space allowed)
  });
  it("digits and symbols are forbidden (username shapes must fail)", () => {
    for (const bad of ["kuyajohn_", "maria88", "ana-cruz", "a.b", "王@明", "[ana]", "a+b"]) {
      expect(validateRecipientName(bad)).toBe("forbidden");
    }
  });
  it("empty → required", () => {
    expect(validateRecipientName("  ")).toBe("required");
  });
});

describe("phone / store validators", () => {
  it("phone: exactly 10 digits starting 09", () => {
    expect(validPhone("0912345678")).toBe(true);
    for (const bad of ["09123456789", "091234567", "0812345678", "09-12345678", ""]) expect(validPhone(bad)).toBe(false);
  });
  it("store: exactly 6 digits", () => {
    expect(validStore("123456")).toBe(true);
    for (const bad of ["12345", "1234567", "12a456", ""]) expect(validStore(bad)).toBe(false);
  });
});

describe("amount rules — 55 ≤ order+fee ≤ 20,000; fee 0–100", () => {
  it("boundaries", () => {
    expect(validateAmounts(0, 55)).toBe("");            // exactly at the floor
    expect(validateAmounts(0, 54)).toBe("total_low");
    expect(validateAmounts(19900, 100)).toBe("");       // exactly at the ceiling
    expect(validateAmounts(19999, 60)).toBe("total_high");
    expect(validateAmounts(100, 101)).toBe("fee_range");
    expect(validateAmounts(100, -1)).toBe("fee_range");
    expect(validateAmounts(20001, 0)).toBe("order_range");
  });
  it("free shipping (fee 0) is valid as long as the total stays ≥ 55", () => {
    expect(validateAmounts(55, 0)).toBe("");
    expect(validateAmounts(54, 0)).toBe("total_low");
  });
  it("codTotal = order + fee (buyer pays both at pickup)", () => {
    expect(codTotal(500, 60)).toBe(560);
    expect(codTotal(500, 0)).toBe(500);
  });
});

describe("validateEntry / entryIsValid — full-form gate", () => {
  const g = buyerGroupsFrom([buyer(1, "ana", [order({ total: 500 })])])[0];
  const valid = { ...draftEntryFor(g, "2026-07-03", "id"), recipientName: "王小明", phone: "0912345678", storeId: "123456" };
  it("clean entry passes", () => {
    expect(entryIsValid(valid)).toBe(true);
  });
  it("each broken field blocks the save", () => {
    expect(entryIsValid({ ...valid, recipientName: "maria88" })).toBe(false);
    expect(entryIsValid({ ...valid, phone: "123" })).toBe(false);
    expect(entryIsValid({ ...valid, storeId: "12" })).toBe(false);
    expect(entryIsValid({ ...valid, productDesc: "" })).toBe(false);
    expect(entryIsValid({ ...valid, productDesc: "x".repeat(201) })).toBe(false);
    expect(entryIsValid({ ...valid, shippingFee: 200 })).toBe(false);
    expect(validateEntry({ ...valid, orderAmount: 0, shippingFee: 0 }).amounts).toBe("total_low");
  });
});

// ── P3a split bags — pure: summary/labels/entries/validation ──────────────────
import { splitSummary, buildBagEntries, validateSplit, splitIsValid, bagDesc, mustSplit, type SharedRecipient } from "../shipping";

describe("split bags (P3a)", () => {
  const g = buyerGroupsFrom([buyer(4, "ana", [
    order({ orderNum: 1, item: "A100", total: 100 }),
    order({ orderNum: 2, item: "B200", total: 200 }),
    order({ orderNum: 3, item: "C300", total: 300 }),
  ])])[0];
  const shared: SharedRecipient = { recipientName: "王小明", phone: "0912345678", storeId: "123456", tempLayer: "常溫" };

  it("splitSummary groups assigned items per bag; unassigned counted", () => {
    const { bags, unassigned } = splitSummary(g.orderList, { 1: 1, 2: 2, 3: 2 }, 2);
    expect(bags[0]).toEqual({ orderIds: [1], items: 1, amount: 100 });
    expect(bags[1]).toEqual({ orderIds: [2, 3], items: 2, amount: 500 });
    expect(unassigned).toBe(0);
    expect(splitSummary(g.orderList, { 1: 1 }, 2).unassigned).toBe(2);
  });

  it("bagDesc carries buyer# + Bag i/n for the 寄件單↔bag match", () => {
    expect(bagDesc(4, 2, 1, 2)).toBe("#4 商品x2 Bag 1/2");
  });

  it("buildBagEntries: shared recipient copied to every bag, own fee each, ids preserved", () => {
    const { bags } = splitSummary(g.orderList, { 1: 1, 2: 2, 3: 2 }, 2);
    const rows = buildBagEntries(g, "2026-07-03", bags, shared, 38, ["id-a", "id-b"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "id-a", bagNumber: 1, orderAmount: 100, shippingFee: 38, recipientName: "王小明", phone: "0912345678", storeId: "123456", productDesc: "#4 商品x1 Bag 1/2", status: "encoded", buyerUsername: "ana" });
    expect(rows[1]).toMatchObject({ id: "id-b", bagNumber: 2, orderAmount: 500, includedOrderIds: [2, 3], productDesc: "#4 商品x2 Bag 2/2" });
  });

  it("validateSplit blocks: unassigned items, empty bags, per-bag amount rules", () => {
    expect(splitIsValid(validateSplit(g.orderList, { 1: 1, 2: 2, 3: 2 }, 2, shared, 38))).toBe(true);
    expect(validateSplit(g.orderList, { 1: 1 }, 2, shared, 38).unassigned).toBe(2);
    expect(validateSplit(g.orderList, { 1: 1, 2: 1, 3: 1 }, 2, shared, 38).emptyBags).toEqual([2]);
    // bag below the NT$55 floor (100 assigned alone is fine w/ fee 0? 100+0 ≥ 55 ok → use tiny order)
    const tiny = buyerGroupsFrom([buyer(5, "b", [order({ orderNum: 9, total: 10 }), order({ orderNum: 10, total: 500 })])])[0];
    const r = validateSplit(tiny.orderList, { 9: 1, 10: 2 }, 2, shared, 0);
    expect(r.bagAmounts).toEqual([{ bag: 1, err: "total_low" }]);
    // shared recipient rules still enforced once
    expect(validateSplit(g.orderList, { 1: 1, 2: 2, 3: 2 }, 2, { ...shared, recipientName: "maria88" }, 38).name).toBe("forbidden");
  });

  it("mustSplit: only above the NT$20,000 per-row cap", () => {
    expect(mustSplit(20000)).toBe(false);
    expect(mustSplit(20001)).toBe(true);
  });
});
