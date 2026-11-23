// Seller Website v4 — sql/203 (the new-look switch + the photo shape), checked in CI without a database.
// The behaviour on a real Postgres is scripts/sql203-behaviour.mjs (PGlite, 59 checks, not part of CI).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { cleanLook } from "../v3/look";

const up = readFileSync("sql/203_website_new_look.sql", "utf8");
const down = readFileSync("sql/203_website_new_look_rollback.sql", "utf8");
const s168 = readFileSync("sql/168_website_look.sql", "utf8");
const fnText = (sql: string, name: string) => {
  const at = sql.indexOf(`function public.${name}(`);
  const open = sql.indexOf("$$", at), close = sql.indexOf("$$", open + 2);
  return at < 0 ? "" : sql.slice(open + 2, close);
};
const canon = (v: unknown) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

describe("sql/203 — the file", () => {
  it("creates the switch OFF and never turns it on", () => {
    expect(up).toContain("values ('website_new_look_enabled', 'false')");
    expect(up).not.toMatch(/website_new_look_enabled'\s*,\s*'true'/);
    expect(up).not.toMatch(/update\s+public\.app_settings/i);
  });
  it("the test list starts with one shop and is a JSON list", () => {
    const m = up.match(/values \('website_new_look_shops', '([^']*)'\)/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(["live"]);
  });
  it("adds no table, column, trigger or policy; one transaction; refuses on a changed function", () => {
    expect(up).not.toMatch(/\b(create|alter|drop)\s+table\b|\badd\s+column\b|\bcreate\s+(trigger|policy)\b/i);
    expect(up.match(/^begin;$/m)).not.toBeNull();
    expect(up.trimEnd().endsWith("commit;")).toBe(true);
    expect(up).toContain("is distinct from '34d12a6224296bd080315a47becf5525'");
    expect(up).toContain("nothing was changed");
  });
  it("the gate: reads only, fixed search_path, buyers may call it, not open to everyone by default", () => {
    const head = up.slice(up.indexOf("function public.website_new_look("), up.indexOf("$$", up.indexOf("function public.website_new_look(")));
    expect(head).toMatch(/returns boolean language plpgsql stable security definer set search_path = public, pg_temp/);
    expect(up).toContain("revoke all on function public.website_new_look(text) from public;");
    expect(up).toContain("grant execute on function public.website_new_look(text) to anon, authenticated, service_role;");
    const body = fnText(up, "website_new_look");
    expect(body).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(body).toContain("s.value = 'true'"); // exactly 'true'
    expect(body).toContain("public.is_admin()");
  });
  it("website_public_look = sql/168's text + ONE key (shape, only 'square')", () => {
    const before = fnText(s168, "website_public_look"), after = fnText(up, "website_public_look");
    expect(before.length).toBeGreaterThan(400);
    const added = "'shape', case when p->>'shape' = 'square' then 'square' end";
    expect(after).toContain(added);
    const strip = (s: string) => s.replace(/--[^\n]*\n/g, "").replace(/\s+/g, "");
    expect(strip(after.replace(added, ""))).toBe(strip(before).replace("z)))end;", "z),))end;"));
  });
  it("the rollback puts sql/168's function back word for word and removes the rest", () => {
    expect(fnText(down, "website_public_look")).toBe(fnText(s168, "website_public_look"));
    expect(down).toContain("drop function if exists public.website_new_look(text);");
    expect(down).toMatch(/delete from public\.app_settings where key in \('website_new_look_enabled', 'website_new_look_shops'\)/);
  });
  it("203 is the only new number of this change's SQL before the guide (204)", () => {
    const mine = readdirSync("sql").filter((f) => /^20[34]_/.test(f)).sort();
    expect(mine.filter((f) => f.startsWith("203_"))).toEqual(["203_website_new_look.sql", "203_website_new_look_rollback.sql"]);
  });
});

describe("the photo shape: the app's check = the database's (scripts/fixtures/look-shape-cases.json)", () => {
  const cases = JSON.parse(readFileSync("scripts/fixtures/look-shape-cases.json", "utf8")) as { name: string; in: unknown; out: unknown }[];
  it("has the cases", () => { expect(cases.length).toBeGreaterThanOrEqual(5); });
  for (const c of cases) it(c.name, () => { expect(canon(cleanLook(c.in) ?? null)).toBe(canon(c.out)); });
  it("the older cases still hold (a look without a shape is unchanged)", () => {
    const old = JSON.parse(readFileSync("scripts/fixtures/look-cases.json", "utf8")) as { name: string; in: unknown; out: unknown }[];
    for (const c of old) expect(canon(cleanLook(c.in) ?? null), c.name).toBe(canon(c.out));
  });
});
