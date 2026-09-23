// FACEBOOK ALLOWLIST (owner + test accounts, full access). Pins the allowlist and that the
// old placeholder/stub page mechanism is GONE (it occupied the plan's page slot and
// blocked Authorize for allowlisted accounts with no real page — e.g. the Meta App Review
// account).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as fbPreview from "../fbPreview";
import { FB_PREVIEW_EMAILS, fbPreviewEnabled } from "../fbPreview";

describe("fbPreviewEnabled — email allowlist", () => {
  it("allowlisted owner + googletest + Meta App Review account → true (case/space-insensitive)", () => {
    expect(FB_PREVIEW_EMAILS).toEqual(["camilajeffrey1@gmail.com", "googletest@gmail.com", "test@gmail.com"]);
    for (const e of ["camilajeffrey1@gmail.com", "  CAMILAJEFFREY1@gmail.com ", "googletest@gmail.com", "test@gmail.com"]) {
      expect(fbPreviewEnabled(e)).toBe(true);
    }
  });
  it("everyone else → false (the activation gate stays for them)", () => {
    for (const e of ["random@seller.com", "", null, undefined]) expect(fbPreviewEnabled(e)).toBe(false);
  });
});

describe("no placeholder stub page (allowlisted accounts get the FULL real flow)", () => {
  it("fbPreview exports no stub page / injector", () => {
    expect("FB_PREVIEW_PAGE" in fbPreview).toBe(false);
    expect("withFbPreview" in fbPreview).toBe(false);
  });
  it("RedesignApp loads REAL pages only (no stub injection) and FbChannels has no preview-block on Remove", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    const ch = readFileSync("src/redesign/screens/FbChannels.tsx", "utf8");
    expect(app).not.toContain("withFbPreview");
    expect(app).toContain("setFbPages(await listFbPages())");
    expect(app).not.toMatch(/<FbChannels[^>]*preview=/);
    expect(ch).not.toContain("rd_fb_preview_note");
    expect(ch).not.toMatch(/if \(preview\)/);
  });
});
