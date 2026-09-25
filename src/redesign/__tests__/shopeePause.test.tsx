// ⏸ SHOPEE PAUSED (owner decision 2026-09-25 — paused, NOT cancelled). While
// SHOPEE_PAUSED is true, NO Shopee UI shows for ANY seller, plan, admin, or the
// owner-preview allowlist — even if app_settings shopee_enabled is flipped on. Nothing
// is deleted: these tests pin that the gate is closed AND that the Shopee code is still
// all there (so resuming = one constant).
import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";

vi.mock("../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));

import { SHOPEE_PAUSED, loadShopeeEnabled } from "../adapters/shopee";
import { shopeePreviewEnabled, SHOPEE_PREVIEW_EMAILS } from "../adapters/shopeePreview";

describe("the Shopee master off switch", () => {
  it("is ON (paused)", () => {
    expect(SHOPEE_PAUSED).toBe(true);
  });
  it("the global flag reads as closed", async () => {
    expect(await loadShopeeEnabled()).toBe(false);
  });
  it("the owner-preview allowlist cannot reopen it, even with an email on the list", () => {
    SHOPEE_PREVIEW_EMAILS.push("camilajeffrey1@gmail.com");
    try {
      expect(shopeePreviewEnabled("camilajeffrey1@gmail.com")).toBe(false);
    } finally {
      SHOPEE_PREVIEW_EMAILS.length = 0;
    }
  });
});

describe("RedesignApp — every Shopee surface sits behind the closed gate", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("the effective switch is the flag OR the owner preview — both closed while paused", () => {
    expect(app).toContain("const shopeeEnabled = shopeeFlag || shopeePreview;");
    expect(app).toContain("const showShopeeRow = shopeeEnabled && !marketHides(\"shopee\", market);");
  });
  it("the Shopee screen only renders when enabled", () => {
    expect(app).toContain('{screen === "shopeechannels" && shopeeEnabled && (');
  });
  it("a stray ?shopee= OAuth return does nothing while paused", () => {
    expect(app).toMatch(/if \(SHOPEE_PAUSED\) return;[^\n]*\n\s*const ret = parseShopeeReturn/);
  });
  it("Live chip, Manage Channels row, Connect tab and Live Source rows all take the gated values", () => {
    expect(app).toMatch(/shopeeEnabled=\{shopeeEnabled\}\s*\n\s*shopeeShops=/);                // Dashboard chip
    expect(app).toContain("shopeeEnabled={shopeeEnabled} onShopee=");                          // Manage Channels row
    expect(app).toContain("shopeeEnabled={shopeeEnabled} shopeeShops=");                       // Connect modal tab
    expect(app.match(/showShopee(=\{showShopeeRow\}|: showShopeeRow)/g)?.length).toBe(2);      // Live Source sheet + Settings channels list
  });
});

describe("nothing Shopee was deleted — only hidden", () => {
  for (const f of [
    "src/redesign/screens/ShopeeChannels.tsx", "src/redesign/adapters/shopee.ts", "src/redesign/adapters/shopeePreview.ts",
    "server/shopeeComment.js", "server/shopeeConfig.js", "server/shopeeLive.js", "server/shopeeSign.js", "server/shopeeTokens.js",
    "sql/37_shopee_shops.sql",
  ]) it(`${f} still exists`, () => expect(existsSync(f)).toBe(true));
});
