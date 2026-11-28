// sql/238 (+ rollback) — up to 12 prices: prices 10–12 in a NEW column prices_extra; sql/239 — the help-guide row.
// Text pins. The behaviour on a real Postgres (old-app saves never touch prices_extra, every old Settings
// action, the checks, the refused rollback) is proven by scripts/sql238-behaviour.mjs (PGlite, not in CI).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { MAX_CHOICE_PRICES, PRICES_COLUMN_MAX, MORE_COLUMN_END } from "../useChoosePrice";

const read = (f: string) => readFileSync(`sql/${f}`, "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const UP = code(read("238_choose_price_twelve.sql"));
const DOWN = code(read("238_choose_price_twelve_rollback.sql"));
const stmts = (s: string) => s.split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x && !/^(begin|commit|set local lock_timeout = '2s')$/.test(x));

describe("sql/238 — one new column, nothing existing changed", () => {
  it("files 238 (+ rollback) only; NOT applied; one transaction with a lock limit", () => {
    expect(readdirSync("sql").filter((f) => /^238_/.test(f)).sort()).toEqual(["238_choose_price_twelve.sql", "238_choose_price_twelve_rollback.sql"]);
    expect(read("238_choose_price_twelve.sql")).toMatch(/NOT APPLIED/);
    for (const s of [UP, DOWN]) {
      expect(s.trimStart().startsWith("begin;\nset local lock_timeout = '2s';")).toBe(true);
      expect(s.trimEnd().endsWith("commit;")).toBe(true);
    }
  });
  it("adds prices_extra (empty list, never null) and its five checks; prices / prices_more and their checks are not touched", () => {
    expect(stmts(UP)).toEqual([
      "alter table public.seller_price_choices add column if not exists prices_extra numeric[] not null default '{}'",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_max3",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_flat",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_no_null",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_positive",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_all3_distinct",
      "alter table public.seller_price_choices add constraint seller_price_choices_extra_max3 check (cardinality(prices_extra) <= 3), " +
        "add constraint seller_price_choices_extra_flat check (coalesce(array_ndims(prices_extra), 1) = 1), " +
        "add constraint seller_price_choices_extra_no_null check (array_position(prices_extra, null) is null), " +
        "add constraint seller_price_choices_extra_positive check (0 < all (prices_extra)), " +
        "add constraint seller_price_choices_all3_distinct check (public.seller_price_choices_distinct(prices || prices_more || prices_extra))",
    ]);
    expect(UP).not.toMatch(/prices_max6|more_max3|_all_distinct|update |delete |truncate|policy|grant|revoke|drop column|drop table/);
  });
});

describe("sql/238 rollback — refused while any seller has a 10th–12th price", () => {
  it("locks the table FIRST, then counts and refuses with nothing changed", () => {
    const lock = DOWN.indexOf("lock table public.seller_price_choices in access exclusive mode;");
    const count = DOWN.indexOf("execute 'select count(*) from public.seller_price_choices where cardinality(prices_extra) > 0' into n;");
    const raise = DOWN.indexOf("raise exception 'sql/238 rollback refused: % seller(s) have a 10th-12th price — nothing was changed', n;");
    const drop = DOWN.indexOf("drop column if exists prices_extra");
    expect(lock).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(lock);
    expect(raise).toBeGreaterThan(count);
    expect(drop).toBeGreaterThan(raise);
  });
  it("then removes only the column and the five checks", () => {
    expect(stmts(DOWN.slice(DOWN.indexOf("end $$;") + 7))).toEqual([
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_all3_distinct",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_positive",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_no_null",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_flat",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_extra_max3",
      "alter table public.seller_price_choices drop column if exists prices_extra",
    ]);
    expect(DOWN).not.toMatch(/prices_more|drop table|update |delete from/);
  });
});

describe("the app and the three columns agree", () => {
  it("12 = 6 in prices + 3 in prices_more + 3 in prices_extra", () => {
    expect(PRICES_COLUMN_MAX).toBe(6);
    expect(MORE_COLUMN_END - PRICES_COLUMN_MAX).toBe(3);
    expect(read("196_choose_price_nine.sql")).toContain("check (cardinality(prices_more) <= 3)");
    expect(UP).toContain("check (cardinality(prices_extra) <= 3)");
    expect(MAX_CHOICE_PRICES).toBe(MORE_COLUMN_END + 3);
  });
});

describe("sql/239 — the Choose price guide row, a phrase swap", () => {
  const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
  const a = seed.indexOf("  ('choose-price',");
  const row116 = seed.slice(a, seed.indexOf("),\n  ('", a) + 1);
  const up = read("239_guide_choose_price_twelve.sql");
  const down = read("239_guide_choose_price_twelve_rollback.sql");
  const OLD = "Under the switch, add up to 9 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 9 prices saved, remove one to add a new price.";
  const NEW = "Under the switch, add up to 12 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 12 prices saved, remove one to add a new price.";
  it("the live row (= sql/197, applied) with the swap = the choose-price row of sql/116b, word for word", () => {
    const s197 = read("197_guide_choose_price_nine.sql");
    const b = s197.indexOf("  ('choose-price',");
    const row197 = s197.slice(b, s197.indexOf("\non conflict", b));
    expect(row197.length).toBeGreaterThan(1500);
    expect(row197.split(OLD)).toHaveLength(2);                       // the old sentence is there once
    expect(row197.replace(OLD, NEW).replace("'2026-11-21'::date", "'2026-11-28'::date")).toBe(row116);
  });
  it("one row, runs only where the old sentence is found (twice = no change); NOT applied; user words only", () => {
    expect(code(up).match(/update public\.support_guide/g)).toHaveLength(1);
    expect(up).toContain("where id = 'choose-price'");
    expect(up).toContain(`and position('${OLD}' in body) > 0;`);
    expect(up).toContain(`replace(body, '${OLD}', '${NEW}')`);
    expect(up).toContain("greatest(checked, '2026-11-28'::date)");
    expect(up).toMatch(/NOT APPLIED/);
    expect(NEW).not.toMatch(/column|database|prices_extra/);
    expect(code(up)).not.toMatch(/delete from|insert into/);
  });
  it("the rollback swaps it back, only where the new sentence is found", () => {
    expect(down).toContain(`replace(body, '${NEW}', '${OLD}')`);
    expect(down).toContain(`and position('${NEW}' in body) > 0;`);
    expect(code(down).match(/update public\.support_guide/g)).toHaveLength(1);
  });
});
