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
  it("flip is OFF; the allowlisted emails + admins pass; everyone else fails", () => {
    expect(PARCEL_CHECK_PUBLIC).toBe(false);
    expect(PARCEL_CHECK_PREVIEW_EMAILS).toEqual([
      "googletest@gmail.com", "googletest@sellerflowlive.com",
      "ukaydaily1@gmail.com", // added to dogfood 2026-09-27
    ]);
    // Still allowlist-only (not public). sanggalanglhea + budgetukay5 remain OFF;
    // ukaydaily1 is now ON. Non-allowlisted sellers = byte-unchanged Parcel Scan.
    expect(parcelCheckAllowed("sanggalanglhea@gmail.com", "seller")).toBe(false);
    expect(parcelCheckAllowed("budgetukay5@gmail.com", "seller")).toBe(false);
    expect(parcelCheckAllowed("ukaydaily1@gmail.com", "seller")).toBe(true); // now allowed
    expect(parcelCheckAllowed("UKAYDAILY1@GMAIL.COM", "seller")).toBe(true); // case-insensitive
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
    expect(sql.match(/if not public\.is_admin\(\) then/g)?.length).toBe(5); // pending, verdict, stats, config, set-health
  });
  it("ATTRIBUTION: the pending select INNER JOINs each seller's OWN config; GM-only eligibility (phone no longer required)", () => {
    expect(sql).toContain("join seller_myship_config cfg");
    expect(sql).toContain("cfg.user_id = ps.user_id");
    expect(sql).toContain("coalesce(cfg.gm_id, '') <> ''");
    expect(sql).not.toContain("coalesce(cfg.ord_mobile, '') <> ''"); // phone is optional now
  });
  it("SENDER: one admin CHECK_SENDER_PHONE returned for every row; lane pauses when the sender is unhealthy", () => {
    expect(sql).toContain("v_sender as sender_phone");              // fixed sender returned per row
    expect(sql).toContain("parcel_check_sender_phone");
    expect(sql).toContain("parcel_check_sender_healthy");
    expect(sql).toContain("if coalesce(v_healthy, 'true') <> 'true' then"); // health gate → pause
    expect(sql).toContain("if coalesce(v_sender, '') = '' then"); // blank sender → pause too (audit MEDIUM), never ordMobile:null
    // config + health-setter RPCs exist for the health-check loop
    expect(sql).toContain("function public.admin_parcel_check_config()");
    expect(sql).toContain("function public.admin_set_parcel_sender_health(p_ok boolean)");
  });
  it("FAIRNESS: round-robin rank per seller by AGE, rank-first ordering", () => {
    expect(sql).toContain("row_number() over (partition by ps.user_id order by ps.created_at asc) as seller_rank");
    expect(sql).toContain("order by p.seller_rank asc, p.created_at asc");
  });
  it("kill switch: pending returns empty unless app_settings says 'true'", () => {
    expect(sql).toContain("parcel_check_multi_enabled");
    expect(sql).toContain("coalesce(v_enabled, 'false') <> 'true'");
  });
  it("cache: unknown never cached; restricted honors restricted_until; ok TTL = tunable 4h constant; cache table client-locked", () => {
    expect(sql).toContain("check (status in ('ok','restricted'))"); // 'unknown' can't even be stored
    expect(sql).toContain("if p_phone_check_status in ('ok','restricted') then");
    expect(sql).toContain("c.restricted_until >= (now() at time zone 'Asia/Taipei')::date");
    expect(sql).toContain("v_ok_ttl constant interval := interval '4 hours';"); // tunable short TTL
    expect(sql).toContain("c.checked_at > now() - v_ok_ttl");
    expect(sql).not.toContain("interval '7 days'"); // the old TTL is gone
    expect(sql).toContain("revoke all on public.phone_check_cache from anon, authenticated;");
  });

  it("pending RPC returns created_at (for encode→verdict latency logging)", () => {
    expect(sql).toContain("queue_depth bigint, created_at timestamptz");
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

  it("ATTRIBUTION HARD RULE: shop = row owner's OWN GM; sender = the fixed CHECK_SENDER_PHONE (row.sender_phone), NEVER a per-seller or popup phone", () => {
    expect(multi).toContain("config: { cgdmId: row.gm_id, ordMobile: row.sender_phone }");
    expect(multi).not.toContain("cfg.cgdmId");
    expect(multi).not.toContain("cfg.ordMobile");
    expect(multi).not.toContain("ordMobile: row.ord_mobile"); // the per-seller phone must NOT be the sender
  });

  it("SENDER HEALTH-CHECK: a known-clean probe buyer through the sender; restricted → pause (set health false), never mass-flag", () => {
    expect(bg).toContain("async function pcSenderHealthCheck");
    expect(bg).toContain("/rest/v1/rpc/admin_parcel_check_config");
    expect(bg).toContain("/rest/v1/rpc/admin_set_parcel_sender_health");
    // restricted probe → health false (pause); ok while unhealthy → recover
    expect(bg).toContain('if (st === "restricted") {');
    expect(bg).toContain("setHealth(false)");
    expect(bg).toContain("setHealth(true)");
    expect(bg).toContain("ordMobile: conf.sender_phone"); // probe uses the sender as ordMobile
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

  it("ANONYMOUS phone check (the core fix): the multi lane sends anon:true so the body ordMobile is authoritative (login irrelevant)", () => {
    expect(multi).toContain("type: \"PC_CHECK_PHONE\", row, anon: true,");
    // and the content script honors it end-to-end: omit credentials for BOTH
    // the per-GM token GET and the CheckoutValidation POST
    const ms = readFileSync("chrome-extension/myship-711.js", "utf8");
    expect(ms).toContain("checkRestricted(message.row, message.config || {}, message.anon === true)");
    expect(ms).toContain("const creds = anon ? \"omit\" : \"include\";");
    expect(ms).toContain("}, \"omit\");"); // anon token GET
    // legacy path stays credentialed (byte-unchanged): the parametrized default
    expect(ms).toContain("credentials: creds || \"include\"");
  });

  it("KILLS THE TWO-LANE RACE: legacy pcPoll returns before its row loop in multi mode (popup config never processes rows)", () => {
    const legacy = bg.slice(bg.indexOf("async function pcPoll("), bg.indexOf("async function pcPollMulti"));
    expect(legacy).toContain("if (cfg.multiSeller) {");
    // the early return sits BEFORE the legacy row fetch
    expect(legacy.indexOf("if (cfg.multiSeller) {")).toBeLessThan(legacy.indexOf("pcFetchUnchecked(cfg, token)"));
  });

  it("latency logging: encode→verdict + anon token/POST costs", () => {
    expect(multi).toContain("[PC-LAT]");
    expect(multi).toContain("row.created_at");
  });

  it("DEFINITIVE-ONLY writes (audit M1): a transient 'unknown' is NOT stamped — only ok/restricted (phone) and open/full (store) are written, so a hiccup can't permanently un-check a restricted buyer", () => {
    expect(multi).toContain('pResp.phone_check_status === "ok" || pResp.phone_check_status === "restricted"');
    expect(multi).toContain('sResp.store_full_status === "open" || sResp.store_full_status === "full"');
    // the old unconditional "any string" accept is gone
    expect(multi).not.toContain('typeof pResp.phone_check_status === "string"');
    expect(multi).not.toContain('typeof sResp.store_full_status === "string"');
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
    expect(shared).toContain("saveMyshipConfig(gmId, null)"); // GM-only save (no per-seller phone)
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
