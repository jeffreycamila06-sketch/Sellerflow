// Owner-only Shopee preview gate — opens the Shopee UI for ONE account without the
// global shopee_enabled flag, and injects a display-only placeholder shop so the
// screens render populated. Everyone else → false → zero Shopee UI (unchanged).
import { describe, it, expect } from "vitest";
import { shopeePreviewEnabled, withShopeePreview, SHOPEE_PREVIEW_SHOP, SHOPEE_PREVIEW_EMAILS } from "../shopeePreview";
import type { ShopeeShop } from "../shopee";

describe("shopeePreviewEnabled — owner allowlist only", () => {
  it("SOFT-REVERTED: the allowlist is empty → Shopee preview OFF for everyone", () => {
    expect(SHOPEE_PREVIEW_EMAILS).toEqual([]);
    for (const e of ["camilajeffrey1@gmail.com", "  CamilaJeffrey1@Gmail.com ", "someone@else.com", "", null, undefined]) {
      expect(shopeePreviewEnabled(e)).toBe(false);
    }
  });
});

describe("withShopeePreview — placeholder only when preview AND empty", () => {
  const real: ShopeeShop[] = [{ id: "u1", shopId: 111, shopName: "Real Shop", active: true }];
  it("preview + empty real list → the single placeholder (shopId 0, zero-uuid)", () => {
    const out = withShopeePreview([], true);
    expect(out).toEqual([SHOPEE_PREVIEW_SHOP]);
    expect(out[0].shopId).toBe(0);
    expect(out[0].id).toBe("00000000-0000-0000-0000-000000000000");
  });
  it("preview + a REAL shop → real wins (no placeholder)", () => {
    expect(withShopeePreview(real, true)).toBe(real);
  });
  it("NOT preview → untouched, never injects (empty stays empty)", () => {
    expect(withShopeePreview([], false)).toEqual([]);
    expect(withShopeePreview(real, false)).toBe(real);
  });
});
