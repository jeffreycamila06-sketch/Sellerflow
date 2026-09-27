// MULTI-SELLER STORE/PHONE CHECK (2026-09-27) — client + SQL + extension
// contract tests. The safety property that anchors everything: EVERY check
// uses the parcel OWNER's own GM (attribution), enforced structurally in the
// pending RPC's INNER JOIN and pinned here at every layer.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseGmId, validOrdMobile, parcelCheckAllowed, PARCEL_CHECK_PUBLIC, PARCEL_CHECK_PREVIEW_EMAILS } from "../parcelCheck";
import { parseGmPage, validGmShape } from "../../../../server/myshipValidate.js";

describe("parseGmId — shop link OR bare id", () => {
  it("accepts the real link shapes and bare ids, canonical uppercase", () => {
    for (const inp of [
      "https://myship.7-11.com.tw/cart/easy/GM2609096099718",
      "http://myship.7-11.com.tw/cart/easy/GM2609096099718#",
      "myship.7-11.com.tw/cart/easy/GM2609096099718?x=1",
      "GM2609096099718", "gm2609096099718", "  GM2609096099718  ",
    ]) expect(parseGmId(inp), inp).toBe("GM2609096099718");
  });
  it("rejects garbage, non-myship URLs carrying a GM-shaped id, and empties", () => {
    expect(parseGmId("")).toBeNull();
    expect(parseGmId(null)).toBeNull();
    expect(parseGmId("hello")).toBeNull();
    expect(parseGmId("GM123")).toBeNull(); // too short
    expect(parseGmId("https://evil.example.com/GM2609096099718")).toBeNull(); // wrong host
    // audit MEDIUM-1: host text inside another site's PATH must not pass —
    // the hostname itself must be myship, and the GM comes from the path only
    expect(parseGmId("https://evil.example/myship.7-11.com.tw/cart/easy/GM2609096099718")).toBeNull();
    expect(parseGmId("https://myship.7-11.com.tw.evil.example/cart/easy/GM2609096099718")).toBeNull();
    expect(parseGmId("https://myship.7-11.com.tw/other/GM2609096099718")).toBeNull(); // wrong path
  });
});

describe("validOrdMobile — the 7-11 shipping phone rule", () => {
  it("09 + 8 digits only", () => {
    expect(validOrdMobile("0917827508")).toBe(true);
    expect(validOrdMobile("0912345678")).toBe(true);
    expect(validOrdMobile("917827508")).toBe(false);
    expect(validOrdMobile("09178275081")).toBe(false);
    expect(validOrdMobile("")).toBe(false);
  });
});

describe("DOGFOOD GATE — exact allowlist (NO budgetukay* prefix this time, deliberate)", () => {
  it("flip is OFF; the exact five emails + admins pass; everyone else fails", () => {
    expect(PARCEL_CHECK_PUBLIC).toBe(false);
    expect(PARCEL_CHECK_PREVIEW_EMAILS).toEqual([
      "googletest@gmail.com", "googletest@sellerflowlive.com",
    ]);
    // Trimmed to googletest + admins only (owner 2026-09-27) while debugging —
    // NO production shop is gated. Each pinned NOT allowed → byte-unchanged
    // Parcel Scan (no gate, no Settings card).
    expect(parcelCheckAllowed("sanggalanglhea@gmail.com", "seller")).toBe(false);
    expect(parcelCheckAllowed("budgetukay5@gmail.com", "seller")).toBe(false);
    expect(parcelCheckAllowed("ukaydaily1@gmail.com", "seller")).toBe(false);
    for (const e of PARCEL_CHECK_PREVIEW_EMAILS) expect(parcelCheckAllowed(e, "seller"), e).toBe(true);
    expect(parcelCheckAllowed("GOOGLETEST@GMAIL.COM", "seller")).toBe(true); // case-insensitive
    expect(parcelCheckAllowed("anyone@x.com", "admin")).toBe(true);
    expect(parcelCheckAllowed("budgetukay2@gmail.com", "seller")).toBe(false); // NO prefix rule
    expect(parcelCheckAllowed("random@x.com", "seller")).toBe(false);
    expect(parcelCheckAllowed(null, null)).toBe(false);
  });
});

describe("server/myshipValidate — parseGmPage (probe-verified page shape)", () => {
  const gm = "GM2609096099718";
  const good = `<html><head><title>ukaydaily</title></head><body><input id="Cgdm_Id" value="${gm}"></body></html>`;
  it("valid page → shop name from <title>, Cgdm_Id echo required", () => {
    expect(parseGmPage(good, gm)).toEqual({ valid: true, shopName: "ukaydaily" });
  });
  it("busy/error page, missing echo, WRONG echo → invalid (never confirm an unseen shop)", () => {
    expect(parseGmPage(good.replace("ukaydaily", "系統忙碌中"), gm).valid).toBe(false);
    expect(parseGmPage("<title>ukaydaily</title>", gm).valid).toBe(false);
    expect(parseGmPage(good, "GM9999999999").valid).toBe(false);
    expect(parseGmPage("", gm).valid).toBe(false);
  });
  it("validGmShape gates the endpoint input", () => {
    expect(validGmShape("GM2609096099718")).toBe(true);
    expect(validGmShape("GM12")).toBe(false);
    expect(validGmShape("../etc")).toBe(false);
  });
});

describe("sql/53 contract pins", () => {
  const sql = readFileSync("sql/53_multi_seller_parcel_check.sql", "utf8");
  it("all 3 RPCs gate on is_admin() inside the body", () => {
    expect(sql.match(/if not public\.is_admin\(\) then/g)?.length).toBe(3);
  });
  it("ATTRIBUTION: the pending select INNER JOINs each seller's OWN config, non-empty only", () => {
    expect(sql).toContain("join seller_myship_config cfg");
    expect(sql).toContain("cfg.user_id = ps.user_id");
    expect(sql).toContain("coalesce(cfg.gm_id, '')      <> ''");
    expect(sql).toContain("coalesce(cfg.ord_mobile, '') <> ''");
  });
  it("FAIRNESS: round-robin rank per seller by AGE, rank-first ordering", () => {
    expect(sql).toContain("row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank");
    expect(sql).toContain("order by p.seller_rank asc, p.created_at asc");
  });
  it("kill switch: pending returns empty unless app_settings says 'true'", () => {
    expect(sql).toContain("parcel_check_multi_enabled");
    expect(sql).toContain("coalesce(v_enabled, 'false') <> 'true'");
  });
  it("cache: unknown never cached; restricted honors restricted_until; ok = 7 days; cache table client-locked", () => {
    expect(sql).toContain("check (status in ('ok','restricted'))"); // 'unknown' can't even be stored
    expect(sql).toContain("if p_phone_check_status in ('ok','restricted') then");
    expect(sql).toContain("c.restricted_until >= (now() at time zone 'Asia/Taipei')::date");
    expect(sql).toContain("c.checked_at > now() - interval '7 days'");
    expect(sql).toContain("revoke all on public.phone_check_cache from anon, authenticated;");
  });
  it("verdict whitelist + null-half semantics", () => {
    expect(sql).toContain("not in ('open','full','unknown')");
    expect(sql).toContain("not in ('ok','restricted','unknown')");
    expect(sql).toContain("coalesce(p_store_full_status, store_full_status)");
    expect(sql).toContain("coalesce(p_phone_check_status, phone_check_status)");
  });
});

describe("extension wiring pins (background.js multi-seller path)", () => {
  const bg = readFileSync("chrome-extension/background.js", "utf8");
  const multiStart = bg.indexOf("async function pcPollMulti");
  const multi = bg.slice(multiStart, bg.indexOf("// ~5s cadence", multiStart));

  it("mode is DEFAULT OFF and the legacy owner path still uses the popup config (unchanged)", () => {
    expect(bg).toContain("multiSeller: c.multiSeller === true,");
    const legacy = bg.slice(bg.indexOf("async function pcPoll("), multiStart);
    expect(legacy).toContain("cgdmId: cfg.cgdmId"); // legacy path untouched
  });

  it("ATTRIBUTION HARD RULE: the multi path sends ONLY the row owner's GM + phone — the popup's global config never appears", () => {
    expect(multi).toContain("config: { cgdmId: row.gm_id, ordMobile: row.ord_mobile }");
    expect(multi).not.toContain("cfg.cgdmId");
    expect(multi).not.toContain("cfg.ordMobile");
  });

  it("consumes the two admin RPCs and honors need_phone/need_store (nulls for skipped halves)", () => {
    expect(multi).toContain("/rest/v1/rpc/admin_parcel_checks_pending");
    expect(multi).toContain("/rest/v1/rpc/admin_parcel_check_verdict");
    expect(multi).toContain("if (row.need_store && emapTabId)");
    expect(multi).toContain("if (row.need_phone && myshipTabId)");
    expect(multi).toContain("let storeStatus = null;");
    expect(multi).toContain("let phoneStatus = null");
  });

  it("MISSING TAB never stamps 'unknown' (audit MEDIUM-2): halves stay null and a no-learning row skips the verdict write", () => {
    // one closed-tab night must not burn the cross-seller queue — 'unknown'
    // may only come from a content-script RESPONSE, never our own tab absence
    expect(multi).not.toContain('storeStatus = "unknown"');
    expect(multi).not.toContain('phoneStatus = "unknown"');
    expect(multi).toContain("if (storeStatus !== null || phoneStatus !== null)");
  });

  it("keeps the shared safety machinery: single-flight + 2s row gap", () => {
    expect(multi).toContain("pcInFlight.has(row.id)");
    expect(multi).toContain("pcInFlight.delete(row.id)");
    expect(multi).toContain("await pcSleep(PC_ROW_GAP_MS)");
  });
});

describe("app wiring pins", () => {
  it("RedesignApp gates the Settings card on allowlist + TW market; GeneralSettings mounts it conditionally", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("parcelCheckAllowed(auth.profile?.email, auth.profile?.role) && !hideParcelScan");
    const gs = readFileSync("src/redesign/screens/GeneralSettings.tsx", "utf8");
    expect(gs).toContain("{parcelCheckOn && <MyshipCheckCard t={t} />}");
  });

  it("ONE save-flow source: Settings card + Parcel Scan gate both render the shared MyshipConfigForm; the flow lives only in MyshipSetup.tsx", () => {
    const shared = readFileSync("src/redesign/components/MyshipSetup.tsx", "utf8");
    // audit MEDIUM-3 pin (moved here with the form): the pre-validation save
    // must CLEAR shop_name/verified_at so a changed GM never keeps the old badge
    expect(shared).toContain("saveMyshipConfig(gmId, ph.trim(), null)");
    const gs = readFileSync("src/redesign/screens/GeneralSettings.tsx", "utf8");
    expect(gs).toContain("<MyshipConfigForm t={t} />");
    expect(gs).not.toContain("validateGm("); // no second copy of the flow
    // HARD GATE wiring: ParcelScan mounts inside the gate, enabled by the same
    // allowlist+market flag as the Settings card
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("<MyshipScanGate t={tApp} enabled={parcelCheckOn}");
    expect(app.indexOf("<MyshipScanGate")).toBeLessThan(app.indexOf("<ParcelScan cur={cur}"));
  });
});
