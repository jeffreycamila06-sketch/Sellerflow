// FACEBOOK PREVIEW (owner-only visibility gate). Pins the allowlist + the placeholder
// injection. Mirror of shopeePreview.test.ts.
import { describe, it, expect } from "vitest";
import { FB_PREVIEW_EMAILS, fbPreviewEnabled, withFbPreview, FB_PREVIEW_PAGE } from "../fbPreview";
import type { FbPage } from "../fb";

describe("fbPreviewEnabled — email allowlist", () => {
  it("allowlisted owner + googletest → true (case/space-insensitive)", () => {
    expect(FB_PREVIEW_EMAILS).toEqual(["camilajeffrey1@gmail.com", "googletest@sellerflowlive.com"]);
    for (const e of ["camilajeffrey1@gmail.com", "  CAMILAJEFFREY1@gmail.com ", "googletest@sellerflowlive.com"]) {
      expect(fbPreviewEnabled(e)).toBe(true);
    }
  });
  it("everyone else → false (the activation gate stays for them)", () => {
    for (const e of ["random@seller.com", "", null, undefined]) expect(fbPreviewEnabled(e)).toBe(false);
  });
});

describe("withFbPreview — placeholder injection", () => {
  it("preview + empty real list → the display-only placeholder page", () => {
    expect(withFbPreview([], true)).toEqual([FB_PREVIEW_PAGE]);
  });
  it("a real page ALWAYS wins (never injects when the list is non-empty)", () => {
    const real: FbPage[] = [{ id: "r1", pageId: "P1", name: "Real", username: "real", active: true }];
    expect(withFbPreview(real, true)).toBe(real);
  });
  it("NON-preview → list returned untouched (no placeholder ever)", () => {
    expect(withFbPreview([], false)).toEqual([]);
  });
  it("the placeholder is a zero-UUID / sentinel pageId (matches no DB row → safe no-op)", () => {
    expect(FB_PREVIEW_PAGE.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(FB_PREVIEW_PAGE.pageId).toBe("0");
  });
});
