// sql/37 parcel_tracking contracts — the sql/ file is the canonical text applied
// to prod via MCP; these pin the load-bearing invariants so a future edit can't
// silently regress them:
//   1. own-scoped RLS (4 policies, all user_id = auth.uid()),
//   2. UNIQUE (user_id, tracking_no) — idempotent re-paste/re-scrape,
//   3. the link trigger is SECURITY INVOKER (never DEFINER — no RLS-bypass
//      surface) with a pinned search_path,
//   4. the buyer-username link matches on recipient_name + store_id +
//      order_amount AND filters by an EXPLICIT se.user_id = new.user_id (the
//      Miners lesson — never rely on RLS inside a trigger the poller also fires),
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

  it("link matches recipient_name + store_id + order_amount, filtered by explicit se.user_id = new.user_id", () => {
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
