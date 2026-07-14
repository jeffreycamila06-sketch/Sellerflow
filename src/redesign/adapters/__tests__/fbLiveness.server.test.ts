// #2 FB LIVENESS (STOPGAP) — server.js has no vitest harness; the pure core lives
// in server/fbLiveness.js. Pins: 6h time-boxed "connected"; honest gray past TTL;
// a missing/malformed startedAt (pre-stopgap or corrupt entry) → not-live (pruned).
import { describe, it, expect } from "vitest";
import { fbConnectedNow, FB_CONNECTED_TTL_MS } from "../../../../server/fbLiveness.js";

const NOW = 1_760_000_000_000;

describe("fbConnectedNow — time-boxed FB status", () => {
  it("TTL is 6 hours", () => {
    expect(FB_CONNECTED_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });
  it("within the window → live (green)", () => {
    expect(fbConnectedNow(NOW, NOW)).toBe(true);                       // just connected
    expect(fbConnectedNow(NOW - 60 * 1000, NOW)).toBe(true);           // 1 min ago
    expect(fbConnectedNow(NOW - (FB_CONNECTED_TTL_MS - 1000), NOW)).toBe(true); // just under 6h
  });
  it("past the window → NOT live (honest gray → pruned)", () => {
    expect(fbConnectedNow(NOW - FB_CONNECTED_TTL_MS, NOW)).toBe(false);       // exactly 6h
    expect(fbConnectedNow(NOW - (FB_CONNECTED_TTL_MS + 1000), NOW)).toBe(false); // over 6h
  });
  it("missing / malformed startedAt → NOT live (pre-stopgap or corrupt entry is pruned)", () => {
    expect(fbConnectedNow(undefined, NOW)).toBe(false);
    expect(fbConnectedNow(null, NOW)).toBe(false);
    expect(fbConnectedNow("garbage" as unknown as number, NOW)).toBe(false);
    expect(fbConnectedNow(NaN, NOW)).toBe(false);
  });
  it("a re-tap (fresh startedAt) refreshes the window", () => {
    expect(fbConnectedNow(NOW - (FB_CONNECTED_TTL_MS + 1000), NOW)).toBe(false); // stale
    expect(fbConnectedNow(NOW, NOW)).toBe(true);                                 // re-tapped now → green
  });
});
