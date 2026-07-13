// B2 (status-truth) — the server-side reuse-vs-force decision for POST /connect.
// server.js has no vitest harness, so the pure core lives in
// server/connectionHealth.js (same convention as broadcastTranslate) and is
// pinned here: reuse ONLY a demonstrably-alive connection; an event-silent one
// on an explicit Connect tap is forced fresh (the seller's zombie escape).
import { describe, it, expect } from "vitest";
import { shouldForceFreshConnect, CONNECT_REUSE_FRESH_MS, LIVENESS_EVENTS } from "../../../../server/connectionHealth.js";

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

// F1 (audit) — lastEventAt must be a TRUE liveness signal: the original six
// events plus roomUser (the high-frequency viewer-count signal present in any
// live room) and follow/share. Without roomUser a quiet-but-alive room read as
// "dead" → unnecessary force-reconnects (health timer + B2 taps).
describe("LIVENESS_EVENTS (F1)", () => {
  it("keeps the original six (regression guard)", () => {
    for (const e of ["member", "like", "gift", "social", "emote", "envelope"]) {
      expect(LIVENESS_EVENTS).toContain(e);
    }
  });
  it("adds roomUser + follow + share (verified in tiktok-live-connector 2.1.1-beta1)", () => {
    expect(LIVENESS_EVENTS).toContain("roomUser");
    expect(LIVENESS_EVENTS).toContain("follow");
    expect(LIVENESS_EVENTS).toContain("share");
  });
  it("no duplicates, and chat stays SEPARATE (it stamps lastCommentAt too)", () => {
    expect(new Set(LIVENESS_EVENTS).size).toBe(LIVENESS_EVENTS.length);
    expect(LIVENESS_EVENTS).not.toContain("chat");
  });
});

// clientfix RC3 — a queued reconnect closure (past clearTikTokReconnect's reach)
// must be a NO-OP when the account already has a live connection or a connect
// is in flight: running it either clobbers a healthy green with a terminal
// not_live + live_session_ended (the observed false-gray after exit/refresh →
// connect) or overwrites the healthy connection (orphaned double-relay, G1).
import { shouldSkipQueuedReconnect } from "../../../../server/connectionHealth.js";

describe("shouldSkipQueuedReconnect (clientfix RC3 — stale-reconnect guard)", () => {
  it("skips when a connection already exists (the seller's tap restored it)", () => {
    expect(shouldSkipQueuedReconnect(true, false)).toBe(true);
  });
  it("skips when a connect is in flight (lock held — user tap or another reconnect)", () => {
    expect(shouldSkipQueuedReconnect(false, true)).toBe(true);
  });
  it("runs only on a genuinely dead, idle key", () => {
    expect(shouldSkipQueuedReconnect(false, false)).toBe(false);
    expect(shouldSkipQueuedReconnect(true, true)).toBe(true);
  });
});

// ── B4 PHASE 1 (log-only) — reuse is-LIVE verification decision core ────────
// reuseVerdict is CONSERVATIVE by design (never risk false-blocking a live
// seller): only TikTok's own `false` (room ended) maps to not_live; every
// error/timeout/odd shape is "ambiguous" → Phase 2 will FAIL-OPEN on it.
// singleFlight (R1): concurrent Connect taps on the same account ride ONE
// pending verification — no duplicate fetches on tap spam / two devices.
import { reuseVerdict, singleFlight, REUSE_VERIFY_TIMEOUT_MS } from "../../../../server/connectionHealth.js";

describe("reuseVerdict (B4 Phase 1 — pure matrix)", () => {
  it("fetchIsLive true → live", () => {
    expect(reuseVerdict({ value: true })).toBe("live");
  });
  it("fetchIsLive false → not_live (TikTok's own ended-signal — the only blocker)", () => {
    expect(reuseVerdict({ value: false })).toBe("not_live");
  });
  it("throw → ambiguous (Phase 2 fail-open)", () => {
    expect(reuseVerdict({ error: new Error("all sources failed") })).toBe("ambiguous");
  });
  it("timeout → ambiguous (the wrapper surfaces timeouts as errors)", () => {
    expect(reuseVerdict({ error: new Error("reuse-verify timeout") })).toBe("ambiguous");
  });
  it("non-boolean / malformed / missing outcome → ambiguous (never guess)", () => {
    expect(reuseVerdict({ value: 1 as unknown as boolean })).toBe("ambiguous");
    expect(reuseVerdict({ value: undefined })).toBe("ambiguous");
    expect(reuseVerdict(undefined as unknown as { value?: boolean })).toBe("ambiguous");
    expect(reuseVerdict({} as { value?: boolean })).toBe("ambiguous");
  });
  it("timeout constant sane (bounded wait, well under the health-cycle scale)", () => {
    expect(REUSE_VERIFY_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(REUSE_VERIFY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("singleFlight (B4 R1 — one verification per key at a time)", () => {
  it("concurrent calls on the SAME key share one flight (factory runs once); a new call after settle re-runs", async () => {
    const map = new Map<string, Promise<unknown>>();
    let resolveFlight!: (v: string) => void;
    const factory = vi.fn(() => new Promise<string>((res) => { resolveFlight = res; }));
    const p1 = singleFlight(map, "seller:TikTok:acct", factory);
    const p2 = singleFlight(map, "seller:TikTok:acct", factory); // tap spam / 2nd device
    expect(factory).toHaveBeenCalledTimes(1);                    // ONE fetch
    expect(p2).toBe(p1);                                         // riders share the promise
    resolveFlight("live");
    await expect(p1).resolves.toBe("live");
    expect(map.size).toBe(0);                                    // cleaned on settle
    const p3 = singleFlight(map, "seller:TikTok:acct", factory); // next tap re-verifies
    expect(factory).toHaveBeenCalledTimes(2);
    resolveFlight("live");
    await p3;
  });

  it("different keys fly independently", () => {
    const map = new Map<string, Promise<unknown>>();
    const factory = vi.fn(() => new Promise(() => {}));
    void singleFlight(map, "k1", factory);
    void singleFlight(map, "k2", factory);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(map.size).toBe(2);
  });

  it("a REJECTED flight is also cleaned up (the next tap can retry)", async () => {
    const map = new Map<string, Promise<unknown>>();
    const factory = vi.fn(() => Promise.reject(new Error("boom")));
    await expect(singleFlight(map, "k", factory)).rejects.toThrow("boom");
    expect(map.size).toBe(0);
  });
});

// ── Viewer-count relay throttle (platform_viewers) ────────────────────────────
import { shouldRelayViewers, VIEWER_RELAY_MIN_MS, VIEWER_REFRESH_MS } from "../../../../server/connectionHealth.js";

// The relay must stay cheap AND self-healing: change-gated with a MIN floor,
// plus a 30s unchanged heartbeat (the client nulls its count at connect
// initiation, so a quiet room needs the heartbeat for the chip to reappear).
// Throttle state lives ON the tiktokConnections entry (dies with the
// connection) — pinned here via the prev=undefined first-relay case.
describe("shouldRelayViewers", () => {
  const NOW2 = 1_760_000_000_000;

  it("a fresh connection's FIRST count always relays (prev undefined ≠ count — entry-scoped state)", () => {
    expect(shouldRelayViewers(undefined, 0, 152, NOW2)).toBe(true);
    expect(shouldRelayViewers(undefined, 0, 0, NOW2)).toBe(true); // real 0 is data
  });

  it("unchanged count within the heartbeat window → silent", () => {
    expect(shouldRelayViewers(152, NOW2 - VIEWER_RELAY_MIN_MS, 152, NOW2)).toBe(false);
    expect(shouldRelayViewers(152, NOW2 - (VIEWER_REFRESH_MS - 1), 152, NOW2)).toBe(false);
  });

  it("changed count relays — but never faster than the MIN floor (busy-room bound)", () => {
    expect(shouldRelayViewers(152, NOW2 - VIEWER_RELAY_MIN_MS, 153, NOW2)).toBe(true);
    expect(shouldRelayViewers(152, NOW2 - (VIEWER_RELAY_MIN_MS - 1), 153, NOW2)).toBe(false);
  });

  it("30s heartbeat: an UNCHANGED count re-emits so late joiners/reuse taps recover the chip", () => {
    expect(shouldRelayViewers(152, NOW2 - VIEWER_REFRESH_MS, 152, NOW2)).toBe(true);
  });

  it("invalid counts never relay (non-finite / negative)", () => {
    expect(shouldRelayViewers(undefined, 0, NaN, NOW2)).toBe(false);
    expect(shouldRelayViewers(undefined, 0, Number.POSITIVE_INFINITY, NOW2)).toBe(false);
    expect(shouldRelayViewers(undefined, 0, -1, NOW2)).toBe(false);
  });

  it("missing lastRelayAt is treated as 0 (relays immediately — first-event path)", () => {
    expect(shouldRelayViewers(undefined, undefined as unknown as number, 5, NOW2)).toBe(true);
  });
});
