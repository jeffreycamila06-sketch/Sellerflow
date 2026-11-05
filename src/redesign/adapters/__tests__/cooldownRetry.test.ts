// Nov 3, 2026 — ONE automatic retry when a connection-limit cooldown ends. Timer holder
// semantics: one pending retry at a time (a new schedule replaces the old), cancel drops it,
// the callback runs once and clears the pending account.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCooldownRetry, retryAllowed } from "../cooldownRetry";

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

describe("A3. generation counter — a manual tap during the retry's session check wins (no double connect)", () => {
  it("schedule() and cancel() bump the generation; the callback's gen is current only until the next schedule / cancel", async () => {
    const r = createCooldownRetry();
    const connect = vi.fn();
    let release!: () => void;
    const checkStatus = () => new Promise<void>((res) => { release = res; });
    r.schedule("shop", 1000, (gen) => { void (async () => { await checkStatus(); if (!r.isCurrent(gen)) return; connect(); })(); });
    vi.advanceTimersByTime(1000);                    // the retry fired; its session check is in flight
    r.cancel();                                      // the seller taps Connect by hand right now (performConnect cancels)
    release(); await Promise.resolve(); await Promise.resolve();
    expect(connect).not.toHaveBeenCalled();          // the stale retry does NOT connect
  });
  it("without an interruption the retry connects; a later schedule makes an older gen stale", async () => {
    const r = createCooldownRetry();
    const seen: number[] = [];
    r.schedule("a", 10, (gen) => seen.push(gen));
    vi.advanceTimersByTime(10);
    expect(r.isCurrent(seen[0])).toBe(true);
    r.schedule("b", 10, () => {});
    expect(r.isCurrent(seen[0])).toBe(false);
    const g2: number[] = [];
    r.schedule("c", 10, (gen) => g2.push(gen));
    vi.advanceTimersByTime(10);
    expect(r.isCurrent(g2[0])).toBe(true);
    r.cancel();
    expect(r.isCurrent(g2[0])).toBe(false);
  });
});

describe("retryAllowed — the re-check before the timer fires (audit item 2)", () => {
  const running = { running: true, platform: "TikTok" as string | null };
  it("fires only when TikTok is off, no other platform is live, and the session is running + TikTok's", () => {
    expect(retryAllowed({ ttLive: false, otherLive: false, session: running })).toBe(true);
    expect(retryAllowed({ ttLive: false, otherLive: false, session: { running: true, platform: null } })).toBe(true); // pre-sql/46 session
  });
  it("blocked: TikTok already live, another platform live, session ended, or a non-TikTok session", () => {
    expect(retryAllowed({ ttLive: true, otherLive: false, session: running })).toBe(false);
    expect(retryAllowed({ ttLive: false, otherLive: true, session: running })).toBe(false);
    expect(retryAllowed({ ttLive: false, otherLive: false, session: { running: false, platform: "TikTok" } })).toBe(false);
    expect(retryAllowed({ ttLive: false, otherLive: false, session: { running: true, platform: "Shopee" } })).toBe(false);
    expect(retryAllowed({ ttLive: false, otherLive: false, session: { running: true, platform: "Facebook" } })).toBe(false);
  });
});
