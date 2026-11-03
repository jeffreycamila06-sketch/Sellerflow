// Nov 3, 2026 — ONE automatic retry when a connection-limit cooldown ends. Timer holder
// semantics: one pending retry at a time (a new schedule replaces the old), cancel drops it,
// the callback runs once and clears the pending account.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCooldownRetry } from "../cooldownRetry";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createCooldownRetry", () => {
  it("fires once after the delay and clears the pending account", () => {
    const r = createCooldownRetry();
    const fn = vi.fn();
    r.schedule("shop", 2000, fn);
    expect(r.pending()).toBe("shop");
    vi.advanceTimersByTime(1999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.pending()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(1);             // never again
  });
  it("cancel drops the pending retry", () => {
    const r = createCooldownRetry();
    const fn = vi.fn();
    r.schedule("shop", 1000, fn);
    r.cancel();
    expect(r.pending()).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
  it("a second schedule replaces the first (one pending retry at a time)", () => {
    const r = createCooldownRetry();
    const a = vi.fn(); const b = vi.fn();
    r.schedule("a", 1000, a);
    r.schedule("b", 500, b);
    expect(r.pending()).toBe("b");
    vi.advanceTimersByTime(1000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
  it("a negative delay runs on the next tick (never throws)", () => {
    const r = createCooldownRetry();
    const fn = vi.fn();
    r.schedule("x", -5, fn);
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
