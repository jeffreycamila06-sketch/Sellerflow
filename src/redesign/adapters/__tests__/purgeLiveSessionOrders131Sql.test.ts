// sql/131 contract — live_session_orders purge: keep current + last 7 finished sessions whatever
// their age; delete a non-kept session WHOLE (decided by its newest row); legacy NULL-session rows
// keep the 10-day row rule; no 40-day cap; index work outside the transaction.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/131_purge_live_session_orders.sql", "utf8");
const body = sql.replace(/^--.*$/gm, "");
const rb = readFileSync("sql/131_purge_live_session_orders_rollback.sql", "utf8").replace(/^--.*$/gm, "");
const fn = body.slice(body.indexOf("create or replace function public.purge_live_session_orders()"), body.indexOf("$function$;"));

describe("sql/131 purge rule", () => {
  it("same function name + cron command, SECURITY DEFINER, execute revoked from browser roles", () => {
    expect(fn).toMatch(/security definer\s+set search_path to 'public'/);
    expect(body).toMatch(/revoke all on function public\.purge_live_session_orders\(\) from public, anon, authenticated;/);
    expect(body).not.toMatch(/cron\.schedule/); // the job keeps calling the same function
  });
  it("keeps the current session and the 7 newest finished ones with NO age cap (no v_cap / 40)", () => {
    expect(fn).toContain("c.current_session_id is distinct from s.session_id");
    expect(fn).toMatch(/where f\.rn > 7 and f\.latest_day < v_cut/);
    expect(fn).not.toMatch(/v_cap|- 40/);
  });
  it("deletes a non-kept session WHOLE, decided by its NEWEST row (max session_date), never row by row", () => {
    expect(fn).toContain("max(l.session_date) as latest_day");
    expect(fn).toMatch(/exists \(select 1 from drop_sessions d where d\.user_id = l\.user_id and d\.session_id = l\.session_id\)/);
    expect(fn).not.toMatch(/l\.session_date < v_cut\s+and \(l\.session_id is null/); // the sql/127 row-by-row shape
  });
  it("legacy rows (session_id null) keep the old 10-day row rule; public.orders untouched", () => {
    expect(fn).toContain("(l.session_id is null and l.session_date < v_cut)");
    expect(fn).toMatch(/v_cut date := \(now\(\) at time zone 'Asia\/Taipei'\)::date - 10;/);
    expect(body).not.toMatch(/public\.orders\b/);
    expect(body.match(/\bdelete from\b/gi)).toHaveLength(1);
  });
  it("index work is CONCURRENTLY and outside the transaction", () => {
    const commit = body.indexOf("commit;");
    const idx = body.indexOf("create index concurrently if not exists idx_lso_user_session_created");
    expect(idx).toBeGreaterThan(commit);
    expect(body.slice(0, commit)).not.toMatch(/create index/);
  });
  it("rollback restores the sql/127 body (40-day cap, keep CTE) without touching the job", () => {
    expect(rb).toContain("v_cap date := (now() at time zone 'Asia/Taipei')::date - 40;");
    expect(rb).toMatch(/not exists \(select 1 from keep k/);
    expect(rb).not.toMatch(/cron\.|drop index/);
  });
});
