// LIVE sticker layout v2 — PUBLIC since 2026-10-02 (STICKER_LAYOUT_V2_PUBLIC = true): every
// seller gets v2 (layout, QR toggle in LIVE print pattern, exact preview); the long-comment
// test buttons stay admin-only. The allowlist (admins + exactly four emails) is the revert
// path — still covered below via publicFlag=false.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stickerV2Allowed, STICKER_V2_PREVIEW_EMAILS, STICKER_LAYOUT_V2_PUBLIC } from "../printing";

describe("stickerV2Allowed", () => {
  it("the public switch is ON (2026-10-02) → every seller is allowed by default", () => {
    expect(STICKER_LAYOUT_V2_PUBLIC).toBe(true);
    expect(stickerV2Allowed("random.seller@gmail.com", "seller")).toBe(true);
    expect(stickerV2Allowed(null, null)).toBe(true);
  });
  // The allowlist logic (only active when the public switch is OFF) stays covered by
  // passing publicFlag=false explicitly — the revert path.
  it("switch OFF (publicFlag=false): admins are allowed (any email)", () => {
    expect(stickerV2Allowed("anyone@example.com", "admin", false)).toBe(true);
    expect(stickerV2Allowed(null, "Admin", false)).toBe(true);
  });
  it("switch OFF (publicFlag=false): exactly the four allowlisted emails, case- and space-insensitive", () => {
    expect(STICKER_V2_PREVIEW_EMAILS).toEqual(["cristycabanas34@gmail.com", "ronaldgantiga77@gmail.com", "tincabanas13@gmail.com", "googletest@gmail.com"]);
    for (const e of STICKER_V2_PREVIEW_EMAILS) {
      expect(stickerV2Allowed(e, "seller", false)).toBe(true);
      expect(stickerV2Allowed(`  ${e.toUpperCase()}  `, "seller", false)).toBe(true);
    }
  });
  it("switch OFF (publicFlag=false) — NOT allowed: a random seller, null/empty email, near-misses (no prefix rules)", () => {
    expect(stickerV2Allowed("random.seller@gmail.com", "seller", false)).toBe(false);
    expect(stickerV2Allowed(null, "seller", false)).toBe(false);
    expect(stickerV2Allowed(undefined, undefined, false)).toBe(false);
    expect(stickerV2Allowed("", "seller", false)).toBe(false);
    expect(stickerV2Allowed("cristycabanas34@gmail.com.evil.com", "seller", false)).toBe(false);
    expect(stickerV2Allowed("googletest@sellerflowlive.com", "seller", false)).toBe(false);
    expect(stickerV2Allowed("budgetukay5@gmail.com", "seller", false)).toBe(false);
  });
  it("public switch true → everyone", () => {
    expect(stickerV2Allowed("random.seller@gmail.com", "seller", true)).toBe(true);
    expect(stickerV2Allowed(null, null, true)).toBe(true);
  });
});

describe("RedesignApp wiring", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("v2 on = stickerV2Allowed(email, role), and that is what the print path uses", () => {
    expect(app).toContain("const stickerV2On = stickerV2Allowed(auth.profile?.email, auth.profile?.role);");
    expect(app).toContain("useEffect(() => { setStickerLayoutV2Allowed(stickerV2On); }, [stickerV2On]);");
  });
  it("allowlisted sellers get the QR toggle move + exact preview (same flag as the layout)", () => {
    expect(app).toContain("stickerQrMoved={stickerV2On}");
    expect(app).toContain("layoutV2={stickerV2On}");
    expect(app).toContain("previewSettings={stickerV2On ? buildSettingsFromRedesign(");
  });
  it("the long-comment test buttons stay ADMIN-ONLY", () => {
    expect(app).toContain("onTestPrintSample={stickerV2On && isAdmin ? (item) =>");
  });
});
