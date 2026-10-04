// Privacy Policy / Data Deletion pages + sql/65 retention (Sep 29, 2026). The pages are
// static files served at /privacy/ and /data-deletion/ (Meta stores both URLs), and the
// retention numbers they state must match what the database actually does.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const privacy = readFileSync("public/privacy/index.html", "utf8");
const deletion = readFileSync("public/data-deletion/index.html", "utf8");
const account = readFileSync("public/delete-account/index.html", "utf8");
const sql = readFileSync("sql/65_privacy_retention_purge.sql", "utf8");

describe("public privacy pages", () => {
  it("stay at the paths Meta has on file", () => {
    expect(existsSync("public/privacy/index.html")).toBe(true);
    expect(existsSync("public/data-deletion/index.html")).toBe(true);
    expect(privacy).toContain('href="/data-deletion/"');
    expect(deletion).toContain('href="/privacy/"');
  });

  it("privacy policy keeps the Meta sentences, operator and contact", () => {
    expect(privacy).toContain("Data from Facebook is the list of Pages you manage and the comments on your Page's live video, including each commenter's public name and profile ID. It is used only to show those comments in your dashboard and create orders. It is never sold or used for advertising.");
    expect(privacy).toContain("Meta Platform Terms</a>. You can remove our access in Facebook Settings &rarr; Apps and Websites.");
    expect(privacy).toContain("We do not sell your data.");
    expect(privacy).toContain("SELLERFLOWLIVE PRINTER TRADING &middot; <a href=\"mailto:jeffreycamila06@gmail.com\">");
  });

  it("states the retention the database enforces", () => {
    expect(privacy).toContain("Live comments: 10 days. Order history: 3 months. Parcel status: 7 days after pickup, 365 days after return. Your account, customer list and settings: until you delete your account, which you can do anytime in the app.");
  });

  it("data deletion keeps the seller + Facebook-user steps and the 30-day promise, without the backups line", () => {
    expect(deletion).toContain("Tap <strong>Delete Account</strong> and confirm.");
    expect(deletion).toContain("Facebook Settings &rarr; Apps and Websites &rarr; remove SellerFlowLive.");
    expect(deletion.match(/"Data Deletion Request"/g)?.length).toBe(2);
    expect(deletion).toContain("within <strong>30 days</strong>");
    expect(deletion).not.toMatch(/backup/i);
    expect(deletion + privacy).not.toContain("privacy@sellerflowlive");
  });
});

describe("/delete-account/ (Google Play account deletion URL)", () => {
  it("is a real page (no redirect) at the same path, linking the other two", () => {
    expect(existsSync("public/delete-account/index.html")).toBe(true);
    expect(account).not.toMatch(/http-equiv="refresh"|location\.(href|replace)/i);
    expect(account).toContain('href="/privacy/"');
    expect(account).toContain('href="/data-deletion/"');
  });
  it("names the app and the developer, and has no phone number", () => {
    expect(account).toContain("<strong>SellerFlowLive</strong>");
    expect(account).toContain("Developer: SELLERFLOWLIVE PRINTER TRADING");
    expect(account).not.toMatch(/09\d{8}|phone/i);
    expect(account).not.toMatch(/Profile menu|90 days/);
  });
  it("shows both deletion routes and what is deleted / kept", () => {
    expect(account).toContain("Tap <strong>Delete Account</strong> and confirm.");
    expect(account).toContain("(deleted immediately)");
    expect(account).toContain('subject <strong>"Delete my account"</strong>');
    expect(account).toContain("within <strong>30 days</strong>");
    expect(account).toContain("your account, orders, customers, products, shipping and parcel data, and your connected-platform access.");
    expect(account).toContain("We keep only a record that the deletion happened (your email and the date)");
  });
});

describe("sql/65 privacy retention purge", () => {
  it("orders after 3 months, parcel scans 90 days after export / 180 days as drafts, parcel status 7 / 365 days", () => {
    expect(sql).toContain("where created_at < now() - interval '3 months'");
    expect(sql).toContain("(exported_at is not null and exported_at < now() - interval '90 days')");
    expect(sql).toContain("(exported_at is null and created_at < now() - interval '180 days')");
    expect(sql).toContain("(status = 'picked_up' and coalesce(picked_up_at, updated_at) < now() - interval '7 days')");
    expect(sql).toContain("(status = 'returned'  and coalesce(returned_at,  updated_at) < now() - interval '365 days')");
  });

  it("deletes in batches, is never callable by app users, and runs daily", () => {
    expect(sql.match(/limit p_batch\);/g)?.length).toBe(3);
    expect(sql.match(/exit when n < p_batch;/g)?.length).toBe(3);
    expect(sql).toContain("revoke all on function public.privacy_retention_purge(integer) from public, anon, authenticated;");
    expect(sql).toMatch(/cron\.schedule\(\s*'privacy-retention-purge',\s*'10 17 \* \* \*',\s*\$\$select public\.privacy_retention_purge\(\)\$\$/);
  });

  it("never touches the tables kept while the account is active", () => {
    for (const t of ["customers", "parcel_customers", "products", "live_session_orders", "seller_profiles"]) {
      expect(sql).not.toMatch(new RegExp(`delete from public\\.${t}\\b`));
    }
  });
});
