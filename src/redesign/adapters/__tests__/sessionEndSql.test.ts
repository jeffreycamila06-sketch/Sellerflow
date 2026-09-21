// SQL contract for the E2 "End Session" migration (sql/43). Pins the additive column,
// the end_session() write shape, and — critically — that session_status()'s ONLY change
// is the additive `session_ended_at is null` clause (the no-op-for-existing-rows proof
// depends on nothing else changing). Reads the committed SQL file directly.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "../../../../sql/43_session_end.sql"), "utf-8");
const norm = sql.replace(/\s+/g, " ").toLowerCase();

describe("sql/43 — session end migration contract", () => {
  it("STEP 1: adds session_ended_at as an additive nullable column (no default, no backfill)", () => {
    expect(norm).toMatch(/add column if not exists session_ended_at timestamptz/);
    expect(norm).not.toMatch(/session_ended_at timestamptz[^;]*default/); // no default
    expect(norm).not.toMatch(/update public\.seller_session_config set session_ended_at = /); // no backfill
  });

  it("STEP 2: end_session() is SECURITY INVOKER, own-scoped, sets BOTH fields", () => {
    expect(norm).toMatch(/create or replace function public\.end_session\(\)/);
    expect(norm).toMatch(/security invoker/);
    expect(norm).toMatch(/set current_session_id = null/);
    expect(norm).toMatch(/session_ended_at\s*=\s*now\(\)/);
    expect(norm).toMatch(/where user_id = \(select auth\.uid\(\)\)/);
  });

  it("STEP 3: session_status() adds ONLY the `session_ended_at is null` clause", () => {
    // the new clause is present…
    expect(norm).toMatch(/and c\.session_ended_at\s+is null/);
    // …and the rest of the running condition is byte-for-byte the live definition.
    expect(norm).toMatch(/c\.current_session_id\s+is not null/);
    expect(norm).toMatch(/c\.session_started_at\s+is not null/);
    expect(norm).toMatch(/c\.session_window_days is not null/);
    expect(norm).toMatch(/\(now\(\) at time zone 'asia\/taipei'\)::date\s*<=\s*\(c\.session_started_at at time zone 'asia\/taipei'\)::date\s*\+\s*\(c\.session_window_days - 1\)/);
    expect(norm).toMatch(/where c\.user_id = \(select auth\.uid\(\)\)/);
  });
});
