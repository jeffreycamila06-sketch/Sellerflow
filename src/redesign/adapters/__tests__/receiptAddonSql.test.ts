// sql/223 (Receipt add-on admin functions), read as text — runs in CI. The behaviour on a real Postgres
// is proven by scripts/sql223-behaviour.mjs (PGlite, not in CI).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const UP = readFileSync("sql/223_receipt_addon_admin.sql", "utf8");
const DOWN = readFileSync("sql/223_receipt_addon_admin_rollback.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const bodies = [...code(UP).matchAll(/create or replace function public\.(admin_receipt_addon_\w+)\([\s\S]*?\nas \$\$([\s\S]*?)\$\$;/g)];

describe("sql/223", () => {
  it("three functions, each SECURITY DEFINER with a fixed search path, each asking is_admin() before anything else", () => {
    expect(bodies.map((b) => b[1]).sort()).toEqual(["admin_receipt_addon_list", "admin_receipt_addon_note", "admin_receipt_addon_set"]);
    for (const [whole, name, body] of bodies) {
      expect(whole, name).toMatch(/security definer\s+set search_path = public, pg_temp/);
      const firstStatement = body.split("begin")[1].trim().split("\n")[0];
      expect(firstStatement, name).toBe("if not coalesce(public.is_admin(), false) then");
    }
  });
  it("a non-admin gets nothing: [] from the list, not_admin from the two writes", () => {
    const by = Object.fromEntries(bodies.map((b) => [b[1], b[2]]));
    expect(by.admin_receipt_addon_list).toMatch(/is_admin\(\), false\) then\s+return '\[\]'::jsonb;/);
    for (const f of ["admin_receipt_addon_set", "admin_receipt_addon_note"]) expect(by[f]).toMatch(/is_admin\(\), false\) then\s+return jsonb_build_object\('ok', false, 'error', 'not_admin'\);/);
  });
  it("anon cannot call them; signed-in users can", () => {
    for (const sig of ["admin_receipt_addon_list()", "admin_receipt_addon_set(text, boolean, text)", "admin_receipt_addon_note(uuid, text)"]) {
      expect(UP).toContain(`revoke all on function public.${sig} from public, anon;`);
      expect(UP).toContain(`grant execute on function public.${sig} to authenticated;`);
    }
    expect(code(UP)).not.toMatch(/to anon\b|grant[^;]*\banon\b/);
  });
  it("the file changes no row and no setting outside the functions; remove = enabled false (never a delete)", () => {
    const outside = code(UP).replace(/create or replace function[\s\S]*?\$\$;/g, "");
    expect(outside).not.toMatch(/\b(insert|update|delete|truncate|alter|drop)\b/i);
    expect(code(UP)).not.toMatch(/delete from|app_settings/i);
    expect(code(UP)).toMatch(/update public\.fb_receipt_access set enabled = false where user_id = v_user;/);
  });
  it("rollback drops the three functions and nothing else", () => {
    const stmts = code(DOWN).split(";").map((s) => s.trim()).filter((s) => s && s !== "begin" && s !== "commit");
    expect(stmts).toEqual([
      "drop function if exists public.admin_receipt_addon_note(uuid, text)",
      "drop function if exists public.admin_receipt_addon_set(text, boolean, text)",
      "drop function if exists public.admin_receipt_addon_list()",
    ]);
  });
});
