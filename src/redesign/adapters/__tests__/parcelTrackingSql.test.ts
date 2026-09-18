// sql/37 parcel_tracking contracts — the sql/ file is the canonical text applied
// to prod via MCP; these pin the load-bearing invariants so a future edit can't
// silently regress them:
//   1. own-scoped RLS (4 policies, all user_id = auth.uid()),
//   2. UNIQUE (user_id, tracking_no) — idempotent re-paste/re-scrape,
//   3. the link trigger is SECURITY INVOKER (never DEFINER — no RLS-bypass
//      surface) with a pinned search_path,
//   4. the buyer-username link matches on recipient_name + store_id +
//      order_amount AND filters by an EXPLICIT se.user_id = new.user_id (the
//      Miners lesson — never rely on RLS inside a trigger the poller also fires).
//      ⚠️ SUPERSEDED by sql/39: the LIVE trigger drops store_id (the myship
//      order-list has only the store NAME) and adds a 14-day recency window +
//      the strict single-match ambiguity rule. The sql/37 assertions below still
//      validate the sql/37 FILE (its historical mirror); the "sql/39" describe
//      block pins the current live invariants.
//   5. cm_order_no is metadata only — it is NEVER a join predicate to
//      shipping_entries,
//   6. status enum carries the 7 states; terminal defaults false.
import { describe, it, expect } from "vitest";
// tsconfig.app excludes @types/node from the tests; these modules + __dirname are
// provided by vitest at runtime. Suppress the missing-type errors so this
// file-reading contract test stays at the typecheck baseline (same idiom the
// other SQL contract tests would otherwise add node:fs/__dirname errors for).
// @ts-expect-error node:fs types not in the tests tsconfig (present at runtime)
import { readFileSync } from "node:fs";
// @ts-expect-error node:path types not in the tests tsconfig (present at runtime)
import { resolve } from "node:path";
declare const __dirname: string;

const sql = readFileSync(resolve(__dirname, "../../../../sql", "37_parcel_tracking.sql"), "utf8");
const lower = sql.toLowerCase();
// The shipping_entries lookup block (from the select to its limit 1).
const linkBlock = (lower.match(/from public\.shipping_entries[\s\S]*?limit 1/) || [""])[0];

describe("sql/37 parcel_tracking", () => {
  it("own-scoped RLS: exactly 4 policies, all user_id = auth.uid()", () => {
    for (const p of ["parcel_tracking_select", "parcel_tracking_insert", "parcel_tracking_update", "parcel_tracking_delete"]) {
      expect(lower).toContain(`create policy ${p} on public.parcel_tracking`);
    }
    expect(lower).toContain("enable row level security");
    // one using/with-check per policy → at least 4 own-scoped guards
    expect((lower.match(/user_id = auth\.uid\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("UNIQUE (user_id, tracking_no) — idempotent re-paste/re-scrape", () => {
    expect(lower).toContain("unique (user_id, tracking_no)");
  });

  it("link trigger is SECURITY INVOKER, never DEFINER, with a pinned search_path", () => {
    expect(lower).toContain("security invoker");
    expect(lower).not.toContain("security definer");
    expect(lower).toContain("set search_path to 'public'");
  });

  it("[original, superseded by sql/39] link matches recipient_name + store_id + order_amount, filtered by explicit se.user_id = new.user_id", () => {
    expect(linkBlock).toContain("se.user_id = new.user_id");         // explicit own-scope (Miners lesson)
    expect(linkBlock).toContain("se.store_id = new.store_id");
    expect(linkBlock).toContain("se.order_amount = new.order_amount");
    expect(linkBlock).toMatch(/lower\(trim\(coalesce\(se\.recipient_name/);
    expect(linkBlock).toContain("limit 1");                          // deterministic on a tie
  });

  it("cm_order_no is metadata only — never a join predicate to shipping_entries", () => {
    expect(linkBlock).not.toContain("cm_order_no");
  });

  it("FKs: user_id cascades, shipping_entry_id sets null on delete", () => {
    expect(lower).toContain("references auth.users(id) on delete cascade");
    expect(lower).toContain("references public.shipping_entries(id) on delete set null");
  });

  it("status enum carries the 7 states; terminal defaults false", () => {
    for (const s of ["created", "in_transit", "at_store", "picked_up", "returned", "not_found", "unknown"]) {
      expect(linkBlock.includes(s) || lower.includes(`'${s}'`)).toBe(true);
    }
    expect(lower).toContain("terminal          boolean not null default false");
  });

  it("BEFORE insert-or-update trigger wired to the link function", () => {
    expect(lower).toContain("before insert or update on public.parcel_tracking");
    expect(lower).toContain("execute function public.link_parcel_tracking()");
  });
});

describe("sql/39 parcel_tracking link (relaxed + STRICT ambiguity)", () => {
  const sql39 = readFileSync(resolve(__dirname, "../../../../sql", "39_parcel_tracking_link.sql"), "utf8");
  const l39 = sql39.toLowerCase();
  // The relaxed lookup: the first shipping_entries scan (name + amount + window).
  const block39 = (l39.match(/from public\.shipping_entries[\s\S]*?14 days'/) || [""])[0];

  it("adds the optional recipient_phone tie-breaker column (additive, if-not-exists)", () => {
    expect(l39).toContain("add column if not exists recipient_phone");
  });

  it("stays SECURITY INVOKER (never DEFINER) with a pinned search_path", () => {
    expect(l39).toContain("security invoker");
    expect(l39).not.toContain("security definer");
    expect(l39).toContain("set search_path to 'public'");
  });

  it("match key = recipient_name + order_amount + 14-day recency, own-scoped — NO store_id", () => {
    expect(block39).toContain("se.user_id = new.user_id");              // explicit own-scope (Miners lesson)
    expect(block39).toContain("se.order_amount = new.order_amount");
    expect(block39).toMatch(/lower\(trim\(coalesce\(se\.recipient_name/);
    expect(block39).toContain("se.created_at >= now() - interval '14 days'");
    // store_id is dropped from the match key (order-list has only the store NAME)
    expect(block39).not.toContain("se.store_id");
  });

  it("STRICT ambiguity: links only on exactly one match; 0 or 2+ leave both NULL", () => {
    expect(l39).toContain("if v_count = 1 then");                       // exactly one → link
    // 2+ only reachable via the phone tie-break branch; there is no unconditional
    // 'order by ... limit 1' fallback that would silently pick a row on a tie.
    expect(l39).not.toMatch(/order by[\s\S]*limit 1/);
  });

  it("phone tie-break links ONLY when exactly one same-name+amount row also matches the phone", () => {
    expect(l39).toContain("v_count >= 2");
    expect(l39).toContain("if v_phone_cnt = 1 then");
    // digits-only comparison on BOTH sides (masked phone won't false-match → NULL)
    expect(l39).toMatch(/regexp_replace\(se\.phone, '\\d', '', 'g'\)/);
    expect(l39).toMatch(/regexp_replace\(new\.recipient_phone, '\\d', '', 'g'\)/);
  });

  it("cm_order_no is NEVER a match predicate", () => {
    expect(block39).not.toContain("cm_order_no");
  });

  it("rewires the BEFORE insert-or-update trigger to the same link function", () => {
    expect(l39).toContain("before insert or update on public.parcel_tracking");
    expect(l39).toContain("execute function public.link_parcel_tracking()");
  });
});

describe("sql/38 parcel_tracking types", () => {
  const sql38 = readFileSync(resolve(__dirname, "../../../../sql", "38_parcel_tracking_types.sql"), "utf8").toLowerCase();
  it("adds ship_type + special_type (additive, if-not-exists)", () => {
    expect(sql38).toContain("add column if not exists ship_type");
    expect(sql38).toContain("add column if not exists special_type");
  });
});
