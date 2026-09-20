// Chrome extension order-list scraper (Part 4) — STRUCTURAL contract tests. The
// extension runs in Chrome (no DOM/vitest harness), so these pin the load-bearing
// invariants of the scraper + background writeback + manifest by reading the source
// (the server.js-structural convention). Reads are cwd-relative (vitest cwd = repo
// root) to avoid node:path/__dirname.
import { describe, it, expect } from "vitest";
// @ts-expect-error node:fs types not in the tests tsconfig (present at runtime)
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
