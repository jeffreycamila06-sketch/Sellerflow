// Contract tests for the "Plus" subscription tier (cap 2, NT$1,000, between
// Basic and Pro). Load-bearing: a missed spot makes Plus silently behave like
// Free/Basic. Every assertion exercises REAL production code.
import { describe, it, expect } from "vitest";
import { maxAcc, canConnectMore, registeredAccountsFor } from "../connect";
import { maxAccountsForPlan, accountCapVerdict } from "../../../../server/accountCap.js";
import { PLAN_PRICE, matchPlan } from "../../../lib/planPricing";
import { quotaForPlan } from "../shippingExport";
import { rowToUser } from "../../../accountDb";
import type { AccountUser } from "../../../accountDb";

// ── B. Cap parity: client === server, both = 2 for Plus ──────────────────────
describe("Plus account cap = 2 (client/server parity)", () => {
  it("client maxAcc('plus') === 2, unchanged basic/pro/master", () => {
    expect(maxAcc("plus")).toBe(2);
    expect(maxAcc("basic")).toBe(1);
    expect(maxAcc("pro")).toBe(3);
    expect(maxAcc("master")).toBe(5);
  });
  it("server maxAccountsForPlan('plus') === 2, case-insensitive", () => {
    expect(maxAccountsForPlan("plus")).toBe(2);
    expect(maxAccountsForPlan("PLUS")).toBe(2);
    expect(maxAccountsForPlan(" Plus ")).toBe(2);
  });
  it("TEETH — client and server agree exactly on Plus", () => {
    expect(maxAcc("plus")).toBe(maxAccountsForPlan("plus"));
  });
});

// ── B. Enforcement: 2nd account allowed, 3rd blocked (both sides) ────────────
const acctUser = (over: Partial<AccountUser>): AccountUser => ({
  authUserId: "au", email: "seller@x.com",
  profile: { fullName: "", storeName: "", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "plus", planStatus: "active", planExpiry: "", trialStartedAt: "",
  connectedAccounts: [], role: "seller", createdAt: "", ...over,
});

describe("Plus enforcement — 2 allowed, 3rd blocked", () => {
  it("client canConnectMore: allows a 2nd (1/2), blocks a 3rd (2/2)", () => {
    expect(canConnectMore(acctUser({ profile: { ...acctUser({}).profile, tiktok: "a" } }))).toBe(true);         // 1/2 → can add
    expect(canConnectMore(acctUser({ profile: { ...acctUser({}).profile, tiktok: "a\nb" } }))).toBe(false);     // 2/2 → blocked
  });
  it("client registeredAccountsFor caps the visible list to 2", () => {
    const u = acctUser({ profile: { ...acctUser({}).profile, tiktok: "a\nb\nc" } });
    expect(registeredAccountsFor(u, "TikTok")).toEqual(["a", "b"]); // 3rd trimmed off
  });
  it("server accountCapVerdict: 2nd registered account allowed, unregistered 3rd blocked", () => {
    // Two accounts registered; connecting one of them = within cap 2 → allowed.
    expect(accountCapVerdict({ plan: "plus", role: "seller", tiktok: "a,b", platform: "TikTok", username: "b" }).allowed).toBe(true);
    // A 3rd account not in the registered list → blocked (reason account_limit, max 2).
    const v = accountCapVerdict({ plan: "plus", role: "seller", tiktok: "a,b", platform: "TikTok", username: "c" });
    expect(v.allowed).toBe(false);
    expect(v.max).toBe(2);
  });
  it("TEETH — a Basic seller (cap 1) is still blocked at the 2nd (unchanged)", () => {
    expect(canConnectMore(acctUser({ plan: "basic", profile: { ...acctUser({}).profile, tiktok: "a" } }))).toBe(false); // 1/1
  });
});

// ── A. Whitelist: 'plus' survives the accountDb mapper (NOT downgraded to free)
describe("Plus survives the accountDb plan whitelist", () => {
  it("rowToUser preserves plan='plus' (does NOT read as 'free')", () => {
    expect(rowToUser({ plan: "plus" }).plan).toBe("plus");
  });
  it("TEETH — an unknown plan still falls back to 'free', and 'plus' is NOT that path", () => {
    expect(rowToUser({ plan: "garbage" }).plan).toBe("free");
    expect(rowToUser({ plan: "plus" }).plan).not.toBe("free");
  });
  it("existing tiers still map unchanged", () => {
    for (const p of ["free", "trial", "basic", "pro", "master"]) expect(rowToUser({ plan: p }).plan).toBe(p);
  });
});

// ── C. Price / MRR + matchPlan ordering ──────────────────────────────────────
describe("Plus price + Basic raise (D1) + matchPlan ladder", () => {
  it("PLAN_PRICE: Plus=1000, Basic raised to 600, Pro/Master unchanged", () => {
    expect(PLAN_PRICE.Plus).toBe(1000);
    expect(PLAN_PRICE.Basic).toBe(600);
    expect(PLAN_PRICE.Pro).toBe(1200);
    expect(PLAN_PRICE.Master).toBe(1700);
  });
  it("matchPlan maps NT$1000–1199 to Plus (not Basic), boundaries correct", () => {
    expect(matchPlan("1000")).toBe("Plus");
    expect(matchPlan("1199")).toBe("Plus");
    expect(matchPlan("1200")).toBe("Pro");   // Pro boundary
    expect(matchPlan("600")).toBe("Basic");  // Basic boundary (raised)
    expect(matchPlan("599")).toBe("—");      // below Basic
    expect(matchPlan("1700")).toBe("Master");
  });
  it("TEETH — pre-change behavior is gone: 1000 no longer maps to Basic", () => {
    expect(matchPlan("1000")).not.toBe("Basic");
  });
});

// ── D. Shipping quota (D2): all paid unlimited, free capped ───────────────────
describe("Plus shipping quota (D2: all paid unlimited)", () => {
  it("quotaForPlan: basic/plus/pro/master unlimited (null), free = 50", () => {
    expect(quotaForPlan("plus")).toBeNull();
    expect(quotaForPlan("basic")).toBeNull();
    expect(quotaForPlan("pro")).toBeNull();
    expect(quotaForPlan("master")).toBeNull();
    expect(quotaForPlan("free")).toBe(50);
    expect(quotaForPlan(undefined)).toBe(50); // default → free
  });
});
