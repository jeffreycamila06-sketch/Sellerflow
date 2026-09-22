// Option E — the reset-detection logic (decisions 4 & 5). Reset (#1) ONLY on a real
// PLATFORM switch while live; account switch / reconnect / fresh open → continue.
import { describe, it, expect } from "vitest";
import { liveSourcePreviewEnabled, livePlatformOf, isPlatformSwitch, isConnectableSource, LIVE_SOURCE_EMAILS } from "../liveSource";

describe("liveSourcePreviewEnabled — owner allowlist", () => {
  it("owner → true (case/space-insensitive); everyone else → false", () => {
    expect(liveSourcePreviewEnabled("camilajeffrey1@gmail.com")).toBe(true);
    expect(liveSourcePreviewEnabled("  CAMILAJEFFREY1@gmail.com ")).toBe(true);
    expect(liveSourcePreviewEnabled("googletest@gmail.com")).toBe(true); // non-admin test account (pre-widen)
    for (const e of ["random@seller.com", "x@y.com", "", null, undefined]) expect(liveSourcePreviewEnabled(e)).toBe(false);
    expect(LIVE_SOURCE_EMAILS).toEqual(["camilajeffrey1@gmail.com", "googletest@gmail.com"]);
  });
});

describe("livePlatformOf — in-memory active source from the Eff flags", () => {
  it("ttEff → TikTok; shopeeEff → Shopee; neither → null (fresh open / ended)", () => {
    expect(livePlatformOf({ ttEff: true, shopeeEff: false })).toBe("TikTok");
    expect(livePlatformOf({ ttEff: false, shopeeEff: true })).toBe("Shopee");
    expect(livePlatformOf({ ttEff: false, shopeeEff: false })).toBeNull();
  });
});

describe("isPlatformSwitch — the reset gate", () => {
  it("different platform WHILE live → true (reset #1)", () => {
    expect(isPlatformSwitch("TikTok", "Shopee")).toBe(true);
    expect(isPlatformSwitch("Shopee", "TikTok")).toBe(true);
  });
  it("SAME platform (account/shop switch) → false (continue)", () => {
    expect(isPlatformSwitch("TikTok", "TikTok")).toBe(false);
    expect(isPlatformSwitch("Shopee", "Shopee")).toBe(false);
  });
  it("nothing live (fresh open / crash reconnect) → false = DEFAULT CONTINUE (never wrongly reset)", () => {
    expect(isPlatformSwitch(null, "TikTok")).toBe(false);
    expect(isPlatformSwitch(null, "Shopee")).toBe(false);
  });
});

describe("isConnectableSource — only TikTok/Shopee route through switchSource", () => {
  it("TikTok/Shopee connectable; Facebook/Instagram not", () => {
    expect(isConnectableSource("TikTok")).toBe(true);
    expect(isConnectableSource("Shopee")).toBe(true);
    expect(isConnectableSource("Facebook")).toBe(false);
    expect(isConnectableSource("Instagram")).toBe(false);
  });
});
