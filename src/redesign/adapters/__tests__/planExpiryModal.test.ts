// Plan-expiry modal logic — tier computation (7/3/1/expired boundaries via the
// shared planWindow day count), dismiss-per-tier, expiry-over-update priority,
// tone escalation. Boundaries use planDaysLeft(expiry, nowMs) so they match the
// Settings expiry display exactly.
import { describe, it, expect, beforeEach } from "vitest";
import { planDaysLeft } from "../../../lib/planWindow";
import {
  computeExpiryTier, expiryTone, expiryDismissKey, wasExpiryDismissed, markExpiryDismissed,
  coldModalPriority,
} from "../planExpiryModal";

// Fixed "now" so the ceil-day math is deterministic. Expiry timestamps are built
// relative to it (planDaysLeft ceils partial days up → a stamp N days + 1h out
// reads as N+1 days left, matching the Settings display).
const NOW = Date.parse("2026-07-15T04:00:00Z");
const inDays = (n: number) => new Date(NOW + n * 86400000).toISOString();

describe("computeExpiryTier — boundaries", () => {
  it("maps the day count to tiers (integer buckets)", () => {
    for (const d of [4, 5, 6, 7]) expect(computeExpiryTier("pro", "active", d)).toBe("7d");
    for (const d of [2, 3]) expect(computeExpiryTier("pro", "active", d)).toBe("3d");
    expect(computeExpiryTier("pro", "active", 1)).toBe("1d");
    expect(computeExpiryTier("pro", "active", 0)).toBe("expired");
    expect(computeExpiryTier("pro", "active", 8)).toBeNull(); // >7 out
  });

  it("real timestamps via the shared planDaysLeft ceil-day count", () => {
    expect(computeExpiryTier("basic", "active", planDaysLeft(inDays(6.5), NOW))).toBe("7d"); // ceil → 7
    expect(computeExpiryTier("basic", "active", planDaysLeft(inDays(2.5), NOW))).toBe("3d"); // ceil → 3
    expect(computeExpiryTier("basic", "active", planDaysLeft(inDays(0.5), NOW))).toBe("1d"); // ceil → 1
  });

  it("expired status wins regardless of the day count", () => {
    expect(computeExpiryTier("master", "expired", 30)).toBe("expired");
    expect(computeExpiryTier("master", "expired", Infinity)).toBe("expired");
  });

  it("never shows for free / no-expiry / pending", () => {
    expect(computeExpiryTier("free", "active", 2)).toBeNull();       // cap-limited, not time-limited
    expect(computeExpiryTier("Free", "active", 0)).toBeNull();       // case-insensitive
    expect(computeExpiryTier("basic", "active", Infinity)).toBeNull(); // no/invalid expiry
    expect(computeExpiryTier("basic", "pending", 2)).toBeNull();     // pending has its own surface
  });

  it("boundary check at exactly 7 and just past it", () => {
    expect(computeExpiryTier("basic", "active", planDaysLeft(inDays(6.9), NOW))).toBe("7d"); // ceil → 7
    expect(computeExpiryTier("basic", "active", planDaysLeft(inDays(7.1), NOW))).toBeNull(); // ceil → 8
  });
});

describe("expiry tone escalates amber → red", () => {
  it("distinct tones per tier, red at the sharp end", () => {
    expect(expiryTone("7d").accent).not.toBe(expiryTone("1d").accent);
    expect(expiryTone("1d").fill).toContain("#ef4444");
    expect(expiryTone("expired").fill).toContain("#dc2626");
  });
});

describe("dismiss per tier + expiry date", () => {
  beforeEach(() => { try { sessionStorage.clear(); } catch { /* */ } });
  it("keys by tier + date; a new tier or new date re-prompts", () => {
    const exp = "2026-07-22T00:00:00Z";
    expect(expiryDismissKey("3d", exp)).toBe("sfl_exp_seen_3d_2026-07-22");
    expect(wasExpiryDismissed("3d", exp)).toBe(false);
    markExpiryDismissed("3d", exp);
    expect(wasExpiryDismissed("3d", exp)).toBe(true);
    expect(wasExpiryDismissed("1d", exp)).toBe(false);            // new tier → re-prompt
    expect(wasExpiryDismissed("3d", "2026-08-22T00:00:00Z")).toBe(false); // renewed → new date
  });
});

describe("cold-open priority — expiry beats update", () => {
  it("shows only one per open, expiry first", () => {
    expect(coldModalPriority(true, true)).toBe("expiry");
    expect(coldModalPriority(true, false)).toBe("expiry");
    expect(coldModalPriority(false, true)).toBe("update");
    expect(coldModalPriority(false, false)).toBeNull();
  });
});
