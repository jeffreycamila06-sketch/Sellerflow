// Phase 5f — unit tests for the PURE free-cap logic (no Supabase / React).
import { describe, it, expect } from "vitest";
import { computeFreeFlags, shouldShowNearCap, isCapError, type FreeStatus } from "../useFreeCap";

const fs = (over: Partial<FreeStatus> = {}): FreeStatus => ({ is_free: true, count: 10, cap: 200, ...over });

describe("computeFreeFlags", () => {
  it("free only when plan=free AND rpc is_free", () => {
    expect(computeFreeFlags("free", fs())).toEqual({ isFreeUser: true, freeCapped: false });
    expect(computeFreeFlags("basic", fs())).toEqual({ isFreeUser: false, freeCapped: false }); // paid plan
    expect(computeFreeFlags("free", fs({ is_free: false }))).toEqual({ isFreeUser: false, freeCapped: false });
    expect(computeFreeFlags("free", null)).toEqual({ isFreeUser: false, freeCapped: false });
  });
  it("capped only when free AND rpc capped", () => {
    expect(computeFreeFlags("free", fs({ capped: true })).freeCapped).toBe(true);
    expect(computeFreeFlags("basic", fs({ capped: true })).freeCapped).toBe(false); // paid never capped
  });
});

describe("shouldShowNearCap — mirrors App.tsx:4178-4187", () => {
  it("shows once when free + near_cap + not warned + no popup open", () => {
    expect(shouldShowNearCap(true, fs({ near_cap: true, warning_shown: false }), "")).toBe(true);
  });
  it("suppressed when capped / below threshold / already warned / popup open / not free", () => {
    expect(shouldShowNearCap(true, fs({ near_cap: true, capped: true }), "")).toBe(false);
    expect(shouldShowNearCap(true, fs({ near_cap: false }), "")).toBe(false);
    expect(shouldShowNearCap(true, fs({ near_cap: true, warning_shown: true }), "")).toBe(false);
    expect(shouldShowNearCap(true, fs({ near_cap: true }), "hard")).toBe(false);
    expect(shouldShowNearCap(false, fs({ near_cap: true }), "")).toBe(false);
    expect(shouldShowNearCap(true, null, "")).toBe(false);
  });
});

describe("isCapError — DB trigger rejection detection", () => {
  it("matches free_tier_cap_reached in message/string", () => {
    expect(isCapError(new Error("free_tier_cap_reached"))).toBe(true);
    expect(isCapError("insert failed: free_tier_cap_reached")).toBe(true);
    expect(isCapError({ message: "free_tier_cap_reached" })).toBe(true);
  });
  it("ignores unrelated errors", () => {
    expect(isCapError(new Error("network down"))).toBe(false);
    expect(isCapError(null)).toBe(false);
    expect(isCapError(undefined)).toBe(false);
  });
});
