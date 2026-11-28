// sql/196 (+ rollback) — up to 9 prices: prices 7–9 in a NEW column prices_more; sql/197 — the help-guide row.
// Text pins. The behaviour on a real Postgres (old-app saves never touch prices_more, every old Settings
// action, the checks, the refused rollback) is proven by scripts/sql196-behaviour.mjs (PGlite, not in CI).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { MAX_CHOICE_PRICES, PRICES_COLUMN_MAX, splitForSave, joinStoredPrices } from "../useChoosePrice";

const read = (f: string) => readFileSync(`sql/${f}`, "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const UP = code(read("196_choose_price_nine.sql"));
const DOWN = code(read("196_choose_price_nine_rollback.sql"));
const stmts = (s: string) => s.split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x && !/^(begin|commit|set local lock_timeout = '2s')$/.test(x));

describe("sql/196 — one new column, nothing existing changed", () => {
  it("files 196 (+ rollback) only; NOT applied; one transaction with a lock limit", () => {
    expect(readdirSync("sql").filter((f) => /^196_/.test(f)).sort()).toEqual(["196_choose_price_nine.sql", "196_choose_price_nine_rollback.sql"]);
    expect(read("196_choose_price_nine.sql")).toMatch(/NOT APPLIED/);
    for (const s of [UP, DOWN]) {
      expect(s.trimStart().startsWith("begin;\nset local lock_timeout = '2s';")).toBe(true);
      expect(s.trimEnd().endsWith("commit;")).toBe(true);
    }
  });
  it("adds prices_more (empty list, never null) and its five checks; the prices column and its 6-check are not touched", () => {
    expect(stmts(UP)).toEqual([
      "alter table public.seller_price_choices add column if not exists prices_more numeric[] not null default '{}'",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_max3",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_flat",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_no_null",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_positive",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_all_distinct",
      "alter table public.seller_price_choices add constraint seller_price_choices_more_max3 check (cardinality(prices_more) <= 3), " +
        "add constraint seller_price_choices_more_flat check (coalesce(array_ndims(prices_more), 1) = 1), " +
        "add constraint seller_price_choices_more_no_null check (array_position(prices_more, null) is null), " +
        "add constraint seller_price_choices_more_positive check (0 < all (prices_more)), " +
        "add constraint seller_price_choices_all_distinct check (public.seller_price_choices_distinct(prices || prices_more))",
    ]);
    expect(UP).not.toMatch(/prices_max6|update |delete |truncate|policy|grant|revoke|drop column|drop table/);
  });
});

describe("sql/196 rollback — refused while any seller has a 7th–9th price", () => {
  it("locks the table FIRST, then counts and refuses with nothing changed", () => {
    const lock = DOWN.indexOf("lock table public.seller_price_choices in access exclusive mode;");
    const count = DOWN.indexOf("execute 'select count(*) from public.seller_price_choices where cardinality(prices_more) > 0' into n;");
    const raise = DOWN.indexOf("raise exception 'sql/196 rollback refused: % seller(s) have a 7th-9th price — nothing was changed', n;");
    const drop = DOWN.indexOf("drop column if exists prices_more");
    expect(lock).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(lock);
    expect(raise).toBeGreaterThan(count);
    expect(drop).toBeGreaterThan(raise);
  });
  it("then removes only the column and the five checks (safe when they are already gone)", () => {
    const drops = stmts(DOWN.slice(DOWN.indexOf("end $$;") + 7));
    expect(drops).toEqual([
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_all_distinct",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_positive",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_no_null",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_flat",
      "alter table public.seller_price_choices drop constraint if exists seller_price_choices_more_max3",
      "alter table public.seller_price_choices drop column if exists prices_more",
    ]);
    expect(DOWN).not.toMatch(/prices_max6|drop table|update |delete from/);
  });
});

describe("the app and the two columns agree", () => {
  it("9 = 6 in prices (sql/180) + 3 in prices_more (sql/196); since sql/238 + 3 in prices_extra = 12", () => {
    expect(read("180_choose_price.sql")).toContain("check (cardinality(prices) <= 6)");
    expect(PRICES_COLUMN_MAX).toBe(6);
    expect(MAX_CHOICE_PRICES).toBe(6 + 3 + 3);
  });
  it("split: 1–6 → prices only, NO prices_more key (the request sent before); 7–9 → both; 7 → 6 sends an empty prices_more", () => {
    // (the third column, prices_extra, stays out of every request of 9 or fewer: extra null)
    expect(splitForSave([39, 59], [39])).toEqual({ prices: [39, 59], more: null, extra: null });
    expect(splitForSave([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5])).toEqual({ prices: [1, 2, 3, 4, 5, 6], more: null, extra: null });
    expect(splitForSave([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6])).toEqual({ prices: [1, 2, 3, 4, 5, 6], more: [7], extra: null });
    expect(splitForSave([1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({ prices: [1, 2, 3, 4, 5, 6], more: [7, 8, 9], extra: null });
    expect(splitForSave([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6, 7])).toEqual({ prices: [1, 2, 3, 4, 5, 6], more: [], extra: null });
  });
  it("join: prices then prices_more, cleaned (no duplicate, nothing above 12); a missing column = nothing extra", () => {
    expect(joinStoredPrices([1, 2, 3, 4, 5, 6], [7, 8, 9])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(joinStoredPrices([1, 2, 3], undefined)).toEqual([1, 2, 3]);
    expect(joinStoredPrices([1, 2, 3, 4, 5], [5, 7])).toEqual([1, 2, 3, 4, 5, 7]);
    expect(joinStoredPrices(null, [7])).toEqual([7]);
    expect(joinStoredPrices([1, 2, 3, 4, 5, 6], [7, 8, 9, 10])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);   // the list rule cuts at 12, the column checks at 3
    expect(joinStoredPrices([1, 2, 3, 4, 5, 6], [7, 8, 9], [10, 11, 12, 13])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

// sql/197 is APPLIED; since sql/239 the guide (and sql/116b) say "up to 12". sql/197's own text is
// unchanged; the check below compares it with the 116b row put back to its 9-price words.
describe("sql/197 — the Choose price guide row", () => {
  const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
  const a = seed.indexOf("  ('choose-price',");
  const row = seed.slice(a, seed.indexOf("),\n  ('", a) + 1)
    .replace("add up to 12 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 12 prices saved, remove one to add a new price.", "add up to 9 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 9 prices saved, remove one to add a new price.")
    .replace("'2026-11-28'::date", "'2026-11-21'::date");
  const up = read("197_guide_choose_price_nine.sql");
  const down = read("197_guide_choose_price_nine_rollback.sql");
  it("word for word the choose-price row of sql/116b, one row only, safe to run twice", () => {
    expect(row.length).toBeGreaterThan(1500);
    expect(up).toContain(`${row}\non conflict (id) do update set`);
    expect(up.match(/^ {2}\('/gm)).toHaveLength(1);
    expect(up).toContain("is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body)");
    expect(code(up)).not.toMatch(/delete from/);
  });
  it("it says up to 9 and how to add one when 9 are saved (user words only)", () => {
    expect(row).toContain("add up to 9 prices. The first one is the default. Tap ☆ to make a price the default, or × to remove it. With 9 prices saved, remove one to add a new price.");
    expect(row).toContain("'2026-11-21'::date");
    expect(row).not.toMatch(/up to 6|prices_more|column|database/);
  });
  it("the rollback puts back the live row (checked 2026-11-19, up to 6)", () => {
    expect(down.match(/^ {2}\('/gm)).toHaveLength(1);
    expect(down).toContain("('choose-price', 'Choose price before print', '2026-11-19'::date");
    expect(down).toContain("add up to 6 prices.");
    expect(down).toContain("body md5 f7c9c81b21ec59d2a99d2745646abb2e");
  });
});
