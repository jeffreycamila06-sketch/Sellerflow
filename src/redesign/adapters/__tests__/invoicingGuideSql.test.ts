// sql/219 (help guide, 2026-11-26): ONE line "Invoicing — sending invoices to buyers is coming soon." is added
// to the "The Settings screen" row. Checked on the SQL text as written in the files (quotes doubled, real line
// breaks), the way the database runs it:
//   the live row (md5 checked on production 2026-11-26) + sql/219 = the row in sql/116b = the guide file;
//   twice = no change; the rollback gives the live row back; no other row is named.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const read = (f: string) => readFileSync(f, "utf8");
const up = read("sql/219_guide_invoicing.sql"), down = read("sql/219_guide_invoicing_rollback.sql");
const seed = read("sql/116b_guide_seed.sql"), guide = read("docs/support/sfl-guide.md");
const LINE = "- **Invoicing** — sending invoices to buyers is coming soon.";
const LIVE_MD5 = "c712fcf82e325312ef20cf085f0c6c0b";   // md5(body) of the live settings-tiles row, 2026-11-26
const SQL_TEXT = "'((?:[^']|'')*)'";
const unq = (s: string) => s.replace(/''/g, "'");

// the body of the settings-tiles row in sql/116b (as the database stores it)
function seedBody(): string {
  const a = seed.indexOf("  ('settings-tiles',");
  const m = seed.slice(a).match(new RegExp(`^  \\('settings-tiles', ${SQL_TEXT}, '\\d{4}-\\d{2}-\\d{2}'::date, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"));
  if (!m) throw new Error("settings-tiles row not found in sql/116b");
  return unq(m[3]);
}
// what an "update … set body = replace(body, A, B) … where position(A) > 0 [and position(C) = 0]" does to a body
function run(sql: string, body: string): string {
  const rep = sql.match(new RegExp(`replace\\(body, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"))!;
  const must = sql.match(new RegExp(`position\\(${SQL_TEXT} in body\\) > 0`, "s"))!;
  const mustNot = sql.match(new RegExp(`position\\(${SQL_TEXT} in body\\) = 0`, "s"));
  if (!body.includes(unq(must[1]))) return body;
  if (mustNot && body.includes(unq(mustNot[1]))) return body;
  return body.split(unq(rep[1])).join(unq(rep[2]));
}
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

describe("sql/219 — the Invoicing line in the help guide", () => {
  const after = seedBody();
  const live = after.replace(`${LINE}\n`, "");
  it("the row before = the live row (md5 checked on production), and it has no Invoicing line", () => {
    expect(md5(live)).toBe(LIVE_MD5);
    expect(live).not.toContain("Invoicing");
  });
  it("live row + sql/219 = the row in sql/116b; the line sits right after Invite friends; twice = no change", () => {
    const once = run(up, live);
    expect(once).toBe(after);
    expect(once).toContain(`add a friend's code.\n${LINE}\n- **General Settings**`);
    expect(run(up, once)).toBe(once);
    expect(once.split(LINE).length - 1).toBe(1);
  });
  it("the rollback gives the live row back, and does nothing to a row without the line", () => {
    expect(run(down, after)).toBe(live);
    expect(run(down, live)).toBe(live);
  });
  it("only the settings-tiles row; 'checked' moves to 2026-11-26; one statement in one transaction each", () => {
    for (const sql of [up, down]) {
      expect(sql.match(/where id = '([\w-]+)'/g)).toEqual(["where id = 'settings-tiles'"]);
      expect(sql.split("update public.support_guide").length - 1).toBe(1);
      expect(sql).toMatch(/^begin;$/m);
      expect(sql).toMatch(/^commit;$/m);
      expect(sql).not.toMatch(/\b(delete|insert|drop|alter|app_settings)\b/i);
    }
    expect(up).toContain("checked = greatest(checked, '2026-11-26'::date)");
  });
  it("the guide file says the same, in the Settings section, dated 2026-11-26 — user words only", () => {
    const a = guide.indexOf("## settings-tiles");
    const section = guide.slice(a, guide.indexOf("\n## ", a + 5));
    expect(section).toContain("Last checked: 2026-11-26");
    expect(section).toContain(LINE);
    expect(section.replace(/^.*\n.*\n.*\n\n/, "")).toBe(`${after}\n`);
  });
  it("no guide text sends sellers to a 'Receipt format' tile in Settings (there is no path to change)", () => {
    expect(guide).not.toMatch(/receipt format/i);
    expect(seed).not.toMatch(/receipt format/i);
  });
});
