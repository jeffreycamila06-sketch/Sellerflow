// The preview-gate truth table — the release-blocking field lesson pinned:
// a NATIVE SHELL is production regardless of the URL it loads, except the
// documented local-bundle dev APK (https://localhost). Browsers keep the
// hostname rule so Vercel-preview testing still works.
import { describe, it, expect } from "vitest";
import { computePreviewEnv } from "../previewEnv";

describe("computePreviewEnv (dev, hostname, nativeShell)", () => {
  it("vite dev server → preview, regardless of anything else", () => {
    expect(computePreviewEnv(true, "www.sellerflowlive.com", false)).toBe(true);
    expect(computePreviewEnv(true, "www.sellerflowlive.com", true)).toBe(true);
  });

  it("browser on production hostnames → PRODUCTION", () => {
    expect(computePreviewEnv(false, "www.sellerflowlive.com", false)).toBe(false);
    expect(computePreviewEnv(false, "sellerflowlive.com", false)).toBe(false);
  });

  it("browser on a Vercel preview / localhost → preview (dev affordances kept)", () => {
    expect(computePreviewEnv(false, "sellerflow-git-x-jeffrey-s-projects1.vercel.app", false)).toBe(true);
    expect(computePreviewEnv(false, "localhost", false)).toBe(true);
  });

  it("NATIVE SHELL loading production → PRODUCTION (the field-finding fix)", () => {
    expect(computePreviewEnv(false, "www.sellerflowlive.com", true)).toBe(false);
    expect(computePreviewEnv(false, "sellerflowlive.com", true)).toBe(false);
  });

  it("NATIVE SHELL on ANY non-localhost origin → PRODUCTION (preview-URL shells, server.url drift)", () => {
    // The exact hazard class that shipped once before: a drifted server.url.
    expect(computePreviewEnv(false, "sellerflow-git-x-jeffrey-s-projects1.vercel.app", true)).toBe(false);
    expect(computePreviewEnv(false, "evil.example.com", true)).toBe(false);
  });

  it("NATIVE SHELL local-bundle dev APK (localhost origin) → preview (device-testing flow kept)", () => {
    expect(computePreviewEnv(false, "localhost", true)).toBe(true);
    expect(computePreviewEnv(false, "127.0.0.1", true)).toBe(true);
  });
});
