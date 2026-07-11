// B2 (status-truth) — the server-side reuse-vs-force decision for POST /connect.
// server.js has no vitest harness, so the pure core lives in
// server/connectionHealth.js (same convention as broadcastTranslate) and is
// pinned here: reuse ONLY a demonstrably-alive connection; an event-silent one
// on an explicit Connect tap is forced fresh (the seller's zombie escape).
import { describe, it, expect } from "vitest";
import { shouldForceFreshConnect, CONNECT_REUSE_FRESH_MS } from "../../../../server/connectionHealth.js";

const NOW = 1_760_000_000_000;

describe("shouldForceFreshConnect", () => {
  it("fresh events (< threshold) → reuse (no EulerStream burn on double-taps)", () => {
    expect(shouldForceFreshConnect(NOW - 1_000, NOW)).toBe(false);
    expect(shouldForceFreshConnect(NOW - (CONNECT_REUSE_FRESH_MS - 1), NOW)).toBe(false);
  });
  it("event-silent ≥ threshold → force a fresh connection (zombie escape)", () => {
    expect(shouldForceFreshConnect(NOW - CONNECT_REUSE_FRESH_MS, NOW)).toBe(true);
    expect(shouldForceFreshConnect(NOW - 10 * 60_000, NOW)).toBe(true); // classic 10-min zombie
  });
  it("missing/invalid lastEventAt → force (never trust an untracked connection)", () => {
    expect(shouldForceFreshConnect(undefined, NOW)).toBe(true);
    expect(shouldForceFreshConnect(null, NOW)).toBe(true);
    expect(shouldForceFreshConnect(0, NOW)).toBe(true);
    expect(shouldForceFreshConnect(NaN, NOW)).toBe(true);
  });
  it("threshold is 60s — tight enough for a zombie, loose enough for an active live", () => {
    expect(CONNECT_REUSE_FRESH_MS).toBe(60_000);
  });
});
