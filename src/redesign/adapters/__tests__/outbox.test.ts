// FAMILY A (#1 durability) — outbox retry queue.
// The classification is the highest-risk logic: a wrong bucket = an infinite
// retry loop OR silent loss. Each bucket is pinned. Addition B (Jeff): retryable
// is an ALLOW-LIST; everything else is DEFAULT-TERMINAL.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  isDuplicateMsgId, isRetryableError, classifyOutcome, backoffMs,
  loadQueue, saveQueue, useOutbox, OUTBOX_KEY,
  type WriteResult,
} from "../outbox";

const payload = (over = {}) => ({
  buyer_number: 1, handle: "ann", customer_name: "Ann", platform: "TikTok",
  product: "mine", price: 0, session_date: "2026-07-15", comment_msg_id: "M1", ...over,
});

beforeEach(() => { localStorage.clear(); });

describe("isDuplicateMsgId — matches the EXACT constraint, not a bare 23505 (ruling #2)", () => {
  it("true only for 23505 ON ux_lso_user_msgid", () => {
    expect(isDuplicateMsgId({ code: "23505", message: 'duplicate key value violates unique constraint "ux_lso_user_msgid"' })).toBe(true);
    expect(isDuplicateMsgId({ code: "23505", details: "Key (user_id, comment_msg_id)=(...) already exists in ux_lso_user_msgid" })).toBe(true);
  });
  it("false for a 23505 on a DIFFERENT unique constraint (must NOT be swallowed)", () => {
    expect(isDuplicateMsgId({ code: "23505", message: 'violates unique constraint "some_other_uniq"' })).toBe(false);
  });
  it("false for non-23505 / empty", () => {
    expect(isDuplicateMsgId({ code: "23503", message: "ux_lso_user_msgid" })).toBe(false);
    expect(isDuplicateMsgId(undefined)).toBe(false);
    expect(isDuplicateMsgId(null)).toBe(false);
  });
});

describe("isRetryableError — ALLOW-LIST (network/timeout/5xx); default terminal", () => {
  it("retryable: fetch/network/timeout/abort/5xx", () => {
    expect(isRetryableError(new Error("TypeError: Failed to fetch"))).toBe(true);
    expect(isRetryableError({ message: "NetworkError when attempting to fetch resource" })).toBe(true);
    expect(isRetryableError({ message: "network request failed" })).toBe(true);
    expect(isRetryableError({ name: "AbortError", message: "aborted" })).toBe(true);
    expect(isRetryableError({ message: "the operation timed out" })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
  });
  it("TERMINAL (default): cap, auth, 4xx, unknown", () => {
    expect(isRetryableError(new Error("free_tier_cap_reached"))).toBe(false); // cap
    expect(isRetryableError(new Error("Not authenticated"))).toBe(false);     // auth
    expect(isRetryableError({ status: 400 })).toBe(false);                    // 4xx
    expect(isRetryableError({ status: 409 })).toBe(false);
    expect(isRetryableError({ message: "something weird happened" })).toBe(false); // unknown → terminal
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("classifyOutcome — throw vs returned {success:false} (Trap 1)", () => {
  const dupErr = { code: "23505", message: 'unique constraint "ux_lso_user_msgid"' };
  it("returned success / skipped / void → ok", () => {
    expect(classifyOutcome({ success: true, data: [{}] }, undefined)).toBe("ok");
    expect(classifyOutcome({ success: true, skipped: true } as WriteResult, undefined)).toBe("ok");
    expect(classifyOutcome(undefined, undefined)).toBe("ok");
  });
  it("returned {success:false} with the dup error → duplicate (idempotent success)", () => {
    expect(classifyOutcome({ success: false, error: dupErr }, undefined)).toBe("duplicate");
  });
  it("returned {success:false} network → retryable; cap/auth/unknown → terminal", () => {
    expect(classifyOutcome({ success: false, error: { message: "Failed to fetch" } }, undefined)).toBe("retryable");
    expect(classifyOutcome({ success: false, error: new Error("free_tier_cap_reached") }, undefined)).toBe("terminal");
    expect(classifyOutcome({ success: false, error: new Error("Not authenticated") }, undefined)).toBe("terminal");
  });
  it("THROWN network → retryable; thrown dup → duplicate; thrown unknown → terminal", () => {
    expect(classifyOutcome(undefined, new Error("Failed to fetch"))).toBe("retryable");
    expect(classifyOutcome(undefined, dupErr)).toBe("duplicate");
    expect(classifyOutcome(undefined, new Error("boom"))).toBe("terminal");
  });
});

describe("backoffMs — bounded exponential + jitter", () => {
  it("grows with retries and is capped", () => {
    for (let r = 0; r < 12; r++) {
      const ms = backoffMs(r);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(30_000);
    }
  });
});

describe("loadQueue / saveQueue — resilient persistence", () => {
  it("round-trips and drops malformed items", () => {
    saveQueue([{ id: "a", payload: payload(), msgId: "M1", retries: 0, firstAt: 1 }]);
    expect(loadQueue()).toHaveLength(1);
    localStorage.setItem(OUTBOX_KEY, "{not json");
    expect(loadQueue()).toEqual([]);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ id: "x" }, null, { id: "y", payload: payload(), msgId: "M2" }]));
    expect(loadQueue()).toHaveLength(1); // only the well-formed one
  });
});

describe("useOutbox hook — drain / dequeue / retry / terminal", () => {
  afterEach(() => vi.useRealTimers());

  it("enqueue → write succeeds → item dequeued (queue empties)", async () => {
    const write = vi.fn(async () => ({ success: true, data: [{}] }));
    const { result } = renderHook(() => useOutbox({ write }));
    act(() => result.current.enqueue(payload(), "M1"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending()).toBe(0));
  });

  it("duplicate (lost-ACK replay) → dequeued as success, onExhausted NOT called", async () => {
    const write = vi.fn(async () => ({ success: false, error: { code: "23505", message: 'unique constraint "ux_lso_user_msgid"' } }));
    const onExhausted = vi.fn();
    const { result } = renderHook(() => useOutbox({ write, onExhausted }));
    act(() => result.current.enqueue(payload(), "M1"));
    await waitFor(() => expect(write).toHaveBeenCalled());
    await waitFor(() => expect(result.current.pending()).toBe(0));
    expect(onExhausted).not.toHaveBeenCalled(); // a duplicate is SUCCESS, not a failure
  });

  it("terminal error → dequeued + onExhausted('terminal'), never loops", async () => {
    const write = vi.fn(async () => ({ success: false, error: new Error("Not authenticated") }));
    const onExhausted = vi.fn();
    const { result } = renderHook(() => useOutbox({ write, onExhausted }));
    act(() => result.current.enqueue(payload(), "M1"));
    await waitFor(() => expect(onExhausted).toHaveBeenCalledWith("terminal"));
    await waitFor(() => expect(result.current.pending()).toBe(0));
    expect(write).toHaveBeenCalledTimes(1); // terminal = no retry loop
  });

  it("empty msgId is never enqueued (FB writes must not be retried)", async () => {
    const write = vi.fn(async () => ({ success: true }));
    const { result } = renderHook(() => useOutbox({ write }));
    act(() => result.current.enqueue(payload(), ""));
    expect(result.current.pending()).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("retryable error keeps the item queued for a later attempt", async () => {
    const write = vi.fn(async () => ({ success: false, error: { message: "Failed to fetch" } }));
    const onExhausted = vi.fn();
    const { result } = renderHook(() => useOutbox({ write, onExhausted }));
    act(() => result.current.enqueue(payload(), "M1"));
    await waitFor(() => expect(write).toHaveBeenCalled());
    // still pending (a transient failure is retried, not dropped), and NOT surfaced as exhausted yet
    expect(result.current.pending()).toBe(1);
    expect(onExhausted).not.toHaveBeenCalledWith("terminal");
  });
});
