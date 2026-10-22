// Audit Oct 22 (1) — offline order queue. A network outage keeps retrying (24 h, backoff), an
// expired login HOLDS the item until the next sign-in, the browser's `online` event and a
// platform reconnect retry at once, and a board (re)load counts the still-queued orders.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOutbox, OUTBOX_KEY, MAX_AGE_MS, queuedOutboxRows, saveQueue, isAuthExpiredError, type WriteResult } from "../outbox";
import { withQueuedRows } from "../useLiveSession";
import { nextBuyerNumber, rebuildSessionFromRows } from "../../../lib/orderLogic";

const payload = (n: number, over = {}) => ({
  buyer_number: n, handle: `h${n}`, customer_name: `N${n}`, platform: "TikTok", product: "mine", price: 100,
  session_date: "2026-10-22", comment_msg_id: `M${n}`, session_id: "sid-A", ...over,
});
const netFail = (): WriteResult => ({ success: false, error: new TypeError("Failed to fetch") });
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe("network outage", () => {
  it("3 minutes offline: the order keeps retrying with backoff and is NOT dropped (old cap was 8 tries)", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => netFail());
    const onExhausted = vi.fn();
    const { result } = renderHook(() => useOutbox({ write, onExhausted, ownerId: "u1" }));
    act(() => result.current.enqueue(payload(1), "M1"));
    await tick(3 * 60_000);
    expect(write.mock.calls.length).toBeGreaterThan(8);
    expect(result.current.pending()).toBe(1);
    expect(onExhausted).not.toHaveBeenCalled();
    // back online: the next attempt lands and the queue empties
    write.mockImplementation(async () => ({ success: true, data: [{}] }));
    await tick(60_000);
    expect(result.current.pending()).toBe(0);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]")).toEqual([]);
  });

  it("the browser's `online` event retries immediately (no backoff wait)", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => netFail());
    const { result } = renderHook(() => useOutbox({ write, ownerId: "u1" }));
    act(() => result.current.enqueue(payload(1), "M1"));
    await tick(0);
    const before = write.mock.calls.length;
    write.mockImplementation(async () => ({ success: true }));
    await act(async () => { window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(0); });
    expect(write.mock.calls.length).toBe(before + 1);
    expect(result.current.pending()).toBe(0);
  });

  it("a platform reconnect (drainSignal change) retries immediately", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => netFail());
    const { result, rerender } = renderHook(({ sig }) => useOutbox({ write, ownerId: "u1", drainSignal: sig }), { initialProps: { sig: "false,false,false,false" } });
    act(() => result.current.enqueue(payload(1), "M1"));
    await tick(0);
    const before = write.mock.calls.length;
    write.mockImplementation(async () => ({ success: true }));
    rerender({ sig: "false,false,true,false" }); // Shopee came up
    await tick(0);
    expect(write.mock.calls.length).toBe(before + 1);
    expect(result.current.pending()).toBe(0);
  });

  it("after 24 h of failures the item is dropped and surfaced as exhausted", async () => {
    vi.useFakeTimers();
    saveQueue([{ id: "old", payload: payload(1), msgId: "M1", retries: 3, firstAt: Date.now() - MAX_AGE_MS - 1, ownerId: "u1" }]);
    const write = vi.fn(async () => netFail());
    const onExhausted = vi.fn();
    const { result } = renderHook(() => useOutbox({ write, onExhausted, ownerId: "u1" }));
    await tick(0);
    expect(onExhausted).toHaveBeenCalledWith("exhausted");
    expect(result.current.pending()).toBe(0);
  });
});

describe("expired login (401)", () => {
  it("isAuthExpiredError: 401 / PGRST301 / JWT expired; a plain network error is not", () => {
    expect(isAuthExpiredError({ status: 401 })).toBe(true);
    expect(isAuthExpiredError({ code: "PGRST301", message: "JWT expired" })).toBe(true);
    expect(isAuthExpiredError(new Error("invalid JWT"))).toBe(true);
    expect(isAuthExpiredError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAuthExpiredError(undefined)).toBe(false);
  });
  it("is NOT terminal: the item waits (no retry timer) and is written when the seller signs in again", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (): Promise<WriteResult> => ({ success: false, error: { status: 401, message: "Unauthorized" } }));
    const onExhausted = vi.fn();
    const { result, rerender } = renderHook(({ who }) => useOutbox({ write, onExhausted, ownerId: who }), { initialProps: { who: "u1" as string | null } });
    act(() => result.current.enqueue(payload(1), "M1"));
    await tick(5 * 60_000);
    expect(write).toHaveBeenCalledTimes(1); // held, not hammered
    expect(result.current.pending()).toBe(1);
    expect(onExhausted).not.toHaveBeenCalled();
    rerender({ who: null }); // signed out
    await tick(60_000);
    expect(write).toHaveBeenCalledTimes(1);
    write.mockImplementation(async () => ({ success: true }));
    rerender({ who: "u1" }); // signed in again
    await tick(0);
    expect(result.current.pending()).toBe(0);
  });
});

describe("reload while queued — the board counts the still-queued orders", () => {
  it("queuedOutboxRows: the owner's items as session rows (created_at = when queued), others' excluded", () => {
    saveQueue([
      { id: "a", payload: payload(2), msgId: "M2", retries: 1, firstAt: 1_700_000_000_000, ownerId: "u1" },
      { id: "b", payload: payload(9), msgId: "M9", retries: 0, firstAt: 1, ownerId: "u2" },
    ]);
    const rows = queuedOutboxRows("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ buyer_number: 2, comment_msg_id: "M2", created_at: new Date(1_700_000_000_000).toISOString(), queued: true });
    expect(queuedOutboxRows(null)).toEqual([]);
  });
  it("withQueuedRows: appends in-scope rows missing from the database; a row already saved wins; other sessions ignored", () => {
    const db = [{ ...payload(1), created_at: "2026-10-22T01:00:00Z" }];
    const queued = [
      { ...payload(2), created_at: "2026-10-22T01:05:00Z", queued: true as const },           // missing → added
      { ...payload(1), created_at: "2026-10-22T01:00:00Z", queued: true as const },           // M1 already saved → not duplicated
      { ...payload(3, { session_id: "sid-B" }), created_at: "2026-10-22T01:06:00Z", queued: true as const }, // another session
    ];
    const merged = withQueuedRows(db, queued, { sessionId: "sid-A", start: "2026-10-22", end: "2026-10-22" }) as Array<{ comment_msg_id: string }>;
    expect(merged.map((r) => r.comment_msg_id)).toEqual(["M1", "M2"]);
    // legacy (no session id): scoped by session_date
    const legacy = withQueuedRows([], [{ ...payload(5, { session_id: undefined, session_date: "2026-10-21" }), created_at: "x", queued: true as const }], { sessionId: null, start: "2026-10-22", end: "2026-10-22" });
    expect(legacy).toEqual([]);
  });
  it("the next buyer number counts a queued buyer (no duplicate #2 after a reload)", () => {
    const rows = withQueuedRows([{ ...payload(1), created_at: "2026-10-22T01:00:00Z" }], [{ ...payload(2), created_at: "2026-10-22T01:05:00Z", queued: true as const }], { sessionId: "sid-A", start: "", end: "" });
    const s = rebuildSessionFromRows(rows as Parameters<typeof rebuildSessionFromRows>[0]);
    expect(s.buyers.map((b) => b.num)).toEqual([1, 2]);
    expect(nextBuyerNumber(s.buyers)).toBe(3);
  });
});

describe("flush / pendingMine (the logout check)", () => {
  it("pendingMine counts only the current owner's items; flush awaits one drain", async () => {
    saveQueue([{ id: "b", payload: payload(9), msgId: "M9", retries: 0, firstAt: Date.now(), ownerId: "u2" }]);
    const write = vi.fn(async () => netFail());
    const { result } = renderHook(() => useOutbox({ write, ownerId: "u1" }));
    await waitFor(() => expect(result.current.pending()).toBe(1));
    expect(result.current.pendingMine()).toBe(0);
    act(() => result.current.enqueue(payload(1), "M1"));
    await waitFor(() => expect(result.current.pendingMine()).toBe(1));
    write.mockImplementation(async () => ({ success: true }));
    await act(async () => { await result.current.flush(); });
    expect(result.current.pendingMine()).toBe(0);
    expect(result.current.pending()).toBe(1); // u2's item untouched
  });
});
