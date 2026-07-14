// #5a — per-seller /connect rate limit (server.js has no vitest harness; the pure
// core lives in server/connectionHealth.js). Pins: prune to the rolling window,
// allow under the cap (appending now), throttle at/over the cap (kept unchanged),
// non-array input treated as empty.
import { describe, it, expect } from "vitest";
import {
  checkConnectRate, CONNECT_RATE_MAX, CONNECT_RATE_WINDOW_MS,
} from "../../../../server/connectionHealth.js";

const NOW = 1_760_000_000_000;

describe("checkConnectRate", () => {
  it("cap = 20 per 60s window", () => {
    expect(CONNECT_RATE_MAX).toBe(20);
    expect(CONNECT_RATE_WINDOW_MS).toBe(60 * 1000);
  });
  it("first attempt (empty/undefined) → allowed, records now", () => {
    const r = checkConnectRate(undefined, NOW);
    expect(r.allowed).toBe(true);
    expect(r.kept).toEqual([NOW]);
  });
  it("under the cap → allowed and appends now", () => {
    const ts = Array.from({ length: 5 }, (_, i) => NOW - i * 1000);
    const r = checkConnectRate(ts, NOW);
    expect(r.allowed).toBe(true);
    expect(r.kept).toHaveLength(6);
    expect(r.kept[r.kept.length - 1]).toBe(NOW);
  });
  it("prunes timestamps outside the window before counting", () => {
    const ts = [NOW - 2 * CONNECT_RATE_WINDOW_MS, NOW - 90_000, NOW - 1000]; // first two are stale
    const r = checkConnectRate(ts, NOW);
    expect(r.allowed).toBe(true);
    expect(r.kept).toEqual([NOW - 1000, NOW]); // stale dropped, now appended
  });
  it("at/over the cap within the window → throttled, kept NOT extended", () => {
    const ts = Array.from({ length: CONNECT_RATE_MAX }, (_, i) => NOW - i * 100); // 20 recent
    const r = checkConnectRate(ts, NOW);
    expect(r.allowed).toBe(false);
    expect(r.kept).toHaveLength(CONNECT_RATE_MAX); // unchanged (no new timestamp added)
  });
  it("a full window of STALE attempts → allowed again (window rolled over)", () => {
    const ts = Array.from({ length: CONNECT_RATE_MAX }, () => NOW - 2 * CONNECT_RATE_WINDOW_MS);
    const r = checkConnectRate(ts, NOW);
    expect(r.allowed).toBe(true);
    expect(r.kept).toEqual([NOW]); // all stale pruned, now recorded
  });
  it("non-array input treated as empty (defensive)", () => {
    expect(checkConnectRate(null, NOW).allowed).toBe(true);
    expect(checkConnectRate("garbage" as unknown as number[], NOW).kept).toEqual([NOW]);
  });
});
