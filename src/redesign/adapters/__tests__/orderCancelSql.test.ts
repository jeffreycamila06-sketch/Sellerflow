// sql/234 (Cancel order) — the file's own rules, read from the SQL text (CI has no database; the
// behaviour script scripts/sql234-behaviour.mjs runs it for real in PGlite).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const UP = readFileSync(resolve(process.cwd(), "sql/234_order_cancel.sql"), "utf8");
const DOWN = readFileSync(resolve(process.cwd(), "sql/234_order_cancel_rollback.sql"), "utf8");
const fn = (name: string) => {
  const i = UP.indexOf(`create or replace function public.${name}(`);
  expect(i, name).toBeGreaterThan(-1);
  return UP.slice(i, UP.indexOf("$function$;", i));
};

describe("sql/234 — Cancel order", () => {
  it("one transaction, guarded by the md5 of the seven live texts before and after", () => {
    expect(UP).toMatch(/^begin;/m);
    expect(UP).toMatch(/^commit;/m);
    for (const f of ["my_feature_access", "sales_report", "sales_by_platform_orders", "miners_report", "sales_by_platform", "peak_hour_orders", "my_session_summaries"])
      expect((UP.match(new RegExp(`'${f}'`, "g")) || []).length).toBeGreaterThanOrEqual(2);
  });
  it("the release switch is created OFF; the tag switch ON", () => {
    expect(UP).toMatch(/'order_cancel_enabled', 'false'/);
    expect(UP).toMatch(/'order_ref_enabled', 'true'/);
  });
  it("cancel / undo / check: every read and write of a row is the caller's own (auth.uid())", () => {
    for (const name of ["cancel_order", "uncancel_order", "order_cancel_check"]) {
      const body = fn(name);
      expect(body).toMatch(/v_uid uuid := auth\.uid\(\)/);
      expect(body).toMatch(/security definer/);
      expect(body).toMatch(/set search_path to 'public'/);
      expect(body).toMatch(/order_cancel_allowed\(\)/);
      for (const m of body.matchAll(/(?:from|update) public\.(live_session_orders|orders|customers|products|invoice_sends|fb_receipts)\b[^;]*?;/gs))
        expect(m[0], `${name}: ${m[0].slice(0, 80)}`).toMatch(/user_id = v_uid/);
    }
  });
  it("a cancel never deletes a row and never touches the free-order counters", () => {
    expect(UP).not.toMatch(/\bdelete from public\.(orders|live_session_orders)/i);
    expect(UP).not.toMatch(/free_orders_count|free_cycle_started_at|check_and_increment_free_order/);
  });
  it("cancel frees the comment id / Auto code (kept for Undo); Undo puts them back unless taken", () => {
    const c = fn("cancel_order");
    expect(c).toMatch(/cancel_msg_id = l\.comment_msg_id/);
    expect(c).toMatch(/comment_msg_id = null/);
    expect(c).toMatch(/auto_code = null/);
    expect(fn("uncancel_order")).toMatch(/exception when unique_violation/);
  });
  it("Customers: the exact handle the app counted on (the table is unique on lower(handle))", () => {
    expect(fn("cancel_order")).toMatch(/c\.handle = v_handle/);
    expect(fn("uncancel_order")).toMatch(/c\.handle = v_handle/);
    expect(UP).not.toMatch(/lower\(c\.handle\)/);
  });
  it("the three functions are for signed-in sellers only (never anon)", () => {
    for (const s of ["order_cancel_check(uuid)", "cancel_order(uuid)", "uncancel_order(uuid)"]) {
      expect(UP).toContain(`revoke all on function public.${s} from public, anon;`);
      expect(UP).toContain(`grant execute on function public.${s} to authenticated;`);
    }
  });
  it("the rollback refuses while any order is cancelled, then removes everything", () => {
    expect(DOWN).toMatch(/still cancelled/);
    for (const s of ["cancel_order", "uncancel_order", "order_cancel_check", "order_cancel_allowed"]) expect(DOWN).toMatch(new RegExp(`drop function if exists public\\.${s}`));
    for (const c of ["order_ref", "cancelled_at", "cancel_msg_id", "cancel_auto_code"]) expect(DOWN).toContain(c);
  });
});
