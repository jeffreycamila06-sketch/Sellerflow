// Parcel Scan pending-batch cap: 50 for admin + googletest, 40 for everyone else.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { maxPendingParcels, MAX_PENDING_PARCELS, MAX_PENDING_PARCELS_TESTER, MAX_PENDING_PARCELS_SPECIAL } from "../parcelScan";
import { setFeatureAccess, FEATURE_KEYS } from "../featureAccess";
import { seedEmails } from "./featureSeed";

describe("maxPendingParcels", () => {
  it("the everyone-cap stays 40; testers get 50", () => {
    expect(MAX_PENDING_PARCELS).toBe(40);
    expect(MAX_PENDING_PARCELS_TESTER).toBe(50);
  });
  it("admin → 50 (any email, any role casing)", () => {
    expect(maxPendingParcels("someone@example.com", "admin")).toBe(50);
    expect(maxPendingParcels(null, " Admin ")).toBe(50);
  });
  it("tester flag (sql/112 parcel_cap_tester = googletest, both addresses) → 50", () => {
    expect(seedEmails("parcel_cap_tester")).toEqual(["googletest@gmail.com", "googletest@sellerflowlive.com"]);
    setFeatureAccess({ parcel_cap_tester: true });
    expect(maxPendingParcels("googletest@gmail.com", "seller")).toBe(50);
    setFeatureAccess(null);
    expect(maxPendingParcels("googletest@gmail.com", "seller")).toBe(40);
  });
  it("parcel_cap_70 (sql/117) → 70, checked before admin and the tester flag", () => {
    expect(MAX_PENDING_PARCELS_SPECIAL).toBe(70);
    setFeatureAccess({ parcel_cap_70: true });
    expect(maxPendingParcels("special.seller@gmail.com", "seller")).toBe(70);
    expect(maxPendingParcels("special.seller@gmail.com", "admin")).toBe(70);
    setFeatureAccess({ parcel_cap_70: true, parcel_cap_tester: true });
    expect(maxPendingParcels("googletest@gmail.com", "seller")).toBe(70);
    setFeatureAccess(null);
    expect(maxPendingParcels("special.seller@gmail.com", "seller")).toBe(40);
  });
  it("only parcel_cap_70 gives 70: tester flag 50, admin 50, normal 40", () => {
    setFeatureAccess({ parcel_cap_tester: true });
    expect(maxPendingParcels("googletest@gmail.com", "seller")).toBe(50);
    setFeatureAccess(null);
    expect(maxPendingParcels("boss@example.com", "admin")).toBe(50);
    expect(maxPendingParcels("normal@gmail.com", "seller")).toBe(40);
  });
  it("random seller → 40; null / empty / near-miss → 40", () => {
    expect(maxPendingParcels("random.seller@gmail.com", "seller")).toBe(40);
    expect(maxPendingParcels(null, null)).toBe(40);
    expect(maxPendingParcels(undefined, undefined)).toBe(40);
    expect(maxPendingParcels("", "seller")).toBe(40);
    expect(maxPendingParcels("googletest@gmail.com.evil.com", "seller")).toBe(40);
  });
});

describe("wiring", () => {
  it("RedesignApp computes the cap from the same email/role as parcelCheckAllowed and passes it to both screens", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("const parcelPendingCap = maxPendingParcels(auth.profile?.email, auth.profile?.role);");
    expect(app).toContain('pendingCap={parcelPendingCap} />');
    expect(app).toContain("<CustomerDetails cur={cur} pendingCap={parcelPendingCap} />");
  });
  it("the screens use the prop (default 40) — no hard-coded cap left in their logic", () => {
    const ps = readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8");
    expect(ps).toContain("pendingCap = MAX_PENDING_PARCELS");
    expect(ps).toContain("const batchFull = pendingCount >= pendingCap;");
    expect(ps).toContain("<CustomerDetails cur={cur} pendingCap={pendingCap}");
    const cd = readFileSync("src/redesign/screens/CustomerDetails.tsx", "utf8");
    expect(cd).toContain("if (cnt.count >= pendingCap)");
  });
});

describe("sql/117 my_feature_access", () => {
  const keysOf = (file: string) => {
    const body = readFileSync(file, "utf8");
    return [...body.slice(body.indexOf("keys(k) as (")).split("\n  )")[0].matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
  };
  it("keys = the sql/116 list plus parcel_cap_70 / fm_pickup / test_printers / tiktok_send; the latest (sql/137 fb_post_sales) matches the app's FEATURE_KEYS", () => {
    const k116 = keysOf("sql/116_help_bot.sql");
    const k117 = keysOf("sql/117_parcel_cap_70.sql");
    expect(k116[k116.length - 1]).toBe("support_ai_preview");
    expect(k117).toEqual([...k116, "parcel_cap_70"]);
    const k119 = keysOf("sql/119_fm_pickup.sql"); // 全家 preview
    expect(k119).toEqual([...k117, "fm_pickup"]);
    const k123 = keysOf("sql/123_test_printers_feature.sql");
    expect(k123).toEqual([...k119, "test_printers"]);
    const k126 = keysOf("sql/126_tiktok_send_feature.sql");
    expect(k126).toEqual([...k123, "tiktok_send"]);
    const k137 = keysOf("sql/137_fb_post_sales.sql"); // the LATEST my_feature_access list (Facebook Post Sales)
    expect(k137).toEqual([...k126, "fb_post_sales"]);
    expect([...k137].sort()).toEqual([...FEATURE_KEYS].sort());
    expect(keysOf("sql/137_fb_post_sales_rollback.sql")).toEqual(k126);
    // sql/126: no email rows; its rollback = the sql/123 list
    const sql126 = readFileSync("sql/126_tiktok_send_feature.sql", "utf8");
    expect(sql126).not.toMatch(/^\s*insert/im);
    expect(sql126).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(keysOf("sql/126_tiktok_send_feature_rollback.sql")).toEqual(k123);
  });
  it("no email rows in the file; the rollback restores the sql/116 list", () => {
    const sql = readFileSync("sql/117_parcel_cap_70.sql", "utf8");
    expect(sql).not.toMatch(/^\s*insert/im);
    expect(sql).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(keysOf("sql/117_parcel_cap_70_rollback.sql")).toEqual(keysOf("sql/116_help_bot.sql"));
  });
});
