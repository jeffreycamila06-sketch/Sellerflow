// sql/132 contract — the auto-off branch touches only rows the trigger switched on ('auto…').
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const body = readFileSync("sql/132_parcel_auto_access_trg.sql", "utf8").replace(/^--.*$/gm, "");
const rb = readFileSync("sql/132_parcel_auto_access_trg_rollback.sql", "utf8").replace(/^--.*$/gm, "");
const live115 = readFileSync("sql/115_parcel_auto_access.sql", "utf8").replace(/^--.*$/gm, "");
const fnOf = (s: string) => { const a = s.indexOf("create or replace function public.parcel_auto_access_trg()"); const b = s.indexOf("return new;\nend;", a); return s.slice(a, b + "return new;\nend;".length); };

describe("sql/132 parcel auto access", () => {
  it("auto-off UPDATEs only touch 'auto%' rows (both tables); auto-on unchanged", () => {
    expect(body.match(/where user_id = new\.auth_user_id and enabled = true and note like 'auto%';/g)).toHaveLength(2);
    expect(body).not.toMatch(/enabled = true;\s*$/m);
    expect(body.match(/enabled = false and note like 'auto%'/g)).toHaveLength(2);
  });
  it("replaces the function only (same trigger, no backfill, nothing deleted)", () => {
    expect(body).toMatch(/create or replace function public\.parcel_auto_access_trg\(\)/);
    expect(body).not.toMatch(/create trigger|drop trigger|insert into public\.parcel_check_access \(user_id, enabled, note\)\s*select/i);
    expect(body).not.toMatch(/\bdelete\b/i);
  });
  it("is otherwise the sql/115 body: the only change is the two auto-off predicates", () => {
    const back = fnOf(body).replace(/and enabled = true and note like 'auto%';/g, "and enabled = true;").replace(/^\s*-- 132:.*\n/gm, "");
    const norm = (s: string) => s.replace(/set search_path (=|to) 'public'|set search_path (=|to) public/g, "set search_path = public").replace(/\$function\$|\$\$/g, "$$").replace(/\s+/g, " ").trim();
    expect(norm(back)).toBe(norm(fnOf(live115)));
  });
  it("rollback = the sql/115 body (auto-off hits every enabled row)", () => {
    expect(rb.match(/where user_id = new\.auth_user_id and enabled = true;/g)).toHaveLength(2);
    expect(rb).not.toMatch(/drop trigger|drop function/);
  });
});
