// sql/228 (Admin → Free tier last order times) — the rules CI can check from the file itself.
// The real database behaviour is proven by scripts/sql228-behaviour.mjs (PGlite).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const UP = readFileSync("sql/228_admin_free_tier_activity.sql", "utf8");
const DOWN = readFileSync("sql/228_admin_free_tier_activity_rollback.sql", "utf8");
const code = UP.replace(/--.*$/gm, "");

describe("sql/228 admin_free_tier_activity", () => {
  it("is SECURITY DEFINER with a fixed search_path", () => {
    expect(code).toMatch(/security definer/i);
    expect(code).toMatch(/set search_path = public/i);
  });
  it("checks is_admin() FIRST and returns nothing for anyone else", () => {
    const body = code.slice(code.indexOf("begin"));
    expect(body.trim().startsWith("begin\n  if not public.is_admin() then\n    return;\n  end if;")).toBe(true);
  });
  it("lists FREE sellers only and only reads (no insert / update / delete)", () => {
    expect(code).toMatch(/where sp\.plan = 'free'/);
    expect(code).not.toMatch(/\b(insert|update|delete|truncate|alter table)\b/i);
  });
  it("no execute for anon / public; execute for authenticated", () => {
    expect(code).toMatch(/revoke all on function public\.admin_free_tier_activity\(\) from public;/);
    expect(code).toMatch(/revoke all on function public\.admin_free_tier_activity\(\) from anon;/);
    expect(code).toMatch(/grant execute on function public\.admin_free_tier_activity\(\) to authenticated;/);
    expect(code).not.toMatch(/to anon/);
  });
  it("rollback only drops the function", () => {
    expect(DOWN.replace(/--.*$/gm, "").trim()).toBe("drop function if exists public.admin_free_tier_activity();");
  });
});
