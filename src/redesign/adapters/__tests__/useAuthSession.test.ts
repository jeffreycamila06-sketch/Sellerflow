// Phase 5a — unit tests for the PURE auth display helpers (no Supabase / React).
// Guards the real-profile → UI mapping that replaces the demo "Maria's Live Shop".
import { describe, it, expect } from "vitest";
import {
  planLabel,
  renewLabel,
  handleFromProfile,
  profileToDisplay,
  DEFAULT_CURRENCY,
  normalizePhone,
  phoneDisplay,
  isValidTaiwanMobile,
  registrationErrorCode,
  REG_ERROR_KEYS,
  validateRegistration,
  mapSignUpError,
  localKeysToClear,
  type RegisterFields,
} from "../useAuthSession";
import type { AccountUser } from "../../../accountDb";

const regFields = (over: Partial<RegisterFields> = {}): RegisterFields => ({
  email: "new@shop.com", password: "secret1", confirm: "secret1",
  fullName: "New Owner", storeName: "New Shop", phone: "0912 345 678", ...over,
});

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

// ── Registration / delete parity (App.tsx PublicAuth reg + handleDeleteAccount) ──

describe("normalizePhone / phoneDisplay — parity with App.tsx:254-255", () => {
  it("normalizePhone strips non-digits", () => {
    expect(normalizePhone("0917 555 0142")).toBe("09175550142");
    expect(normalizePhone("+886-912-345-678")).toBe("886912345678");
    expect(normalizePhone("")).toBe("");
  });
  it("phoneDisplay just trims (raw stored form)", () => {
    expect(phoneDisplay("  0917 000 0000  ")).toBe("0917 000 0000");
  });
});

describe("validateRegistration — parity with App.tsx reg (739-742)", () => {
  it("passes a complete valid form", () => {
    expect(validateRegistration(regFields())).toBe("");
  });
  it("requires all fields", () => {
    expect(validateRegistration(regFields({ fullName: "" }))).toBe("Please fill in all fields.");
    expect(validateRegistration(regFields({ storeName: " " }))).toBe("Please fill in all fields.");
    expect(validateRegistration(regFields({ email: "" }))).toBe("Please fill in all fields.");
    expect(validateRegistration(regFields({ password: "" }))).toBe("Please fill in all fields.");
  });
  it("requires a valid Taiwan mobile (09xxxxxxxx) — garbage/short rejected", () => {
    expect(validateRegistration(regFields({ phone: "12-34" }))).toBe("Enter a valid phone number.");
    expect(validateRegistration(regFields({ phone: "1234567" }))).toBe("Enter a valid phone number.");
    expect(validateRegistration(regFields({ phone: "12345678" }))).toBe("Enter a valid phone number."); // 8 digits but not a TW mobile
    expect(validateRegistration(regFields({ phone: "1234567890" }))).toBe("Enter a valid phone number."); // Jeff's exact prod input: 10 digits, NOT 09
    expect(validateRegistration(regFields({ phone: "0812345678" }))).toBe("Enter a valid phone number."); // 10 digits but not 09
    expect(validateRegistration(regFields({ phone: "0912345" }))).toBe("Enter a valid phone number."); // too short
    expect(validateRegistration(regFields({ phone: "09123456789" }))).toBe("Enter a valid phone number."); // too long
  });
  it("requires password >= 6 and matching confirm", () => {
    expect(validateRegistration(regFields({ password: "abc", confirm: "abc" }))).toBe("Password must be at least 6 characters.");
    expect(validateRegistration(regFields({ password: "secret1", confirm: "secret2" }))).toBe("Passwords do not match.");
  });
});

describe("isValidTaiwanMobile — normalize, don't reject legit formats", () => {
  it("accepts 09xxxxxxxx with spaces / dashes / +886", () => {
    expect(isValidTaiwanMobile("0912345678")).toBe(true);
    expect(isValidTaiwanMobile("0912 345 678")).toBe(true);
    expect(isValidTaiwanMobile("0912-345-678")).toBe(true);
    expect(isValidTaiwanMobile("+886912345678")).toBe(true); // +886 → 0
    expect(isValidTaiwanMobile("886 912 345 678")).toBe(true);
  });
  it("rejects non-TW-mobile / wrong length / empty", () => {
    expect(isValidTaiwanMobile("12345678")).toBe(false);   // no 09
    expect(isValidTaiwanMobile("0812345678")).toBe(false);  // 08, not 09
    expect(isValidTaiwanMobile("0912345")).toBe(false);     // short
    expect(isValidTaiwanMobile("09123456789")).toBe(false); // long
    expect(isValidTaiwanMobile("")).toBe(false);
  });
});

describe("registrationErrorCode + REG_ERROR_KEYS — single source, i18n mapping", () => {
  it("returns the right code per failure (first-fail order)", () => {
    expect(registrationErrorCode(regFields())).toBe("");
    expect(registrationErrorCode(regFields({ storeName: " " }))).toBe("fields");
    expect(registrationErrorCode(regFields({ phone: "123" }))).toBe("phone");
    expect(registrationErrorCode(regFields({ password: "abc", confirm: "abc" }))).toBe("pw_len");
    expect(registrationErrorCode(regFields({ confirm: "different1" }))).toBe("pw_match");
  });
  it("every non-empty code maps to an rd_su_err_* i18n key", () => {
    for (const code of ["fields", "phone", "pw_len", "pw_match"] as const) {
      expect(REG_ERROR_KEYS[code]).toMatch(/^rd_su_err_/);
    }
  });
});

describe("mapSignUpError — parity with App.tsx (746)", () => {
  it("maps duplicate-email errors to a friendly message", () => {
    expect(mapSignUpError("User already registered")).toMatch(/already registered/i);
    expect(mapSignUpError("Email exists")).toMatch(/already registered/i);
  });
  it("maps everything else to a generic message", () => {
    expect(mapSignUpError("weak password")).toBe("Could not create your account. Please try again.");
  });
});

describe("localKeysToClear — parity with App.tsx handleDeleteAccount (4213)", () => {
  it("lists the global + per-seller keys (sellerIdOf = lowercased email)", () => {
    const keys = localKeysToClear("Owner@Shop.com");
    expect(keys).toContain("sf_session");
    expect(keys).toContain("sf_orders");
    expect(keys).toContain("sf_comments:owner@shop.com");
    expect(keys).toContain("sf_printed:owner@shop.com");
    expect(keys).toContain("sf_buyers:owner@shop.com");
    expect(keys).toHaveLength(11);
  });
});
