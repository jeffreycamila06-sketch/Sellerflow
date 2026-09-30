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
      "sanggalanglhea@gmail.com", // Lhey — added 2026-09-28
      "h0kmming@yahoo.com.tw", // added 2026-09-28 (h + zero, not letter O)
      "details2ndserve@gmail.com", // added 2026-09-29
    ]);
    // Still allowlist-only (not public). budgetukay5 remains OFF; ukaydaily1 +
    // sanggalanglhea (Lhey) are ON. Non-allowlisted sellers = byte-unchanged Parcel Scan.
    expect(parcelCheckAllowed("sanggalanglhea@gmail.com", "seller")).toBe(true); // now allowed
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

  it("E-MAP KEEPALIVE cadence (BEHAVIORAL — runs the real pcKeepaliveDue source): fires on the 5-min cadence when idle, NEVER when a pending row needs the store half", () => {
    const m = bg.match(/const PC_KEEPALIVE_MS = ([^;]+);[\s\S]*?function pcKeepaliveDue\(now, lastAt, anyNeedStore\) \{([\s\S]*?)\n\}/);
    expect(m, "pcKeepaliveDue + PC_KEEPALIVE_MS must exist").toBeTruthy();
    const MS = new Function(`return (${m![1]});`)() as number;
    expect(MS).toBe(5 * 60 * 1000);
    const due = new Function("now", "lastAt", "anyNeedStore", `const PC_KEEPALIVE_MS = ${MS};${m![2]}`) as (n: number, l: number, a: boolean) => boolean;
    // idle (no pending store rows): fires once the cadence elapsed, not before
    expect(due(1_700_000_000_000, 0, false)).toBe(true); // first-ever ping: real Date.now() vs lastAt=0 → due
    expect(due(0, 0, false)).toBe(false);                // 0ms elapsed → not due (guards a same-instant double fire)
    expect(due(MS - 1, 0, false)).toBe(false);           // 4m59s since last → not yet
    expect(due(MS, 0, false)).toBe(true);                // exactly 5 min → due
    expect(due(MS * 2 + 10, MS * 2, false)).toBe(false); // 10ms since last → not due
    // pending store rows exist → their own checks keep the session warm → NEVER ping
    expect(due(MS * 10, 0, true)).toBe(false);
    expect(due(0, 0, true)).toBe(false);
  });

  it("E-MAP KEEPALIVE wiring: reuses the existing PC_CHECK_STORE path on store 198002, runs BEFORE the empty-rows return (idle = the point), logs [PC-KEEPALIVE]", () => {
    expect(bg).toContain('const PC_KEEPALIVE_STORE = "198002";');
    expect(bg).toContain('type: "PC_CHECK_STORE", row: { store_id: PC_KEEPALIVE_STORE }');
    expect(bg).toContain("[PC-KEEPALIVE]");
    // 1.14.0: the keepalive runs from pcRunOnce (the tick) — independent of the
    // lane, the SFL token and the pending RPC; the lane only records the idle flag
    // BEFORE its empty-rows return (an empty queue IS the idle case).
    const flag = multi.indexOf("pcEv.lastAnyNeedStore = rows.some((r) => r && r.need_store);");
    const emptyReturn = multi.indexOf("if (!rows.length) return;");
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(emptyReturn);
    const tick = bg.slice(bg.indexOf("async function pcRunOnce"), bg.indexOf("function pcScheduleLoop"));
    expect(tick).toContain("try { await pcEmapKeepalive(); }");
    expect(multi).not.toContain("pcEmapKeepalive(");
  });

  it("NEVER SLEEP: worker tabs pinned autoDiscardable:false on every find (pcHealTab runs each tick → survives extension reload); v1.7 emap auto-reload kept as fallback", () => {
    expect(bg).toContain("chrome.tabs.update(tabId, { autoDiscardable: false }");
    const heal = bg.slice(bg.indexOf("async function pcHealTab"), bg.indexOf("function pcTokenExpired"));
    expect(heal).toContain("pcNoDiscard(tab.id);");
    expect(bg).toContain('"emap-711.js", true)'); // Layer-1 mistake NOT repeated
  });

  it("ACCURATE emap session popup — DISPLAY-ONLY: red only when a reload landed on error.aspx, amber only when no tab; never writes app_settings / never gates the RPC", () => {
    // 1.14.0: evidence-based derive (pcDeriveEmap) — error.aspx → "expired", no tab →
    // "no_tab"; the per-tab keys have ONE writer (pcRefreshTabStatus). Behaviour is
    // driven end-to-end in parcelChecker114.test.ts; these are the shape pins.
    expect(bg).toContain('const error = /\\/(ecmap|mobilemap)\\/error\\.aspx/i.test(url);'); // 1.14.1: both map sections
    expect(bg).toContain('if (!e.present) return "no_tab";');
    expect(bg).toContain('if (e.error) return "expired";');
    expect(bg).toContain("emapDomain"); // which E-Map domain is active (pcsc vs unipcsc)
    expect(bg).not.toContain("admin_set_parcel_emap_health"); // no DB flag, no RPC gate
    // the Admin mirror is display-only: written by the worker, never read by any lane
    expect(bg).toContain("admin_set_parcel_worker_state");
    expect(bg).not.toMatch(/parcel_check_worker_state|worker_state[^)]*\).*(?:return|skip)/);
    const popup = readFileSync("chrome-extension/popup.js", "utf8");
    expect(popup).toContain("(session expired) — re-open via 賣貨便 → 選擇門市");
    expect(popup).toContain("E-Map tab not found");
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
    // 1.14.6: each half runs only when needed AND not in per-row backoff;
    // 1.14.7 (H2): AND only when its tab exists (a missing tab never eats a slot)
    expect(multi).toContain("const doStore = Boolean(row.need_store) && Boolean(emapTabId) && (!bo || now >= bo.storeNextAt);");
    expect(multi).toContain("const doPhone = Boolean(row.need_phone) && Boolean(myshipTabId) && (!bo || now >= bo.phoneNextAt);");
    expect(multi).toContain("if (doStore && emapTabId)");
    expect(multi).toContain("if (doPhone && myshipTabId)");
    expect(multi).toContain("let storeStatus = null;");
    expect(multi).toContain("let phoneStatus = null");
  });

  it("MISSING TAB never stamps 'unknown' (audit MEDIUM-2): halves stay null and a no-learning row skips the verdict write", () => {
    // one closed-tab night must not burn the cross-seller queue — 'unknown'
    // may only come from a content-script RESPONSE, never our own tab absence.
    // 1.14.6: the ONLY store 'unknown' is the give-up after PC_STORE_GIVE_UP real
    // attempts, inside the branch that ran with a live E-Map tab; the phone half never.
    expect(multi.split('storeStatus = "unknown"').length - 1).toBe(1);
    const tabBranch = multi.indexOf("if (doStore && emapTabId)");
    const giveUp = multi.indexOf('storeStatus = "unknown"');
    expect(tabBranch).toBeGreaterThan(-1);
    expect(giveUp).toBeGreaterThan(tabBranch);
    expect(multi.slice(tabBranch, giveUp)).toContain("if (b.storeFails >= PC_STORE_GIVE_UP) {");
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
    // M5: the card shows only to sellers who can actually open Parcel Scan
    expect(app).toContain("parcelCheckOn={parcelCheckOn && parcelAllowed}");
  });

  it("ONE save-flow source: Settings card + Parcel Scan banner both render the shared MyshipConfigForm; the flow lives only in MyshipSetup.tsx", () => {
    const shared = readFileSync("src/redesign/components/MyshipSetup.tsx", "utf8");
    // audit MEDIUM-3 pin (moved here with the form): a save that isn't verified
    // must CLEAR shop_name/verified_at so a changed GM never keeps the old badge;
    // M6: validation runs BEFORE any save
    expect(shared).toContain("saveMyshipConfig(gmId, v.ok ? v.shopName : null)");
    expect(shared.indexOf("await validateGm(gmId)")).toBeLessThan(shared.indexOf("await saveMyshipConfig("));
    const gs = readFileSync("src/redesign/screens/GeneralSettings.tsx", "utf8");
    expect(gs).toContain("<MyshipConfigCard t={t} />"); // Settings-only collapse wrapper (renders the shared form)
    expect(gs).not.toContain("validateGm("); // no second copy of the flow
    // BANNER wiring (H4): ParcelScan mounts inside the gate (render-prop), enabled
    // by the same allowlist+market flag; its checkOn comes FROM the gate
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("<MyshipScanGate t={tApp} enabled={parcelCheckOn}>");
    expect(app).toContain("checkOn={checkOn} banner={banner}");
    expect(app.indexOf("<MyshipScanGate")).toBeLessThan(app.indexOf("<ParcelScan cur={cur}"));
  });
});
