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
    expect(app).toContain('pendingCap={parcelPendingCap} contactOn={buyerContactOn} />'); // sql/140 buyer contact rides the same mount
    expect(app).toContain("<CustomerDetails onBack={() => goBack()} cur={cur} pendingCap={parcelPendingCap} contactOn={buyerContactOn} />");
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
  it("keys = the sql/116 list plus parcel_cap_70 / fm_pickup / test_printers / tiktok_send / fb_post_sales; the latest (sql/199 account_limits_v2) matches the app's FEATURE_KEYS", () => {
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
    const k140 = keysOf("sql/140_buyer_contact.sql"); // buyer contact
    expect(k140).toEqual([...k137, "buyer_contact"]);
    const k146 = keysOf("sql/146_one_sticker_feature_access.sql"); // the LATEST my_feature_access list (one sticker per account)
    expect(k146).toEqual([...k140, "one_sticker", "sticker_all_scripts"]);
    const k149 = keysOf("sql/149_scan_qr_lookup.sql"); // the LATEST my_feature_access list (Scan QR → Customers lookup)
    expect(k149).toEqual([...k146, "scan_qr_lookup"]);
    const k155 = keysOf("sql/155_fm_store_check.sql"); // the LATEST my_feature_access list (FamilyMart store # check)
    expect(k155).toEqual([...k149, "fm_store_check"]);
    const k160 = keysOf("sql/160_printer_testers.sql"); // printer testers
    expect(k160).toEqual([...k155, "printer_tester"]);
    const k163 = keysOf("sql/163_seller_website.sql"); // seller website
    expect(k163).toEqual([...k160, "seller_website"]);
    const k190 = keysOf("sql/190_buyer_blacklist.sql"); // blacklist
    expect(k190).toEqual([...k163, "blacklist"]);
    const k199 = keysOf("sql/199_account_limits_v2.sql"); // account limits v2 preview
    expect(k199).toEqual([...k190, "account_limits_v2"]);
    const k206 = keysOf("sql/206_shopee_public.sql"); // the LATEST my_feature_access list (Shopee for every seller, preview)
    expect(k206).toEqual([...k199, "shopee_public"]);
    expect([...k206].sort()).toEqual([...FEATURE_KEYS].sort());
    expect(keysOf("sql/206_shopee_public_rollback.sql")).toEqual(k199);
    expect(keysOf("sql/199_account_limits_v2_rollback.sql")).toEqual(k190);
    expect(keysOf("sql/190_buyer_blacklist_rollback.sql")).toEqual(k163);
    expect(keysOf("sql/160_printer_testers_rollback.sql")).toEqual(k155);
    expect(keysOf("sql/155_fm_store_check_rollback.sql")).toEqual(k149);
    expect(keysOf("sql/149_scan_qr_lookup_rollback.sql")).toEqual(k146);
    expect(keysOf("sql/146_one_sticker_feature_access_rollback.sql")).toEqual(k140);
    expect(keysOf("sql/140_buyer_contact_rollback.sql")).toEqual(k137);
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
