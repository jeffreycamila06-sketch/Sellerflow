// Cancel order (sql/234) — the pure helpers, the optional-column fallbacks, the RPC wrappers and the
// db.ts insert fallback (order saved without the tag when the column is not there yet).
import { describe, it, expect, vi, beforeEach } from "vitest";

const S = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; rows: Array<Record<string, unknown>> }>,
  refuseTag: false,
  rpcAnswer: null as unknown,
  rpcError: null as unknown,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })), getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })) },
    rpc: vi.fn(async (fn: string, args: unknown) => { S.rpcCalls.push({ fn, args }); return { data: S.rpcAnswer, error: S.rpcError }; }),
    from: vi.fn((table: string) => ({
      insert: (rows: Array<Record<string, unknown>>) => {
        S.inserts.push({ table, rows });
        const refused = S.refuseTag && rows.some((r) => "order_ref" in r);
        return { select: async () => (refused ? { data: null, error: { code: "PGRST204", message: "Could not find the 'order_ref' column of 'orders' in the schema cache" } } : { data: rows, error: null }) };
      },
    })),
  },
}));

import { visibleSession, markCancelled, isMissingColumnError, withCancelCols, keepNotCancelled, orderCancelVisible, newOrderRef,
  checkOrderCancel, cancelOrder, undoCancelOrder, __resetCancelCols, cancelColsMissing } from "../orderCancel";
import { saveOrderToDatabase, saveLiveSessionOrder } from "../../../db";
import { rebuildSessionFromRows, type LiveSessionRow } from "../../../lib/orderLogic";

const row = (n: number, bn: number, h: string, price: number, extra: Partial<LiveSessionRow> = {}): LiveSessionRow =>
  ({ buyer_number: bn, handle: h, customer_name: h, platform: "TikTok", product: `item${n}`, price, created_at: new Date(Date.UTC(2026, 10, 28, 5, n)).toISOString(), session_date: "2026-11-28", ...extra } as LiveSessionRow);

beforeEach(() => { S.inserts = []; S.refuseTag = false; S.rpcAnswer = null; S.rpcError = null; S.rpcCalls = []; __resetCancelCols(); });

describe("visibleSession / markCancelled", () => {
  it("nothing cancelled → the SAME object (no extra render, same as before)", () => {
    const full = rebuildSessionFromRows([row(1, 1, "ana", 100, { order_ref: "a" }), row(2, 2, "ben", 50)]);
    expect(visibleSession(full)).toBe(full);
  });
  it("a cancelled order leaves the totals; a buyer with only cancelled orders leaves the list", () => {
    const full = rebuildSessionFromRows([
      row(1, 1, "ana", 100, { order_ref: "a" }), row(2, 1, "ana", 30, { order_ref: "b", cancelled_at: "2026-11-28T05:10:00Z" }),
      row(3, 2, "ben", 50, { order_ref: "c", cancelled_at: "2026-11-28T05:11:00Z" }),
    ]);
    expect(full.orders.filter((o) => o.cancelled)).toHaveLength(2);
    const v = visibleSession(full);
    expect(v.orders.map((o) => o.item)).toEqual(["item1"]);
    expect(v.buyers).toHaveLength(1);
    expect(v.buyers[0]).toMatchObject({ num: 1, totalOrders: 1, totalSpent: 100 });
  });
  it("markCancelled flips one tag and back; an unknown tag changes nothing (same object)", () => {
    const full = rebuildSessionFromRows([row(1, 1, "ana", 100, { order_ref: "a" }), row(2, 2, "ben", 50, { order_ref: "b" })]);
    const m = markCancelled(full, "b", true);
    expect(m.orders.find((o) => o.ref === "b")!.cancelled).toBe(true);
    expect(m.buyers.find((b) => b.num === 2)!.orders[0].cancelled).toBe(true);
    expect(visibleSession(m).buyers.map((b) => b.num)).toEqual([1]);
    const back = markCancelled(m, "b", false);
    expect(back.orders.find((o) => o.ref === "b")!.cancelled).toBeUndefined();
    expect(visibleSession(back).buyers.map((b) => b.num)).toEqual([1, 2]);
    expect(markCancelled(full, "zzz", true)).toBe(full);
    expect(markCancelled(full, "a", false)).toBe(full);
  });
  it("rows read before sql/234 (no columns) rebuild exactly as before — no ref / cancelled keys", () => {
    const full = rebuildSessionFromRows([row(1, 1, "ana", 100)]);
    expect("ref" in full.orders[0]).toBe(false);
    expect("cancelled" in full.orders[0]).toBe(false);
  });
});

describe("optional columns", () => {
  it("isMissingColumnError only for these columns", () => {
    expect(isMissingColumnError({ code: "42703", message: "column live_session_orders.cancelled_at does not exist" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204", message: "Could not find the 'order_ref' column" })).toBe(true);
    expect(isMissingColumnError({ code: "42703", message: "column foo does not exist" })).toBe(false);
    expect(isMissingColumnError({ code: "57014", message: "cancelled_at timeout" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
  it("withCancelCols: asks with the columns; a missing-column refusal → once more without, then never again", async () => {
    const seen: string[] = [];
    const run = async (cols: string) => { seen.push(cols); return cols.includes("cancelled_at") ? { error: { code: "42703", message: "column cancelled_at does not exist" } } : { error: null }; };
    const r = await withCancelCols("id,price", run);
    expect(r.error).toBeNull();
    expect(seen).toEqual(["id,price,order_ref,cancelled_at", "id,price"]);
    expect(cancelColsMissing()).toBe(true);
    await withCancelCols("id", run);
    expect(seen.slice(2)).toEqual(["id"]);
  });
  it("withCancelCols: any other error is returned as it is (no second read)", async () => {
    const seen: string[] = [];
    const r = await withCancelCols("id", async (c) => { seen.push(c); return { error: { message: "network" } }; });
    expect(r.error).toEqual({ message: "network" });
    expect(seen).toHaveLength(1);
  });
  it("keepNotCancelled", () => {
    expect(keepNotCancelled([{ id: 1 }, { id: 2, cancelled_at: "x" }, { id: 3, cancelled_at: null }]).map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("gate + tag", () => {
  it("orderCancelVisible: admin, the list, or the switch", () => {
    expect(orderCancelVisible({ isAdmin: false, previewKey: false, switchOn: false })).toBe(false);
    expect(orderCancelVisible({ isAdmin: true, previewKey: false, switchOn: false })).toBe(true);
    expect(orderCancelVisible({ isAdmin: false, previewKey: true, switchOn: false })).toBe(true);
    expect(orderCancelVisible({ isAdmin: false, previewKey: false, switchOn: true })).toBe(true);
  });
  it("newOrderRef = a uuid, never the same twice", () => {
    const a = newOrderRef(), b = newOrderRef();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });
});

describe("RPC wrappers", () => {
  it("cancel / undo / check send p_ref and map the answer", async () => {
    S.rpcAnswer = { result: "cancelled", ledger: 1, stock_back: 0 };
    expect(await cancelOrder("r1")).toBe("cancelled");
    S.rpcAnswer = { result: "restored", comment_back: true };
    expect(await undoCancelOrder("r1")).toBe("restored");
    S.rpcAnswer = { result: "ok", sent: true };
    expect(await checkOrderCancel("r1")).toEqual({ result: "ok", sent: true });
    expect(S.rpcCalls.map((c) => c.fn)).toEqual(["cancel_order", "uncancel_order", "order_cancel_check"]);
    expect(S.rpcCalls.every((c) => (c.args as { p_ref: string }).p_ref === "r1")).toBe(true);
  });
  it("an unknown answer / a database error → 'error'", async () => {
    S.rpcAnswer = { result: "weird" };
    expect(await cancelOrder("r1")).toBe("error");
    S.rpcAnswer = null; S.rpcError = { message: "function cancel_order does not exist" };
    expect(await cancelOrder("r1")).toBe("error");
    expect(await undoCancelOrder("r1")).toBe("error");
    expect(await checkOrderCancel("r1")).toEqual({ result: "error", sent: false });
  });
});

describe("db.ts insert fallback (before sql/234)", () => {
  it("no tag → exactly today's insert (no order_ref key)", async () => {
    await saveOrderToDatabase({ customer_name: "Ana", product: "x", total_amount: 10 } as never);
    expect(S.inserts).toHaveLength(1);
    expect("order_ref" in S.inserts[0].rows[0]).toBe(false);
  });
  it("tag + column there → ONE insert with the tag", async () => {
    await saveOrderToDatabase({ customer_name: "Ana", product: "x", total_amount: 10, order_ref: "r1" } as never);
    expect(S.inserts).toHaveLength(1);
    expect(S.inserts[0].rows[0].order_ref).toBe("r1");
  });
  it("tag + column missing → the same order saved again WITHOUT the tag (never lost)", async () => {
    S.refuseTag = true;
    const r1 = await saveOrderToDatabase({ customer_name: "Ana", product: "x", total_amount: 10, order_ref: "r1" } as never);
    expect(r1.success).toBe(true);
    expect(S.inserts.map((i) => "order_ref" in i.rows[0])).toEqual([true, false]);
    S.inserts = [];
    const r2 = await saveLiveSessionOrder({ buyer_number: 1, handle: "ana", customer_name: "Ana", platform: "TikTok", product: "x", price: 10, session_date: "2026-11-28", order_ref: "r1" });
    expect(r2.success).toBe(true);
    expect(S.inserts.map((i) => [i.table, "order_ref" in i.rows[0]])).toEqual([["live_session_orders", true], ["live_session_orders", false]]);
    const { order_ref: _x, ...rest } = S.inserts[0].rows[0];
    expect(S.inserts[1].rows[0]).toEqual(rest);
  });
});

describe("the other readers of the session rows", () => {
  it("Invoicing line ids + the Paid flag read without cancelled rows (never paired with a line on screen)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of ["src/redesign/adapters/invoicing.ts", "src/redesign/adapters/ordersPaid.ts"]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/withCancelCols\(/);
      expect(src, f).toMatch(/keepNotCancelled\(/);
    }
  });
});
