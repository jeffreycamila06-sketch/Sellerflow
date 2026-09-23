// SQL contract for FB pages (sql/47) — reads the mirror file and pins the F-P1 schema
// shape (structural; the DB-runtime behaviors — RLS actually blocking client
// insert/update, the app_settings seed landing — need chat-Claude to verify post-apply
// against the live DB, see the report's can't-verify list). Same pattern as
// sessionPlatformSql.test.ts / any existing *Sql.test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("sql/47_fb_pages.sql", "utf8");
// Comment-stripped DDL — the header comments legitimately mention refresh_token /
// bigint / shopee_shops (as "deviations / mirror"); the shape assertions must check the
// actual statements, not the prose.
const ddl = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("sql/47 — fb_pages table shape (mirror of shopee_shops)", () => {
  it("creates public.fb_pages with the spec columns", () => {
    expect(ddl).toMatch(/create table if not exists public\.fb_pages/);
    expect(ddl).toMatch(/user_id\s+uuid not null references auth\.users\(id\) on delete cascade/);
    expect(ddl).toMatch(/page_id\s+text not null/);
    expect(ddl).toMatch(/page_name\s+text/);
    expect(ddl).toMatch(/page_username\s+text/);
    expect(ddl).toMatch(/access_token\s+text/);
    expect(ddl).toMatch(/token_expires_at\s+timestamptz/);
    expect(ddl).toMatch(/active\s+boolean not null default true/);
    expect(ddl).toMatch(/created_at\s+timestamptz not null default now\(\)/);
    expect(ddl).toMatch(/updated_at\s+timestamptz not null default now\(\)/);
  });
  it("unique (user_id, page_id) — the P2 upsert conflict target / per-seller identity", () => {
    expect(ddl).toMatch(/unique \(user_id, page_id\)/);
  });
  it("DEVIATION: NO refresh_token column (long-lived page token, no refresh token)", () => {
    expect(ddl).not.toContain("refresh_token");
  });
  it("two indexes mirroring shopee_shops' (per-user listing + active/expiry scan)", () => {
    expect(ddl).toMatch(/create index if not exists fb_pages_user on public\.fb_pages \(user_id\)/);
    expect(ddl).toMatch(/create index if not exists fb_pages_active_expiry\s*\n?\s*on public\.fb_pages \(active, token_expires_at\)/);
  });
});

describe("sql/47 — RLS: SELECT + DELETE own only, NO client insert/update", () => {
  it("RLS enabled", () => {
    expect(ddl).toMatch(/alter table public\.fb_pages enable row level security/);
  });
  it("select-own + delete-own policies (user_id = auth.uid())", () => {
    expect(ddl).toMatch(/create policy fb_pages_select on public\.fb_pages\s*\n?\s*for select using \(user_id = auth\.uid\(\)\)/);
    expect(ddl).toMatch(/create policy fb_pages_delete on public\.fb_pages\s*\n?\s*for delete using \(user_id = auth\.uid\(\)\)/);
  });
  it("NO insert/update policy exists → RLS default-deny for the client (server service-role only)", () => {
    expect(ddl).not.toMatch(/for insert/i);
    expect(ddl).not.toMatch(/for update/i);
  });
});

describe("sql/47 — app_settings kill switch seed", () => {
  it("seeds 'fb_enabled'='false' with on-conflict-do-nothing (mirror of shopee_enabled)", () => {
    expect(ddl).toMatch(/insert into public\.app_settings \(key, value\) values \('fb_enabled', 'false'\)/);
    expect(ddl).toMatch(/on conflict \(key\) do nothing/);
  });
});
