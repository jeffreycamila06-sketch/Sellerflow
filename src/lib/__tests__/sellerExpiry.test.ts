// Deterministic tests for the seller-expiry display state. `now` is passed
// explicitly (the app passes its 60s nowTick), so no fake timers needed.
import { describe, it, expect } from "vitest";
import { sellerExpiryState, type SellerExpiryUser } from "../sellerExpiry";

const NOW = new Date("2026-06-11T04:00:00Z").getTime();
const daysFromNow = (d: number) => new Date(NOW + d * 86400000).toISOString();

const paidUser = (over: Partial<SellerExpiryUser> = {}): SellerExpiryUser => ({
  plan: "pro",
  planStatus: "active",
  planExpiry: daysFromNow(23),
  role: "seller",
  ...over,
});

describe("exclusions (returns null)", () => {
  it("no user", () => {
    expect(sellerExpiryState(null, NOW)).toBeNull();
    expect(sellerExpiryState(undefined, NOW)).toBeNull();
  });

  it("admin", () => {
    expect(sellerExpiryState(paidUser({ role: "admin" }), NOW)).toBeNull();
  });

  it("free plan (cap-limited, not time-limited)", () => {
    expect(sellerExpiryState(paidUser({ plan: "free" }), NOW)).toBeNull();
  });

  it("pending seller", () => {
    expect(sellerExpiryState(paidUser({ planStatus: "pending" }), NOW)).toBeNull();
  });

  it("missing planExpiry", () => {
    expect(sellerExpiryState(paidUser({ planExpiry: "" }), NOW)).toBeNull();
  });
});

describe("tiers for paid sellers", () => {
  it("23 days -> show, normal", () => {
    const s = sellerExpiryState(paidUser(), NOW);
    expect(s).toEqual(expect.objectContaining({ show: true, days: 23, tier: "normal" }));
  });

  it("8 days -> normal (boundary just above warning)", () => {
    expect(sellerExpiryState(paidUser({ planExpiry: daysFromNow(8) }), NOW)?.tier).toBe("normal");
  });

  it("7 days -> warning", () => {
    expect(sellerExpiryState(paidUser({ planExpiry: daysFromNow(7) }), NOW)?.tier).toBe("warning");
  });

  it("5 days -> warning", () => {
    const s = sellerExpiryState(paidUser({ planExpiry: daysFromNow(5) }), NOW);
    expect(s?.tier).toBe("warning");
    expect(s?.days).toBe(5);
  });

  it("3 days -> warning (boundary just above urgent)", () => {
    expect(sellerExpiryState(paidUser({ planExpiry: daysFromNow(3) }), NOW)?.tier).toBe("warning");
  });

  it("2 days -> urgent", () => {
    expect(sellerExpiryState(paidUser({ planExpiry: daysFromNow(2) }), NOW)?.tier).toBe("urgent");
  });

  it("1 day -> urgent", () => {
    const s = sellerExpiryState(paidUser({ planExpiry: daysFromNow(1) }), NOW);
    expect(s?.tier).toBe("urgent");
    expect(s?.days).toBe(1);
  });

  it("expired (past expiry) -> days clamps to 0, urgent — handled gracefully", () => {
    const s = sellerExpiryState(paidUser({ planExpiry: daysFromNow(-3) }), NOW);
    expect(s?.days).toBe(0);
    expect(s?.tier).toBe("urgent");
    expect(s?.show).toBe(true);
  });

  it("works for basic and master too", () => {
    expect(sellerExpiryState(paidUser({ plan: "basic" }), NOW)?.show).toBe(true);
    expect(sellerExpiryState(paidUser({ plan: "master" }), NOW)?.show).toBe(true);
  });
});

describe("expiryDate formatting", () => {
  it("formats as fixed en-GB short date", () => {
    const s = sellerExpiryState(paidUser({ planExpiry: "2026-08-15T12:00:00Z" }), NOW);
    expect(s?.expiryDate).toBe("15 Aug 2026");
  });

  it("invalid date = no expiry — hidden (was a 'NaN days' banner before the shared core)", () => {
    expect(sellerExpiryState(paidUser({ planExpiry: "not-a-date" }), NOW)).toBeNull();
  });
});
