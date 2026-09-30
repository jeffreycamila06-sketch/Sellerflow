// LIVE sticker layout v2 — allowlist release (the pinToPrint pattern). Admins + exactly
// four emails get v2 (layout, QR toggle in LIVE print pattern, exact preview); the
// long-comment test buttons stay admin-only; everyone else is unchanged.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stickerV2Allowed, STICKER_V2_PREVIEW_EMAILS, STICKER_LAYOUT_V2_PUBLIC } from "../printing";

describe("stickerV2Allowed", () => {
  it("the public switch is still OFF", () => {
    expect(STICKER_LAYOUT_V2_PUBLIC).toBe(false);
  });
  it("admins are allowed (any email)", () => {
    expect(stickerV2Allowed("anyone@example.com", "admin")).toBe(true);
    expect(stickerV2Allowed(null, "Admin")).toBe(true);
  });
  it("exactly the four allowlisted emails, case- and space-insensitive", () => {
    expect(STICKER_V2_PREVIEW_EMAILS).toEqual(["cristycabanas34@gmail.com", "ronaldgantiga77@gmail.com", "tincabanas13@gmail.com", "googletest@gmail.com"]);
    for (const e of STICKER_V2_PREVIEW_EMAILS) {
      expect(stickerV2Allowed(e, "seller")).toBe(true);
      expect(stickerV2Allowed(`  ${e.toUpperCase()}  `, "seller")).toBe(true);
    }
  });
  it("NOT allowed: a random seller, null/empty email, near-misses (no prefix rules)", () => {
    expect(stickerV2Allowed("random.seller@gmail.com", "seller")).toBe(false);
    expect(stickerV2Allowed(null, "seller")).toBe(false);
    expect(stickerV2Allowed(undefined, undefined)).toBe(false);
    expect(stickerV2Allowed("", "seller")).toBe(false);
    expect(stickerV2Allowed("cristycabanas34@gmail.com.evil.com", "seller")).toBe(false);
    expect(stickerV2Allowed("googletest@sellerflowlive.com", "seller")).toBe(false);
    expect(stickerV2Allowed("budgetukay5@gmail.com", "seller")).toBe(false);
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
