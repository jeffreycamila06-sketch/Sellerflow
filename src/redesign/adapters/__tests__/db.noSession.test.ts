// Audit Oct 13 item 4 — offline, getUser() (a network call) returned null → the write
// failed with "Not authenticated" → the outbox treated it as terminal and DELETED the
// order. db.ts now reads the user id from the LOCAL session; with no session at all it
// returns a NoSessionError that the outbox keeps while offline.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const S = vi.hoisted(() => ({
  session: { user: { id: "user-1" } } as null | { user: { id: string } },
  insertThrows: null as Error | null,
  getUser: vi.fn(async () => ({ data: { user: null } })), // offline: the network call says "nobody"
}));

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getUser: S.getUser, getSession: vi.fn(async () => ({ data: { session: S.session } })) },
    from: vi.fn(() => ({
      insert: (rows: unknown[]) => ({
        select: async () => { if (S.insertThrows) throw S.insertThrows; return { data: rows, error: null }; },
      }),
    })),
  },
}));

import { saveLiveSessionOrder, saveOrderToDatabase } from "../../../db";
import { classifyOutcome, useOutbox, OUTBOX_KEY } from "../outbox";
import { NO_SESSION_ERROR } from "../../../lib/noSession";

const order = { buyer_number: 1, handle: "ann", customer_name: "Ann", platform: "TikTok", product: "D", price: 52, session_date: "2026-10-13", comment_msg_id: "M1" };
const setOnline = (v: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => v });

async function runOneDrain(): Promise<number> {
  const { result } = renderHook(() => useOutbox({ write: saveLiveSessionOrder }));
  await act(async () => { result.current.enqueue(order, "M1"); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
  return result.current.pending();
}

beforeEach(() => { S.session = { user: { id: "user-1" } }; S.insertThrows = null; localStorage.removeItem(OUTBOX_KEY); setOnline(true); vi.useRealTimers(); });
afterEach(() => setOnline(true));

describe("db.ts uses the local session", () => {
  it("offline with a local session: the write goes ahead (getUser is never needed)", async () => {
    const r = await saveLiveSessionOrder(order);
    expect(r.success).toBe(true);
    expect(S.getUser).not.toHaveBeenCalled();
    const o = await saveOrderToDatabase({ customer_name: "Ann", product: "D", total_amount: 52 });
    expect(o.success).toBe(true);
  });
  it("no session → NoSessionError (not a bare Error)", async () => {
    S.session = null;
    const r = await saveLiveSessionOrder(order);
    expect(r.success).toBe(false);
    expect((r.error as Error).name).toBe(NO_SESSION_ERROR);
  });
});

describe("outbox keeps / drops", () => {
  it("session present + insert throws 'Failed to fetch' → retryable, item KEPT", async () => {
    S.insertThrows = new TypeError("Failed to fetch");
    let thrown: unknown;
    try { await saveLiveSessionOrder(order); } catch (e) { thrown = e; }
    expect(classifyOutcome(undefined, thrown)).toBe("retryable");
    expect(await runOneDrain()).toBe(1);
  });
  it("offline + no session → retryable, item KEPT", async () => {
    S.session = null; setOnline(false);
    const r = await saveLiveSessionOrder(order);
    expect(classifyOutcome(r, undefined)).toBe("retryable");
    expect(await runOneDrain()).toBe(1);
  });
  it("online + signed out → auth (expired login): item KEPT for the next sign-in, not retried by timer", async () => {
    S.session = null; setOnline(true);
    const r = await saveLiveSessionOrder(order);
    expect(classifyOutcome(r, undefined)).toBe("auth"); // Audit Oct 22 (1): was terminal (dropped)
    expect(await runOneDrain()).toBe(1);
  });
});
