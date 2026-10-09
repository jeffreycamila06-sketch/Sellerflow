// Kiosk command — the exact Windows + Mac command strings (single source) + the
// gating predicate. A pasted command replaced the .bat download (Windows 11 Smart
// App Control blocks downloaded .bat files; a pasted command has no file).
import { describe, it, expect } from "vitest";
import { KIOSK_COMMAND_WINDOWS, KIOSK_COMMAND_MAC, canSeeKioskLauncher } from "../kioskLauncher";
import { setFeatureAccess } from "../featureAccess";
import { seedEmails } from "./featureSeed";
import type { AccountUser } from "../../../accountDb";

const acct = (over: Partial<AccountUser> = {}): AccountUser => ({
  authUserId: "u1", email: "seller@example.com",
  profile: { fullName: "S", storeName: "Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller", ...over,
});

describe("kiosk command strings (single source of truth)", () => {
  it("Windows command is exact (chrome + kiosk-printing + dedicated profile + prod URL)", () => {
    expect(KIOSK_COMMAND_WINDOWS).toBe('chrome --kiosk-printing --user-data-dir="%USERPROFILE%\\SFL-Chrome" https://sellerflowlive.com');
  });
  it("Mac command is exact (open -na Google Chrome + args + dedicated profile + prod URL)", () => {
    expect(KIOSK_COMMAND_MAC).toBe('open -na "Google Chrome" --args --kiosk-printing --user-data-dir="$HOME/SFL-Chrome" https://sellerflowlive.com');
  });
  it("both carry the kiosk-printing flag + the SFL-Chrome dedicated profile + the prod URL", () => {
    for (const cmd of [KIOSK_COMMAND_WINDOWS, KIOSK_COMMAND_MAC]) {
      expect(cmd).toContain("--kiosk-printing");
      expect(cmd).toContain("SFL-Chrome");
      expect(cmd).toContain("https://sellerflowlive.com");
    }
  });
});

describe("canSeeKioskLauncher gating (single allowlist)", () => {
  it("admin role → visible", () => {
    expect(canSeeKioskLauncher(acct({ role: "admin" }))).toBe(true);
  });
  it("listed account (sql/112 kiosk_launcher = googletest) → visible", () => {
    expect(seedEmails("kiosk_launcher")).toEqual(["googletest@gmail.com"]);
    setFeatureAccess({ kiosk_launcher: true });
    expect(canSeeKioskLauncher(acct({ email: "googletest@gmail.com" }))).toBe(true);
    setFeatureAccess(null);
  });
  it("ordinary seller → hidden", () => {
    expect(canSeeKioskLauncher(acct())).toBe(false);
    expect(canSeeKioskLauncher(acct({ email: "someoneelse@gmail.com" }))).toBe(false);
  });
  it("null account → hidden", () => {
    expect(canSeeKioskLauncher(null)).toBe(false);
    expect(canSeeKioskLauncher(undefined)).toBe(false);
  });
});
