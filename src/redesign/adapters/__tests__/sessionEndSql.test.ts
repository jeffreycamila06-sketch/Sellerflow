// SQL contract for the E2 "End Session" migration (sql/43). Pins the additive column,
// the end_session() write shape, and — critically — that session_status()'s ONLY change
// is the additive `session_ended_at is null` clause (the no-op-for-existing-rows proof
// depends on nothing else changing). Reads the committed SQL file directly.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "../../../../sql/43_session_end.sql"), "utf-8");
const norm = sql.replace(/\s+/g, " ").toLowerCase();
const retention = readFileSync(join(__dirname, "../../../../sql/44_live_session_retention_10day.sql"), "utf-8").replace(/\s+/g, " ").toLowerCase();

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

  it("STEP 4: start_session cap widened 5 → 7 (additive; 1..5 still valid)", () => {
    expect(norm).toMatch(/create or replace function public\.start_session\(p_days smallint\)/);
    expect(norm).toMatch(/p_days < 1 or p_days > 7/);   // new ceiling
    expect(norm).not.toMatch(/p_days > 5/);              // old ceiling gone from this file
  });

  it("STEP 4 BUG FIX: a new Start clears session_ended_at (symmetric with end_session)", () => {
    // INSERT path lists session_ended_at (set to null) …
    expect(norm).toMatch(/insert into public\.seller_session_config[^;]*session_ended_at[^;]*values[^;]*null/);
    // … and the ON CONFLICT DO UPDATE resets it too, so an End→Start reads as running.
    expect(norm).toMatch(/on conflict[^;]*do update[\s\S]*set[\s\S]*session_ended_at\s*=\s*null/);
  });
});

describe("sql/44 — live_session_orders retention 8 → 10 days (GLOBAL cron)", () => {
  it("reschedules the SAME fleet-wide purge job to a 10-day cutoff", () => {
    expect(retention).toMatch(/cron\.schedule\(\s*'purge-old-live-session-orders'/);
    expect(retention).toMatch(/session_date < \(now\(\) at time zone 'asia\/taipei'\)::date - 10/);
    expect(retention).not.toMatch(/::date - 8\b/);       // no longer 8
    expect(retention).toMatch(/global/);                 // the file flags it as fleet-wide
  });
});
