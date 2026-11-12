// sql/140 contract (read from the file; chat-Claude applies it): the four nullable columns with
// the platform check, both phonebook triggers carrying contact_platform (replaced with the
// handle; a blank handle keeps the old one), the trigger column lists, the switch seeded OFF,
// 'buyer_contact' in my_feature_access() with the rebuild-from-live note, the FAQ seed, and a
// rollback that restores sql/36 + sql/121 byte-for-byte. Plus the docs the plan asks for.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const up = read("sql/140_buyer_contact.sql");
const down = read("sql/140_buyer_contact_rollback.sql");
const CHECK = "check (contact_platform is null or contact_platform in ('tiktok','line','whatsapp','facebook','instagram','other'))";

describe("sql/140", () => {
  it("adds the nullable column with the same check to the four parcel tables", () => {
    for (const t of ["parcel_scans", "parcel_customers", "fm_parcel_scans", "fm_parcel_customers"]) {
      expect(up).toMatch(new RegExp(`alter table public\\.${t}\\s+add column if not exists contact_platform text ${CHECK.replace(/[()]/g, "\\$&")}`));
    }
  });
  it("7-11 trigger: platform rides with the handle, blank handle keeps both; trigger list += contact_platform", () => {
    expect(up).toContain("case when v_notes is null then null else new.contact_platform end,");
    expect(up).toContain("contact_platform = case when excluded.notes is null then parcel_customers.contact_platform else excluded.contact_platform end,");
    expect(up).toContain("notes            = coalesce(excluded.notes,    parcel_customers.notes),");
    expect(up).toContain("after insert or update of customer_name, phone, store_id, notes, contact_platform, store_check_status, phone_check_status\n  on public.parcel_scans");
    expect(up).toContain("if new.phone_check_status = 'restricted' then");                  // rules 1 + 2 kept (sql/36)
    expect(up).toContain("and new.store_check_status not in ('valid', 'unchecked', 'unknown') then");
  });
  it("FamilyMart trigger: same rules on buyer_username; function stays unexecutable by browser roles", () => {
    expect(up).toContain("case when v_user is null then null else new.contact_platform end,");
    expect(up).toContain("contact_platform = case when excluded.buyer_username is null then fm_parcel_customers.contact_platform else excluded.contact_platform end,");
    expect(up).toContain("revoke all on function public.upsert_fm_parcel_customer() from public, anon, authenticated;");
    expect(up).toContain("after insert or update of recipient_name, phone, store_id, buyer_username, contact_platform\n  on public.fm_parcel_scans");
  });
  it("switch seeded OFF; my_feature_access gains 'buyer_contact' (every sql/137 key kept) with the rebuild-from-live note; FAQ in 8 languages", () => {
    expect(up).toContain("insert into public.app_settings (key, value) values ('buyer_contact_enabled', 'false')\non conflict (key) do nothing;");
    const keys137 = read("sql/137_fb_post_sales.sql").match(/values \('fb_preview'\)[^\n]*/)![0];
    expect(up).toContain(`${keys137}, ('buyer_contact')`);
    expect(up).toMatch(/pg_get_functiondef\('public\.my_feature_access'::regproc\)/);
    expect(up).toContain("'tiktok_api' if sql/138 is applied");
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) expect((up.match(new RegExp(`\\n  \\('${l}', '`, "g")) || []).length).toBe(2);
    expect(up).toContain("array['parcel-scan','pickup-status'], false, null"); // FAQ seeded DISABLED
    expect(up).not.toMatch(/array\[.parcel-scan.,.pickup-status.\],\s+true/);
    expect(up).toContain("enable them +\n-- apply sql/116b (the guide) in the same step"); // enabled when the switch flips, not at merge
    expect(up).not.toMatch(/contact_platform.*trigger.*internal|RLS|jsonb_object_agg.*\n.*buyer_contact.*secret/);
  });
  it("col J, the export row builders and the extension are not touched by the SQL (no writes to notes / buyer_username)", () => {
    expect(up).not.toMatch(/update public\.parcel_scans set/);
    expect(up).not.toMatch(/update public\.fm_parcel_scans set/);
    expect(up).not.toContain("parcel_tracking");
  });
});

describe("sql/140 rollback", () => {
  it("restores the sql/36 and sql/121 function bodies and trigger lists, drops the four columns, deletes the switch, removes the key", () => {
    const f36 = read("sql/36_parcel_customers_filters.sql");
    const body36 = f36.slice(f36.indexOf("create or replace function public.upsert_parcel_customer()"), f36.indexOf("$function$;") + "$function$;".length);
    expect(down).toContain(body36);
    const f121 = read("sql/121_fm_parcel_customers.sql");
    const body121 = f121.slice(f121.indexOf("declare\n  v_phone text := trim(coalesce(new.phone, ''));\nbegin"), f121.indexOf("$function$;\nrevoke all on function public.upsert_fm_parcel_customer()"));
    expect(down).toContain(body121);
    expect(down).toContain("after insert or update of customer_name, phone, store_id, notes, store_check_status, phone_check_status\n  on public.parcel_scans");
    expect(down).toContain("after insert or update of recipient_name, phone, store_id, buyer_username\n  on public.fm_parcel_scans");
    for (const t of ["parcel_scans", "parcel_customers", "fm_parcel_scans", "fm_parcel_customers"]) expect(down).toMatch(new RegExp(`alter table public\\.${t}\\s+drop column if exists contact_platform;`));
    expect(down).toContain("delete from public.app_settings where key = 'buyer_contact_enabled';");
    expect(down).toMatch(/^-- ⚠️ REVERT THE WEB DEPLOY FIRST, then run this/);
    const questions = [...up.matchAll(/\n {2}\('(?:en|fil|zh|zh-TW|vi|th|id|bg)', '((?:[^']|'')+)', '/g)].map((m) => m[1]);
    expect(questions).toHaveLength(16);
    // only the seed's shape (sections + not from a chat): a separate approved row with the same question survives
    expect(down).toContain("delete from public.support_faq where guide_sections = array['parcel-scan','pickup-status']::text[] and from_chat_id is null and question in (");
    for (const q of questions) expect(down).toContain(`  '${q}'`); // every seeded FAQ row removed by its exact question
    // pre-apply check in the header: a select of the 16 questions that must return 0 rows
    const header = up.slice(0, up.indexOf("\nbegin;"));
    expect(header).toContain("PRE-APPLY CHECK — must return 0 rows");
    expect(header).toContain("--   select lang, question, enabled from public.support_faq where question in (");
    for (const q of questions) expect(header).toContain(`'${q}'`);
    expect(down).not.toContain("('buyer_contact')");
    expect(down).toContain("('fb_post_sales')");
  });
});

describe("the docs the plan asks for", () => {
  it("tiktok-api plan carries the 138/139 note; privacy lists the buyer contact; guide sections bumped and the seed is in sync", () => {
    expect(read("docs/plans/tiktok-api.md")).toContain("keeping every key the live function has — `'buyer_contact'` included");
    expect(read("public/privacy/index.html")).toContain("including a buyer contact (phone number or messaging ID) you record for a parcel");
    const guide = read("docs/support/sfl-guide.md");
    expect(guide).toContain("## parcel-scan — Parcel Scan (7-11) and Customer Details\nLast checked: 2026-11-12");
    expect(guide).toContain("## pickup-status — Pickup Status\nLast checked: 2026-11-12");
    expect(guide).toContain("**Buyer contact** (Plus / Pro / Master)");
    expect(guide).not.toMatch(/contact_platform|sql\/140|RLS|trigger/);           // user-level words only
    expect(read("sql/116b_guide_seed.sql")).toContain("Buyer contact");
  });
});
