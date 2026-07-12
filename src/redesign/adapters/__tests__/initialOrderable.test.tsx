// ORDERABLE EARLIER COMMENTS (sql/18) — the DB-backed ordered-check core.
// Pins the final spec's safety machinery:
//   • buildOrderedMsgIds: Set from raw window rows; E3 hygiene — empty/null
//     msgIds NEVER enter (an order without a msgId must never match a comment
//     without one);
//   • the E1 gate (orderedLoaded): false until the window load RESOLVES; a
//     failed load keeps it CLOSED (restored rows stay display-only — safe);
//   • the Set is built from the LOAD RESULT even when hydrate-on-empty skips
//     state hydration (audit note c);
//   • addOrderedMsgId: in-session additions after createOrder; empty ignored;
//   • liveSessionPayload: the order write carries the source comment's msgId
//     (empty → undefined → NULL in the row);
//   • THE CORE SCENARIO: order a live comment (msgId stored) → reload window →
//     the restored copy of that message matches → "ordered".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Comment as ProdComment, LiveOrder } from "../../../lib/orderTypes";

const M = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  fail: false,
}));
vi.mock("../useSessionWindow", async (orig) => ({
  ...(await orig() as object),
  loadLiveSessionDay: vi.fn(async () => (M.fail ? null : M.rows)),
  loadLiveSessionWindow: vi.fn(async () => (M.fail ? null : M.rows)),
}));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: {} }));

import { useLiveSession, buildOrderedMsgIds } from "../useLiveSession";
import { liveSessionPayload } from "../useOrders";

const row = (n: number, msgId: string | null = `m-${n}`) => ({
  buyer_number: n, handle: `buyer${n}`, customer_name: `Buyer ${n}`, platform: "TikTok",
  product: `mine ${n}`, price: 100, created_at: new Date(1760000000000 + n * 1000).toISOString(),
  session_date: "2026-07-12", comment_msg_id: msgId,
});

beforeEach(() => { M.rows = []; M.fail = false; vi.clearAllMocks(); });

describe("buildOrderedMsgIds (pure)", () => {
  it("collects msgIds from window rows; E3 — empty/null/whitespace NEVER enter", () => {
    const set = buildOrderedMsgIds([row(1), row(2, null), row(3, ""), row(4, "  "), row(5)]);
    expect(set.has("m-1")).toBe(true);
    expect(set.has("m-5")).toBe(true);
    expect(set.size).toBe(2);            // null/""/whitespace all excluded
    expect(set.has("")).toBe(false);
  });
  it("garbage rows never throw", () => {
    expect(buildOrderedMsgIds([null as unknown as object, {}, "junk" as unknown as object]).size).toBe(0);
  });
});

describe("useLiveSession — ordered-check machinery", () => {
  it("E1 gate: orderedLoaded=false until the load RESOLVES; Set built from loaded rows", async () => {
    M.rows = [row(1), row(2, null)];
    const { result } = renderHook(() => useLiveSession(true));
    expect(result.current.orderedLoaded).toBe(false);          // gate closed pre-resolve
    await waitFor(() => expect(result.current.orderedLoaded).toBe(true));
    expect(result.current.orderedMsgIds.has("m-1")).toBe(true);
    expect(result.current.orderedMsgIds.size).toBe(1);         // the null row contributed nothing
  });

  it("FAILED load keeps the gate CLOSED (restored rows stay display-only — the safe direction)", async () => {
    M.fail = true;
    const { result } = renderHook(() => useLiveSession(true));
    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.orderedLoaded).toBe(false);
  });

  it("Set is built even when hydrate-on-empty skips hydration (audit note c): rows loaded but session stays as-is", async () => {
    // rows with orders → rebuilt.orders non-empty → hydrates; the note-c case is
    // rows PRESENT while the local session is EMPTY (always hydrates) or rows
    // EMPTY (nothing to hydrate) — in both, the Set/gate must still resolve:
    M.rows = [];
    const { result } = renderHook(() => useLiveSession(true));
    await waitFor(() => expect(result.current.orderedLoaded).toBe(true));
    expect(result.current.orderedMsgIds.size).toBe(0);
    expect(result.current.state).toBe("empty");
  });

  it("addOrderedMsgId: in-session additions; empty/whitespace ignored (E3)", async () => {
    const { result } = renderHook(() => useLiveSession(true));
    await waitFor(() => expect(result.current.orderedLoaded).toBe(true));
    act(() => { result.current.addOrderedMsgId("m-live-1"); });
    act(() => { result.current.addOrderedMsgId(""); });
    act(() => { result.current.addOrderedMsgId("   "); });
    act(() => { result.current.addOrderedMsgId(undefined); });
    expect(result.current.orderedMsgIds.has("m-live-1")).toBe(true);
    expect(result.current.orderedMsgIds.size).toBe(1);
  });

  it("THE CORE SCENARIO: order stored with msgId pre-refresh → window reload → the restored copy MATCHES", async () => {
    // pre-refresh: the seller ordered msg m-77 (row persisted by another mount)
    M.rows = [row(77)];
    const { result } = renderHook(() => useLiveSession(true));    // "the refresh"
    await waitFor(() => expect(result.current.orderedLoaded).toBe(true));
    // the restored copy of the same message carries the SAME msgId:
    const restoredMsgId = "m-77";
    expect(result.current.orderedMsgIds.has(restoredMsgId)).toBe(true);  // → "Ordered ✓", no buttons
    // …while a different (unordered) history message stays orderable:
    expect(result.current.orderedMsgIds.has("m-88")).toBe(false);
  });
});

describe("liveSessionPayload — the write side carries msgId", () => {
  const order: LiveOrder = { bNum: 1, item: "mine", price: 100 } as LiveOrder;
  const cmt = (msgId?: string): ProdComment =>
    ({ handle: "b1", name: "B1", comment: "mine", platform: "TikTok", isBuy: true, buyerNum: null, buyerData: null, time: "", msgId } as ProdComment & { msgId?: string });

  it("passes the source comment's msgId through to the row", () => {
    expect(liveSessionPayload(cmt("m-9"), order, "2026-07-12").comment_msg_id).toBe("m-9");
  });
  it("E3: empty/missing msgId → undefined (NULL in the row, never a matchable '')", () => {
    expect(liveSessionPayload(cmt(""), order, "2026-07-12").comment_msg_id).toBeUndefined();
    expect(liveSessionPayload(cmt(undefined), order, "2026-07-12").comment_msg_id).toBeUndefined();
    expect(liveSessionPayload(cmt("  "), order, "2026-07-12").comment_msg_id).toBeUndefined();
  });
});
