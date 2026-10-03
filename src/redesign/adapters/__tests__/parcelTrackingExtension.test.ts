// Chrome extension order-list scraper (Part 4) — STRUCTURAL contract tests. The
// extension runs in Chrome (no DOM/vitest harness), so these pin the load-bearing
// invariants of the scraper + background writeback + manifest by reading the source
// (the server.js-structural convention). Reads are cwd-relative (vitest cwd = repo
// root) to avoid node:path/__dirname.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const scraper = readFileSync("chrome-extension/myship-order-711.js", "utf8");
const background = readFileSync("chrome-extension/background.js", "utf8");
const manifest = JSON.parse(readFileSync("chrome-extension/manifest.json", "utf8"));

describe("manifest — order-list content script registered without collision", () => {
  it("registers myship-order-711.js scoped to /seller/order*", () => {
    const entry = manifest.content_scripts.find((c: { js: string[] }) => c.js.includes("myship-order-711.js"));
    expect(entry).toBeTruthy();
    expect(entry.matches).toEqual(["https://myship.7-11.com.tw/seller/order*"]);
    expect(entry.run_at).toBe("document_idle");
  });
  it("the phone-check + emap scripts still have their own entries (no merge/collision)", () => {
    const js = manifest.content_scripts.flatMap((c: { js: string[] }) => c.js);
    expect(js).toContain("myship-711.js");
    expect(js).toContain("emap-711.js");
    expect(js).toContain("sellerflow-bridge.js");
  });
});

describe("scraper — parcel code + row shape", () => {
  it("parses codes of length 8/11/12, requiring a letter AND a digit — NEVER assumes an F prefix", () => {
    expect(scraper).toContain("NEVER assume an F prefix");
    expect(scraper).toMatch(/\[A-Za-z0-9\]\{8,12\}/);          // candidate token pattern
    expect(scraper).toMatch(/length === 8 \|\| tok\.length === 11 \|\| tok\.length === 12/);
    expect(scraper).toMatch(/\/\[A-Za-z\]\/\.test\(tok\)/);    // must contain a letter
    expect(scraper).toMatch(/\/\\d\/\.test\(tok\)/);           // must contain a digit
    // regression pin: no hard-coded F-prefix gate
    expect(scraper).not.toMatch(/startsWith\(["']F["']\)/);
    expect(scraper).not.toMatch(/\/\^F/);
  });
  it("sends PC_ORDER_ROWS and its rows carry ONLY the scraper's columns (no status/ship_type)", () => {
    expect(scraper).toContain('type: "PC_ORDER_ROWS"');
    // the pushed row object
    expect(scraper).toMatch(/tracking_no,\s*[\s\S]*cm_order_no:[\s\S]*recipient_name:[\s\S]*store_id:[\s\S]*order_amount:/);
    expect(scraper).not.toContain("status:");
    expect(scraper).not.toContain("ship_type");
    expect(scraper).not.toContain("special_type");
  });
  it("Layer B REMOVED — the on-screen scraper no longer captures a handle (export reader is the sole source)", () => {
    // the masked /seller/order list is not a handle source; buyer_username is written ONLY by
    // the 匯出報表 export reader (myship-export-711.js). Pin the removal so it can't creep back.
    expect(scraper).not.toMatch(/buyer_username\s*:/);   // no handle FIELD pushed onto the row
    expect(scraper).not.toContain("map.handle");         // no handle column mapped
    expect(scraper).not.toMatch(/其[他它]資訊/);           // no handle HEADER matcher
  });
  it("is fail-safe: guards the page + skips rows with no parcel code", () => {
    expect(scraper).toMatch(/\/\\\/seller\\\/order\/i\.test\(location\.pathname\)/);
    expect(scraper).toContain("if (!tracking_no) continue");
  });
});

describe("background — token path + parcel_tracking upsert", () => {
  it("handles PC_ORDER_ROWS via the SAME single-refresher token bridge (SFL tab → pcGetToken)", () => {
    const i = background.indexOf('"PC_ORDER_ROWS"');
    expect(i).toBeGreaterThan(-1);
    const handler = background.slice(i, i + 700);
    expect(handler).toContain("pcGetToken(sflTabId)");   // reuse the existing bridge (sf_supabase_auth), not a new refresher
    expect(handler).toContain("pcUpsertTracking");
  });
  it("decodes the user id from the JWT sub claim (RLS needs user_id in the row)", () => {
    expect(background).toMatch(/pcUserIdFromToken/);
    expect(background).toMatch(/json\.sub/);
  });
  it("upserts on (user_id, tracking_no) with merge-duplicates, sending ONLY the scraper's columns", () => {
    expect(background).toContain("on_conflict=user_id,tracking_no");
    expect(background).toContain("resolution=merge-duplicates");
    const i = background.indexOf("pcUpsertTracking");
    const fn = background.slice(i, i + 900);
    for (const col of ["user_id", "tracking_no", "cm_order_no", "recipient_name", "store_id", "order_amount"]) {
      expect(fn).toContain(col);
    }
    // the poller's columns must NEVER be a key in the scraper writeback (would clobber
    // on re-scrape). "status:" = a column key (r.status is the HTTP status, allowed).
    expect(fn).not.toContain("status:");
    expect(fn).not.toContain("ship_type");
    expect(fn).not.toContain("special_type");
  });
});

describe("E-Map domain move (2026-09-27) — both domains matched everywhere", () => {
  const bg = readFileSync("chrome-extension/background.js", "utf8");
  const emapScript = manifest.content_scripts.find((c: { js: string[] }) => c.js.includes("emap-711.js"));

  it("manifest: host_permissions + emap-711 matches carry BOTH pcsc and unipcsc", () => {
    // version pinned by the self-heal suite below (bumped 1.6.0 → 1.7.0)
    for (const host of ["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"]) {
      expect(manifest.host_permissions, host).toContain(host);
      expect(emapScript.matches, host).toContain(host);
    }
  });

  it("background pcFindTab queries BOTH domains (the 'Tab not open' fix)", () => {
    // v1.7.0: the emap tab is found through pcHealTab (health + auto-recover),
    // same both-domain patterns:
    expect(bg).toContain('pcHealTab(["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"]');
  });

  it("emap-711 stays origin-relative (no hardcoded emap host in any fetch); 1.14.1 = per-section endpoint (/mobilemap/ or /ecmap/ byIDData), never a page-context script", () => {
    const emap = readFileSync("chrome-extension/emap-711.js", "utf8");
    expect(emap).toContain("return [`/${own}/byIDData.aspx`, `/${other}/byIDData.aspx`];");
    expect(emap).toContain("fetchWithTimeout(`${endpoint}?rnd=${Math.random()}`");
    // the ONLY host mentions are the doc comment — no fetch targets a hardcoded emap origin
    expect(emap).not.toMatch(/fetch[^\n]*https:\/\/emap/);
    // CSP-safe: no inline <script> injection anywhere in the isolated script
    expect(emap).not.toMatch(/createElement\(\s*["']script["']\s*\)/);
    expect(emap).not.toContain("textContent = `(function");
  });

  it("manifest 1.14.1: the MAIN-world guid helper is registered on BOTH emap domains, before the isolated script, and /mobilemap/ is covered by the wildcard matches", () => {
    const main = manifest.content_scripts.find((c: { js: string[] }) => c.js.includes("emap-guid-main.js"));
    expect(main).toBeTruthy();
    expect(main.world).toBe("MAIN");
    for (const host of ["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"]) expect(main.matches, host).toContain(host);
    const idx = (js: string) => manifest.content_scripts.findIndex((c: { js: string[] }) => c.js.includes(js));
    expect(idx("emap-guid-main.js")).toBeLessThan(idx("emap-711.js"));
    // "https://emap.unipcsc.com.tw/*" matches https://emap.unipcsc.com.tw/mobilemap/default.aspx (Chrome match-pattern semantics)
    expect(emapScript.matches.some((m: string) => new RegExp("^" + m.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$").test("https://emap.unipcsc.com.tw/mobilemap/default.aspx"))).toBe(true);
  });
});

describe("self-heal v1.7.0 — statuses recover without manual tab refreshes", () => {
  const bg = readFileSync("chrome-extension/background.js", "utf8");

  it("manifest 1.7.0 + the scripting permission (re-injection needs it)", () => {
    expect(manifest.version).toBe("1.15.0"); // 1.15.0 = two-machine failover (lease, sql/71); 1.14.9 = faster phone retry on token-GET timeouts; 1.14.8 = E-Map "close" → company, "NO2" → not_found (1.14.7 = Oct 1 blockers)
    expect(manifest.permissions).toContain("scripting");
  });

  it("all 3 content scripts answer PC_PING and carry a double-injection guard", () => {
    for (const [f, guard] of [
      ["chrome-extension/sellerflow-bridge.js", "__sflPcBridgeInjected"],
      ["chrome-extension/myship-711.js", "__sflPcMyshipInjected"],
      ["chrome-extension/emap-711.js", "__sflPcEmapInjected"],
    ] as const) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain('message?.type === "PC_PING"');
      expect(src, f).toContain(`if (window.${guard}) return;`);
    }
  });

  it("health runs EVERY poll: myship/emap health recorded BEFORE the no-rows early return (1.14.0: as evidence for the single status writer)", () => {
    const healthAt = bg.indexOf("pcEv.health = { myship: myshipHealth, emap: emapHealth };");
    const rowsAt = bg.indexOf("const rows = res.rows.filter");
    expect(healthAt).toBeGreaterThan(-1);
    expect(healthAt).toBeLessThan(rowsAt); // the old hours-stale-badges bug stays dead
  });

  it("the SFL tab is NEVER auto-reloaded (live-session safety), myship/emap are", () => {
    expect(bg).toContain('"sellerflow-bridge.js", false');                       // allowReload=false
    expect(bg).toContain('pcHealTab(["https://myship.7-11.com.tw/*"], "myship-711.js", true)');
    expect(bg).toContain('"emap-711.js", true)');
    // exactly ONE reload site (pcHealTab, behind the allowReload gate, discarded tabs
    // only). The 1.14.2 emap session recovery is a GET re-navigation (tabs.update
    // {url}) — tabs.reload on the POST-opened E-Map tab pops Chrome's "Confirm Form
    // Resubmission" modal, which no unattended worker can dismiss.
    const heal = bg.slice(bg.indexOf("async function pcHealTab"), bg.indexOf("function pcTokenExpired"));
    expect(heal).toContain('if (!allowReload) return { state: "asleep"');
    expect((bg.match(/chrome\.tabs\.reload\(/g) || []).length).toBe(1);
    expect(heal).toContain("chrome.tabs.reload(");
    const recover = bg.slice(bg.indexOf("async function pcRefreshTabStatus"), bg.indexOf("async function pcPushWorkerState"));
    expect(recover).not.toContain("chrome.tabs.reload(");
    expect(recover).toContain("chrome.tabs.update(e.tabId, { url: e.url })");
    expect(bg).toContain('const PC_EMAP_PATTERNS = ["https://emap.pcsc.com.tw/*", "https://emap.unipcsc.com.tw/*"];');
    expect(bg).toContain("chrome.tabs.query({ url: PC_EMAP_PATTERNS }");
  });

  it("stale-token detection is local (JWT exp) and the extension still NEVER refreshes the session itself", () => {
    expect(bg).toContain("function pcTokenExpired(");
    expect(bg).not.toMatch(/refresh_token|token\/refresh|auth\/v1\/token/); // two-refreshers bug must not return
  });

  it("popup: every non-green state names the ONE action (no bare red)", () => {
    const popup = readFileSync("chrome-extension/popup.js", "utf8");
    for (const label of ["SellerFlowLive: signed out — log in once", "Tab asleep — click it once", "Waking up…", "Reload that tab"]) {
      expect(popup).toContain(label);
    }
  });
});
