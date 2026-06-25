// Phase 5a — unit tests for the PURE auth display helpers (no Supabase / React).
// Guards the real-profile → UI mapping that replaces the demo "Maria's Live Shop".
import { describe, it, expect } from "vitest";
import {
  planLabel,
  renewLabel,
  handleFromProfile,
  profileToDisplay,
  DEFAULT_CURRENCY,
} from "../useAuthSession";
import type { AccountUser } from "../../../accountDb";

function makeUser(over: Partial<AccountUser> = {}): AccountUser {
  return {
    authUserId: "auth-1",
    email: "googletest@sellerflowlive.com",
    profile: {
      fullName: "Test Owner",
      storeName: "Taipei Live Shop",
      phone: "0900 000 000",
      tiktok: "tpe_live",
      facebook: "Taipei Live Shop",
      adminContactNote: "",
    },
    plan: "pro",
    planStatus: "active",
    planExpiry: "2026-07-28T00:00:00.000Z",
    connectedAccounts: [],
    role: "seller",
    ...over,
  };
}

describe("planLabel", () => {
  it("maps known plans to capitalized labels", () => {
    expect(planLabel("free")).toBe("Free");
    expect(planLabel("pro")).toBe("Pro");
    expect(planLabel("master")).toBe("Master");
  });
  it("falls back to Free for empty/unknown", () => {
    expect(planLabel("")).toBe("Free");
    expect(planLabel(null)).toBe("Free");
    expect(planLabel("custom")).toBe("Custom");
  });
});

describe("renewLabel", () => {
  it('formats a valid expiry as "renews Mon D"', () => {
    expect(renewLabel("2026-07-28T00:00:00.000Z")).toBe("renews Jul 28");
  });
  it("returns empty for missing/invalid dates", () => {
    expect(renewLabel("")).toBe("");
    expect(renewLabel(null)).toBe("");
    expect(renewLabel("not-a-date")).toBe("");
  });
});

describe("handleFromProfile", () => {
  it("prefixes @ when missing", () => {
    expect(handleFromProfile(makeUser())).toBe("@tpe_live");
  });
  it("keeps an existing @ and trims", () => {
    expect(handleFromProfile(makeUser({ profile: { ...makeUser().profile, tiktok: " @already " } }))).toBe("@already");
  });
  it("returns empty when no tiktok handle", () => {
    expect(handleFromProfile(makeUser({ profile: { ...makeUser().profile, tiktok: "" } }))).toBe("");
    expect(handleFromProfile(null)).toBe("");
  });
});

describe("profileToDisplay", () => {
  it("returns null for no profile (caller shows demo fallback)", () => {
    expect(profileToDisplay(null)).toBeNull();
  });
  it("maps a real profile to the card fields", () => {
    const d = profileToDisplay(makeUser())!;
    expect(d.shopName).toBe("Taipei Live Shop");
    expect(d.handle).toBe("@tpe_live");
    expect(d.planLabel).toBe("Pro");
    expect(d.renewLabel).toBe("renews Jul 28");
    expect(d.planLine).toBe("Pro plan · renews Jul 28");
    expect(d.initials).toBe("TL");
  });
  it("falls back shopName to fullName then email; omits renew when no expiry", () => {
    const d = profileToDisplay(makeUser({
      profile: { ...makeUser().profile, storeName: "" },
      plan: "free",
      planExpiry: "",
    }))!;
    expect(d.shopName).toBe("Test Owner");
    expect(d.planLine).toBe("Free plan");
  });
});

describe("DEFAULT_CURRENCY", () => {
  it("is NT$ (TWD) for the Taiwan market", () => {
    expect(DEFAULT_CURRENCY).toBe("TWD");
  });
});
