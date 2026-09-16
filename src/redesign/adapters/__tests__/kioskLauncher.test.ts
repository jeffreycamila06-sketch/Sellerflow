// Kiosk launcher (.bat) — exact Windows content (CRLF) + the gating predicate.
import { describe, it, expect } from "vitest";
import { KIOSK_LAUNCHER_BAT, KIOSK_LAUNCHER_FILENAME, KIOSK_LAUNCHER_EMAILS, canSeeKioskLauncher } from "../kioskLauncher";
import type { AccountUser } from "../../../accountDb";

const acct = (over: Partial<AccountUser> = {}): AccountUser => ({
  authUserId: "u1", email: "seller@example.com",
  profile: { fullName: "S", storeName: "Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller", ...over,
});

describe("kiosk launcher .bat content", () => {
  it("filename is SellerFlowLive-Print.bat", () => {
    expect(KIOSK_LAUNCHER_FILENAME).toBe("SellerFlowLive-Print.bat");
  });

  it("is the EXACT batch text with CRLF line endings", () => {
    const expected =
      "@echo off\r\n" +
      'set CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\r\n' +
      'if not exist %CHROME% set CHROME="C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"\r\n' +
      'if not exist %CHROME% set CHROME="%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"\r\n' +
      'start "" %CHROME% --kiosk-printing --user-data-dir="%USERPROFILE%\\SFL-Chrome" https://sellerflowlive.com\r\n';
    expect(KIOSK_LAUNCHER_BAT).toBe(expected);
  });

  it("every newline is CRLF — no lone LF", () => {
    expect(KIOSK_LAUNCHER_BAT).not.toMatch(/[^\r]\n/); // an \n never preceded by \r
    expect(KIOSK_LAUNCHER_BAT.split("\r\n").length).toBe(6); // 5 lines + trailing empty
    expect(KIOSK_LAUNCHER_BAT).toContain("--kiosk-printing");
    expect(KIOSK_LAUNCHER_BAT).toContain("Program Files (x86)");
    expect(KIOSK_LAUNCHER_BAT).toContain("%LOCALAPPDATA%");
  });
});

describe("canSeeKioskLauncher gating (single allowlist)", () => {
  it("admin role → visible", () => {
    expect(canSeeKioskLauncher(acct({ role: "admin" }))).toBe(true);
  });
  it("allowlisted email (googletest@gmail.com, case-insensitive) → visible", () => {
    expect(KIOSK_LAUNCHER_EMAILS).toContain("googletest@gmail.com");
    expect(canSeeKioskLauncher(acct({ email: "googletest@gmail.com" }))).toBe(true);
    expect(canSeeKioskLauncher(acct({ email: "GoogleTest@Gmail.com" }))).toBe(true);
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
