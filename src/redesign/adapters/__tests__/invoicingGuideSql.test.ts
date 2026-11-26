// sql/221 (same day, Invoicing opens — sql/220): that line gets its final words and a new "invoicing" row is added;
// sql/116b and the guide file hold the text AFTER sql/221. See the second block below.
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
const NEW_LINE = "- **Invoicing** — send each buyer their invoice on TikTok after your live. If it shows **Soon**, it is not open for your account yet.";   // sql/221
const up221 = read("sql/221_guide_invoicing_open.sql"), down221 = read("sql/221_guide_invoicing_open_rollback.sql");
const AFTER_219_MD5 = "6103abd883144b752bb6ca0cd36813a9";   // md5(body) of the live settings-tiles row once sql/219 was applied (read 2026-11-26)
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
  const after = seedBody().replace(NEW_LINE, LINE);   // the row after sql/219 (sql/116b holds the sql/221 words)
  const live = after.replace(`${LINE}\n`, "");
  it("the row before = the live row (md5 checked on production), and it has no Invoicing line", () => {
    expect(md5(live)).toBe(LIVE_MD5);
    expect(live).not.toContain("Invoicing");
  });
  it("live row + sql/219 = the row that is live now; the line sits right after Invite friends; twice = no change", () => {
    const once = run(up, live);
    expect(once).toBe(after);
    expect(md5(once)).toBe(AFTER_219_MD5);
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
  it("the guide file's Settings section = that row with the sql/221 words, dated 2026-11-26", () => {
    const a = guide.indexOf("## settings-tiles");
    const section = guide.slice(a, guide.indexOf("\n## ", a + 5));
    expect(section).toContain("Last checked: 2026-11-26");
    expect(section).toContain(NEW_LINE);
    expect(section).not.toContain(LINE);
    expect(section.replace(/^.*\n.*\n.*\n\n/, "")).toBe(`${after.replace(LINE, NEW_LINE)}\n`);
  });
  it("no guide text sends sellers to a 'Receipt format' tile in Settings (there is no path to change)", () => {
    expect(guide).not.toMatch(/receipt format/i);
    expect(seed).not.toMatch(/receipt format/i);
  });
});

describe("sql/221 — the help guide when Invoicing opens", () => {
  const after219 = seedBody().replace(NEW_LINE, LINE);
  // the "invoicing" row as sql/116b has it (id, title, date, keywords, body)
  const seedRow = (() => {
    const a = seed.indexOf("  ('invoicing',");
    return seed.slice(a).match(new RegExp(`^  \\('invoicing', ${SQL_TEXT}, '\\d{4}-\\d{2}-\\d{2}'::date, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"))!;
  })();
  it("the Settings row: the live row + sql/221 = the row in sql/116b; twice = no change; one Invoicing line", () => {
    const once = run(up221, after219);
    expect(once).toBe(seedBody());
    expect(run(up221, once)).toBe(once);
    expect(once.split("**Invoicing**").length - 1).toBe(1);
    expect(run(up221, after219.replace(`${LINE}\n`, ""))).toBe(after219.replace(`${LINE}\n`, ""));   // no old line → nothing is touched
  });
  it("the new row + sql/224 (the Facebook tab line, applied after it) is word for word the row of sql/116b = the guide file's section", () => {
    expect(up221.split("('invoicing',").length - 1).toBe(1);
    const r221 = up221.slice(up221.indexOf("  ('invoicing',")).match(new RegExp(`^  \\('invoicing', ${SQL_TEXT}, '\\d{4}-\\d{2}-\\d{2}'::date, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"))!;
    expect(md5(unq(r221[3]))).toBe("2dbd54d0909f9b6eb341745efb48a0d7");   // = the live row's body (read 2026-11-26)
    expect(r221[1]).toBe(seedRow[1]);
    expect(run224(up224, { body: unq(r221[3]), keywords: unq(r221[2]) })).toEqual({ body: unq(seedRow[3]), keywords: unq(seedRow[2]) });
    const a = guide.indexOf("## invoicing — ");
    const section = guide.slice(a, guide.indexOf("\n## ", a + 5));
    expect(section.split("\n")[0]).toBe(`## invoicing — ${unq(seedRow[1])}`);
    expect(section).toContain("Last checked: 2026-11-26");
    expect(section.split("\n")[2]).toBe(`Keywords: ${unq(seedRow[2])}`);
    expect(section.replace(/^.*\n.*\n.*\n\n/, "")).toBe(`${unq(seedRow[3])}\n`);
  });
  it("the rollback removes the row and gives the live Settings row back; twice = no change", () => {
    expect(down221).toContain("delete from public.support_guide where id = 'invoicing';");
    expect(run(down221, seedBody())).toBe(after219);
    expect(md5(run(down221, seedBody()))).toBe(AFTER_219_MD5);
    expect(run(down221, after219)).toBe(after219);
  });
  it("only those two rows; nothing else is written; says it is not applied and to apply it last", () => {
    for (const sql of [up221, down221]) {
      expect([...new Set(sql.match(/where id = '([\w-]+)'/g))].sort()).toEqual(sql === up221 ? ["where id = 'settings-tiles'"] : ["where id = 'invoicing'", "where id = 'settings-tiles'"]);
      expect(sql).toMatch(/^begin;$/m);
      expect(sql).toMatch(/^commit;$/m);
      expect(sql).not.toMatch(/\b(drop|alter|app_settings|feature_access_emails)\b/i);
    }
    expect(up221.split("insert into public.support_guide").length - 1).toBe(1);
    expect(up221).toContain("NOT APPLIED");
    expect(up221).toContain("after invoicing_enabled is 'true'");
  });
  it("the section is user words only: no table, switch, key or plan word", () => {
    const body = unq(seedRow[3]);
    expect(body).not.toMatch(/invoice_sends|invoicing_enabled|app_settings|feature|preview list|database|hash|session_key|sql\//i);
    expect(body).not.toMatch(/\b(plan|upgrade|subscri\w*|price of)\b/i);
    expect(body).toContain("**Send next**");
    expect(body).toContain("**Message → Paste → Send**");
  });
});

// sql/224 (Facebook tab locked card, 2026-11-26): the "invoicing" row's Facebook line + three search words.
const up224 = read("sql/224_guide_fb_invoicing_lock.sql"), down224 = read("sql/224_guide_fb_invoicing_lock_rollback.sql");
function run224(sql: string, row: { body: string; keywords: string }): { body: string; keywords: string } {
  const rb = sql.match(new RegExp(`replace\\(body, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"))!;
  const rk = sql.match(new RegExp(`replace\\(keywords, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"))!;
  const must = sql.match(new RegExp(`position\\(${SQL_TEXT} in body\\) > 0`, "s"))!;
  const mustNot = sql.match(new RegExp(`position\\(${SQL_TEXT} in body\\) = 0`, "s"));
  if (!row.body.includes(unq(must[1]))) return row;
  if (mustNot && row.body.includes(unq(mustNot[1]))) return row;
  return { body: row.body.split(unq(rb[1])).join(unq(rb[2])), keywords: row.keywords.split(unq(rk[1])).join(unq(rk[2])) };
}
describe("sql/224 — the Facebook tab line in the invoicing row", () => {
  const seedRow = (() => {
    const a = seed.indexOf("  ('invoicing',");
    return seed.slice(a).match(new RegExp(`^  \\('invoicing', ${SQL_TEXT}, '\\d{4}-\\d{2}-\\d{2}'::date, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"))!;
  })();
  const r221 = up221.slice(up221.indexOf("  ('invoicing',")).match(new RegExp(`^  \\('invoicing', ${SQL_TEXT}, '\\d{4}-\\d{2}-\\d{2}'::date, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"))!;
  const live = { body: unq(r221[3]), keywords: unq(r221[2]) };
  it("live row + sql/224 = sql/116b; twice = no change; the old line is gone and the new one is there once", () => {
    const once = run224(up224, live);
    expect(once).toEqual({ body: unq(seedRow[3]), keywords: unq(seedRow[2]) });
    expect(run224(up224, once)).toEqual(once);
    expect(once.body).not.toContain("Facebook, Instagram and Shopee invoices are coming soon.");
    expect(once.body.split("**Ask Admin to turn it on**").length - 1).toBe(1);
    const fbLine = once.body.split("\n").find((l) => l.startsWith("**Facebook tab**"))!;
    expect(fbLine).not.toMatch(/NT\$|price|upgrade/i);
  });
  it("the rollback gives the live row back; twice = no change", () => {
    const once = run224(up224, live);
    expect(run224(down224, once)).toEqual(live);
    expect(run224(down224, live)).toEqual(live);
  });
  it("only the invoicing row; one statement in one transaction; nothing else is written", () => {
    for (const sql of [up224, down224]) {
      expect([...new Set(sql.match(/where id = '([\w-]+)'/g))]).toEqual(["where id = 'invoicing'"]);
      expect(sql.split("update public.support_guide").length - 1).toBe(1);
      expect(sql).toMatch(/^begin;$/m);
      expect(sql).toMatch(/^commit;$/m);
      expect(sql).not.toMatch(/\b(drop|alter|insert|delete|app_settings|feature_access_emails|fb_receipt_access)\b/i);
    }
  });
});
