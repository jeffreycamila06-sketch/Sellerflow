// sql/180 — "Choose price before print" table: the text of the file (what it promises). The
// behaviour itself is proven on a real Postgres by scripts/sql180-behaviour.mjs (not part of CI).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(`sql/${f}`, "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const up = code(read("180_choose_price.sql"));
const down = code(read("180_choose_price_rollback.sql"));

describe("sql/180 contract", () => {
  it("add-only: one new table + one helper function, in one transaction; nothing existing is altered or dropped", () => {
    expect(up.trimStart().startsWith("begin;")).toBe(true);
    expect(up.trimEnd().endsWith("commit;")).toBe(true);
    expect(up).toContain("create table if not exists public.seller_price_choices");
    expect(up).toContain("create or replace function public.seller_price_choices_distinct(p numeric[])");
    for (const m of up.matchAll(/alter table (\S+)/g)) expect(m[1]).toBe("public.seller_price_choices");
    expect(up).not.toMatch(/drop table|drop function|seller_same_price|truncate|delete from/);
    expect(up).toContain("enabled    boolean not null default false");     // nobody is switched on by the file
  });
  it("the database refuses a bad list: max 6, flat, no empty entry, all above 0, no duplicates, ON needs a price", () => {
    for (const c of ["prices_max6", "prices_flat", "prices_no_null", "prices_positive", "prices_distinct", "on_needs_price"]) {
      expect(up, c).toContain(`drop constraint if exists seller_price_choices_${c};`);
      expect(up, c).toMatch(new RegExp(`add constraint seller_price_choices_${c}\\s+check \\(`));
    }
    expect(up).toContain("check (cardinality(prices) <= 6)");
    expect(up).toContain("check (array_position(prices, null) is null)");
    expect(up).toContain("check (0 < all (prices))");
    expect(up).toContain("check (not enabled or cardinality(prices) >= 1)");
  });
  it("own row only, signed-in sellers only: 3 policies `to authenticated`, each dropped first; no delete; nothing for visitors", () => {
    expect(up).toContain("enable row level security");
    for (const p of ["select", "insert", "update"]) {
      expect(up).toContain(`drop policy if exists price_choices_${p} on public.seller_price_choices;`);
      expect(up).toMatch(new RegExp(`create policy price_choices_${p} on public\\.seller_price_choices\\s+for ${p} to authenticated`));
    }
    expect((up.match(/create policy/g) || []).length).toBe(3);
    expect(up).not.toMatch(/for delete|for all/);
    expect((up.match(/user_id = \(select auth\.uid\(\)\)/g) || []).length).toBe(4);   // select, insert, update using + check
    expect(up).toContain("revoke all on table public.seller_price_choices from public, anon;");
    expect(up).toContain("grant select, insert, update on table public.seller_price_choices to authenticated;");
    expect(up).not.toMatch(/grant [^;]*\b(delete|all)\b[^;]* to/);
    expect(up).not.toMatch(/to anon|to public/);
  });
  it("the rollback removes exactly what the file added", () => {
    expect(down).toContain("drop table if exists public.seller_price_choices;");
    expect(down).toContain("drop function if exists public.seller_price_choices_distinct(numeric[]);");
    expect((down.match(/drop /g) || []).length).toBe(2);
  });
  it("the app writes only what the table takes: user_id, enabled, prices, updated_at", () => {
    const hook = readFileSync("src/redesign/adapters/useChoosePrice.ts", "utf8");
    expect(hook).toContain(".upsert({ user_id: uid, enabled: nextEnabled, prices: nextPrices, updated_at: new Date().toISOString() })");
    expect(hook).toContain('.from("seller_price_choices")');
    expect(hook).not.toContain(".delete(");
  });
});
