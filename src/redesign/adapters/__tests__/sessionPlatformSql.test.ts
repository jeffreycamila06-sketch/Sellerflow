// SQL contract for session-RPC v2 (sql/46) — reads the mirror file and pins the H1/H2
// design (structural; the DB-runtime behaviors — reuse-if-running returns the existing
// id, ended session not reused, {p_days}-only resolves — need chat-Claude to verify
// post-apply against the live DB, see the report's can't-verify list).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/46_session_platform.sql", "utf8");
// Comment-stripped DDL — the header/footer comments legitimately mention buyer_number /
// window_start / end_session (as "untouched"); the non-touch assertions must check the
// actual statements, not the prose.
const ddl = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("sql/46 — H1 additive column + session_status", () => {
  it("ADD COLUMN session_platform is nullable, no default, no backfill", () => {
    expect(sql).toMatch(/add column if not exists session_platform text\s*;/);
    expect(sql).not.toMatch(/session_platform text[^;]*default/i); // no default
    expect(sql).not.toMatch(/update\s+public\.seller_session_config/i); // no backfill
  });
  it("session_status is DROPped then recreated returning session_platform, explicit SECURITY INVOKER", () => {
    expect(sql).toContain("drop function if exists public.session_status();");
    expect(sql).toMatch(/returns table\(running boolean, session_id uuid, session_platform text\)/);
    expect(sql).toMatch(/create function public\.session_status\(\)[\s\S]*?security invoker/);
  });
  it("the RUNNING definition is preserved byte-for-byte (E2 ended clause + Taipei window)", () => {
    expect(sql).toContain("c.session_ended_at    is null");
    expect(sql).toContain("(now() at time zone 'Asia/Taipei')::date");
    expect(sql).toContain("+ (c.session_window_days - 1) ) as running");
  });
});

describe("sql/46 — H2 start_session reuse-if-running + platform stamp", () => {
  it("DROPs the old 1-arg signature and creates (p_days, p_platform default null, p_force default false)", () => {
    expect(sql).toContain("drop function if exists public.start_session(smallint);");
    expect(sql).toMatch(/create function public\.start_session\(p_days smallint, p_platform text default null, p_force boolean default false\)/);
    expect(sql).toMatch(/create function public\.start_session[\s\S]*?security invoker/);
  });
  it("keeps 1..7 validation", () => {
    expect(sql).toMatch(/p_days\s+is null or p_days\s*<\s*1 or p_days\s*>\s*7/);
  });
  it("reuse-if-running: force=false + running → RETURN the existing id (no overwrite)", () => {
    expect(sql).toContain("if not p_force then");
    expect(sql).toContain("return v_existing;");
    // the reuse check uses the SAME ended-aware running definition
    expect(sql).toMatch(/c\.session_ended_at\s+is null[\s\S]*?into v_existing, v_running/);
  });
  it("MED-1 fix: a per-user advisory xact lock guards the reuse check (BEFORE it → no TOCTOU)", () => {
    expect(ddl).toContain("perform pg_advisory_xact_lock(hashtext('start_session_' || v_uid::text));");
    const lockIdx  = ddl.indexOf("pg_advisory_xact_lock");
    const reuseIdx = ddl.indexOf("if not p_force then");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(reuseIdx); // lock acquired before the read → concurrent calls serialize
  });
  it("the mint path stamps session_platform (INSERT + ON CONFLICT) and nulls session_ended_at", () => {
    expect(sql).toMatch(/values\s*\([\s\S]*?p_days, null, p_platform\)/);
    expect(sql).toContain("session_platform    = excluded.session_platform");
    expect(sql).toContain("session_ended_at    = null");
  });
});

describe("sql/46 — grants + non-touch of sacred/legacy state", () => {
  it("re-GRANTs execute to authenticated (DROP dropped the old grants), revokes public/anon", () => {
    expect(sql).toContain("grant  execute on function public.session_status()                             to authenticated;");
    expect(sql).toContain("grant  execute on function public.start_session(smallint, text, boolean)       to authenticated;");
    expect(sql).toMatch(/revoke execute on function public\.session_status\(\)\s+from public, anon;/);
  });
  it("does NOT touch buyer_number, legacy window_start, or (re)define end_session — in the DDL", () => {
    expect(ddl).not.toContain("buyer_number");
    expect(ddl).not.toContain("window_start");
    expect(ddl).not.toMatch(/create (or replace )?function public\.end_session/); // end_session untouched (sql/43)
  });
  it("MED-2 fix: the whole migration is wrapped BEGIN…COMMIT (atomic) + PostgREST reload after", () => {
    expect(ddl).toContain("begin;");
    expect(ddl).toContain("commit;");
    expect(ddl).toContain("notify pgrst, 'reload schema';");
    const beginIdx  = ddl.indexOf("begin;");
    const alterIdx  = ddl.indexOf("alter table public.seller_session_config");
    const commitIdx = ddl.indexOf("commit;");
    const notifyIdx = ddl.indexOf("notify pgrst");
    // begin < the first DDL statement < commit < the reload
    expect(beginIdx).toBeGreaterThan(-1);
    expect(beginIdx).toBeLessThan(alterIdx);
    expect(alterIdx).toBeLessThan(commitIdx);
    expect(commitIdx).toBeLessThan(notifyIdx);
  });
});
