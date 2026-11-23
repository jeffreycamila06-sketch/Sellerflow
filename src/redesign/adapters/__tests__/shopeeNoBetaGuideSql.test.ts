// sql/202 — the word "beta" leaves the Shopee help text (phrase replacements; NOT applied). The real run on
// Postgres is scripts/sql202-behaviour.mjs (PGlite); this CI test pins the phrases against the LIVE rows (kept in
// sql/201's rollback, md5-checked on production 2026-11-22) and against the guide file / sql/116b.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const up = readFileSync("sql/202_guide_shopee_no_beta.sql", "utf8");
const down = readFileSync("sql/202_guide_shopee_no_beta_rollback.sql", "utf8");
const live = readFileSync("sql/201_guide_account_limits_v2_rollback.sql", "utf8");
const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
const guide = readFileSync("docs/support/sfl-guide.md", "utf8");
const sq = (s: string) => s.replace(/'/g, "''");          // as written inside a SQL string
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const rowOf = (s: string, id: string) => { const a = s.indexOf(`  ('${id}',`); const b = s.indexOf("),\n  ('", a); return s.slice(a, b < 0 ? s.indexOf(")\non conflict", a) + 1 : b + 1); };

// old (live) → new (guide). The order is the order of the nested replace() calls.
const PAIRS: [string, string][] = [
  ["Shopee Live is a **beta**. Admin turns it on for you for 30 days at a time.", "Admin turns Shopee Live on for you for 30 days at a time."],
  ['"Shopee Beta only — upgrade to use TikTok/Facebook." During the beta, a free plan can use Shopee only.', '"Shopee only on your plan — upgrade to use TikTok/Facebook." On a free plan you can use Shopee only.'],
  ['"Shopee Beta ended — contact Admin."', '"Shopee access ended — contact Admin."'],
  ['- **Shopee** is a beta — see "Shopee Live (beta)".', '- **Shopee** — see "Shopee Live".'],
  ["opens your Shopee shops (beta).", "opens your Shopee shops."],
];

describe("sql/202 — Shopee help text without 'beta'", () => {
  it("files 202 (+ rollback) only; NOT applied; touches only the three rows; no delete / drop / insert", () => {
    expect(readdirSync("sql").filter((f) => /^202_/.test(f)).sort()).toEqual(["202_guide_shopee_no_beta.sql", "202_guide_shopee_no_beta_rollback.sql"]);
    expect(up).toMatch(/NOT APPLIED/);
    for (const s of [up, down]) {
      expect(code(s)).toContain("where g.id in ('connect-shopee', 'other-platforms', 'general-settings')");
      expect(code(s)).not.toMatch(/delete from|drop |insert into|alter |create /i);
      expect(code(s)).toContain("is distinct from");                              // twice = nothing written
    }
  });
  it("every pair: old → new in sql/202, new → old in the rollback (the exact reverse)", () => {
    for (const [o, n] of PAIRS) {
      expect(up).toContain(`'${sq(o)}',\n           '${sq(n)}'`);
      expect(down).toContain(`'${sq(n)}',\n           '${sq(o)}'`);
    }
    expect(up).toContain("g.title = 'Shopee Live (beta)' then 'Shopee Live'");
    expect(down).toContain("g.title = 'Shopee Live' then 'Shopee Live (beta)'");
  });
  it("on the live rows the old phrases are there, and after the pairs no 'beta' is left in title or body", () => {
    const apply = (s: string) => PAIRS.reduce((acc, [o, n]) => acc.split(sq(o)).join(sq(n)), s);
    for (const id of ["connect-shopee", "other-platforms"]) {
      const row = rowOf(live, id);
      expect(row, id).toMatch(/beta/i);
      const [, title] = row.match(/^ {2}\('[^']+', '([^']*)'/)!;
      const fixedTitle = title === "Shopee Live (beta)" ? "Shopee Live" : title;
      const body = row.slice(row.lastIndexOf("', '") + 4);                 // the body is the last field
      expect(`${fixedTitle}\n${apply(body)}`, id).not.toMatch(/beta/i);
    }
  });
  it("the new words are the guide's words (docs/support/sfl-guide.md = sql/116b), with no 'beta' left to read", () => {
    // the first three phrases are in the row production has today (kept as sql/207's rollback); the guide's
    // Shopee section was rewritten after that (sql/207, 2026-11-23 — Shopee for every plan)
    const liveShopee = readFileSync("sql/207_guide_shopee_public_rollback.sql", "utf8");
    for (const [, n] of PAIRS.slice(0, 3)) expect(liveShopee).toContain(sq(n));
    expect(guide).toContain(PAIRS[3][1]);
    expect(guide).toContain("**Shopee** opens your Shopee shops.");
    expect(guide).toContain("## connect-shopee — Shopee Live\n");
    for (const id of ["connect-shopee", "other-platforms", "general-settings"]) {
      const row = rowOf(seed, id);
      const body = row.slice(row.lastIndexOf("', '") + 4);
      expect(body, id).not.toMatch(/beta/i);
    }
    // the search keyword stays (never shown)
    expect(rowOf(seed, "connect-shopee")).toContain("copy link, beta, paste link");
  });
});
