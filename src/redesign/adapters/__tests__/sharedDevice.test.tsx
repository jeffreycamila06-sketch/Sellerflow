// Audit Oct 13 item 5 — a shared device: one shop's queued orders / cached products
// must never land in another shop's account.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const S = vi.hoisted(() => ({
  user: "userA" as string | null,
  dbRows: [] as unknown[],
  upserts: [] as unknown[],
}));

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: S.user ? { user: { id: S.user } } : null } })) },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: S.dbRows, error: null }) }) }),
      upsert: async (rows: unknown) => { S.upserts.push(rows); return { error: null }; },
    })),
  },
}));

import { useOutbox, OUTBOX_KEY, itemWritableBy, type OutboxItem } from "../outbox";
import { resolveInitialProducts } from "../productsDb";
import { OWNER_KEY, saveProducts, clearProductsCacheFor, type Product } from "../products";

const order = { buyer_number: 1, handle: "ann", customer_name: "Ann", platform: "TikTok", product: "D", price: 52, session_date: "2026-10-13", comment_msg_id: "M1" };
const flush = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
const real: Product[] = [{ id: 1750000000001, name: "Red dress", sku: "RD-1", price: 350, stock: 24, platform: "TikTok", status: "Active" }];

beforeEach(() => { localStorage.clear(); S.user = "userA"; S.dbRows = []; S.upserts = []; });

describe("outbox — per-user items", () => {
  it("itemWritableBy: owned items only for their owner; legacy items for anyone", () => {
    const it0 = { id: "1", payload: order, msgId: "M1", retries: 0, firstAt: 0 } as OutboxItem;
    expect(itemWritableBy(it0, "userB")).toBe(true);
    expect(itemWritableBy({ ...it0, ownerId: "userA" }, "userB")).toBe(false);
    expect(itemWritableBy({ ...it0, ownerId: "userA" }, null)).toBe(false);
    expect(itemWritableBy({ ...it0, ownerId: "userA" }, "userA")).toBe(true);
  });

  it("A queues an item, logs out, B logs in → the item is NOT written for B", async () => {
    const failing = vi.fn(async () => ({ success: false, error: new TypeError("Failed to fetch") }));
    const a = renderHook(() => useOutbox({ write: failing, ownerId: "userA" }));
    await act(async () => { a.result.current.enqueue(order, "M1"); await flush(); });
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY)!)[0].ownerId).toBe("userA");
    act(() => { a.result.current.dropOwner("userA"); }); // A's logout
    a.unmount();
    const write = vi.fn(async () => ({ success: true }));
    const b = renderHook(() => useOutbox({ write, ownerId: "userB" }));
    await act(async () => { await flush(); });
    expect(write).not.toHaveBeenCalled();
    expect(b.result.current.pending()).toBe(0);
  });

  it("A's item still queued (no logout) when B signs in → kept, not written; A back → written", async () => {
    const failing = vi.fn(async () => ({ success: false, error: new TypeError("Failed to fetch") }));
    const a = renderHook(() => useOutbox({ write: failing, ownerId: "userA" }));
    await act(async () => { a.result.current.enqueue(order, "M1"); await flush(); });
    a.unmount();
    const write = vi.fn(async () => ({ success: true }));
    const b = renderHook(({ who }) => useOutbox({ write, ownerId: who }), { initialProps: { who: "userB" } });
    await act(async () => { await flush(); });
    expect(write).not.toHaveBeenCalled();
    expect(b.result.current.pending()).toBe(1);
    b.rerender({ who: "userA" });
    await act(async () => { await flush(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(b.result.current.pending()).toBe(0);
  });

  it("legacy items (no ownerId) are written for the current user once (today's behaviour)", async () => {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ id: "x", payload: order, msgId: "M1", retries: 0, firstAt: 0 }]));
    const write = vi.fn(async () => ({ success: true }));
    const h = renderHook(() => useOutbox({ write, ownerId: "userB" }));
    await act(async () => { await flush(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(h.result.current.pending()).toBe(0);
  });
});

describe("products cache — never migrated / shown across users", () => {
  it("B with an empty DB + A's cached products → NO migration, empty list", async () => {
    saveProducts(real); localStorage.setItem(OWNER_KEY, "userA");
    S.user = "userB";
    const r = await resolveInitialProducts(real);
    expect(S.upserts).toHaveLength(0);
    expect(r.products).toEqual([]);
    expect(localStorage.getItem(OWNER_KEY)).toBe("userB");
  });
  it("a cache with NO owner (legacy) + empty DB → no migration", async () => {
    saveProducts(real);
    const r = await resolveInitialProducts(real);
    expect(S.upserts).toHaveLength(0);
    expect(r.products).toEqual([]);
  });
  it("same user, empty DB, real local list → migrates once (unchanged)", async () => {
    saveProducts(real); localStorage.setItem(OWNER_KEY, "userA");
    const r = await resolveInitialProducts(real);
    expect(S.upserts).toHaveLength(1);
    expect(r.source).toBe("migrated");
  });
  it("logout clears the signing-out user's cache, never another user's", () => {
    saveProducts(real); localStorage.setItem(OWNER_KEY, "userA");
    clearProductsCacheFor("userB");
    expect(localStorage.getItem("sf_prods")).not.toBeNull();
    clearProductsCacheFor("userA");
    expect(localStorage.getItem("sf_prods")).toBeNull();
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });
});
