// BLACKLIST — the SQL files (contract). Behaviour on a real Postgres: scripts/sql190-behaviour.mjs (PGlite).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { after207, rowOfFile } from "./guideSql207";

const up = readFileSync("sql/190_buyer_blacklist.sql", "utf8");
const down = readFileSync("sql/190_buyer_blacklist_rollback.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const U = code(up);

describe("sql/190 — one table, own rows only", () => {
  it("the files", () => {
    expect(readdirSync("sql").filter((f) => f.startsWith("190_")).sort()).toEqual(["190_buyer_blacklist.sql", "190_buyer_blacklist_rollback.sql"]);
    expect(readdirSync("sql").filter((f) => f.startsWith("191_")).sort()).toEqual(["191_guide_blacklist.sql", "191_guide_blacklist_rollback.sql"]);
  });
  it("row level security on; select / insert / delete by the seller's own id; NO update, NO admin rule", () => {
    expect(U).toContain("alter table public.buyer_blacklist enable row level security;");
    expect(U).toContain("for select to authenticated using (user_id = (select auth.uid()))");
    expect(U).toContain("for insert to authenticated with check (user_id = (select auth.uid()))");
    expect(U).toContain("for delete to authenticated using (user_id = (select auth.uid()))");
    expect(U.match(/create policy/g)).toHaveLength(3);
    expect(U).not.toMatch(/for update/);
    expect(U).not.toMatch(/is_admin/);
    expect(U).toContain("revoke all on table public.buyer_blacklist from public, anon;");
    expect(U).toContain("grant select, insert, delete on table public.buyer_blacklist to authenticated;");
    expect(U).not.toMatch(/grant [^;]*update[^;]*buyer_blacklist/);
    expect(U).not.toMatch(/to anon/);
  });
  it("same buyer + same reason once per seller-local day — enforced by the database", () => {
    expect(U).toContain("add constraint buyer_blacklist_once_a_day      unique (user_id, platform, buyer_key, reason, added_day)");
    expect(U).toContain("on conflict on constraint buyer_blacklist_once_a_day do nothing");
    expect(U).toContain("raise exception 'blacklist_bad_day'");
  });
  it("both seller functions run as the seller (row level security applies), visitors cannot call them", () => {
    for (const f of ["blacklist_add", "blacklist_remove"]) {
      const body = U.slice(U.indexOf(`function public.${f}(`));
      expect(body.slice(0, body.indexOf("as $$"))).toContain("security invoker");
      expect(U).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon;`));
    }
    // the only security-definer function in the file is my_feature_access (unchanged shape)
    expect(U.match(/security definer/gi)).toHaveLength(1);
  });
  it("the switch row starts 'false' and is never overwritten; the tester key = the live list + 'blacklist'", () => {
    expect(U).toContain("insert into public.app_settings (key, value) values ('blacklist_enabled', 'false')\non conflict (key) do nothing;");
    const keys = (s: string) => [...s.slice(s.indexOf("keys(k) as")).matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
    expect(keys(down)).toHaveLength(25);
    expect(keys(up)).toEqual([...keys(down), "blacklist"]);
  });
  it("rollback removes the table, the functions, the switch and the testers", () => {
    const D = code(down);
    for (const s of [
      "delete from public.app_settings where key = 'blacklist_enabled';", "delete from public.feature_access_emails where feature = 'blacklist';",
      "drop table if exists public.buyer_blacklist;", "drop function if exists public.blacklist_add(text, text, text, text);",
      "drop function if exists public.blacklist_remove(text, text);",
    ]) expect(D).toContain(s);
  });
});

describe("sql/191 — ONE help-guide row", () => {
  const g = readFileSync("sql/191_guide_blacklist.sql", "utf8");
  const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
  const tupleOf = (id: string, next: string) => { const a = seed.indexOf(`  ('${id}',`); return seed.slice(a, seed.indexOf(`),\n  ('${next}'`, a) + 1); };
  it("its row + sql/207's swap (native scanner, 2026-11-22) = the blacklist row of sql/116b (= the guide file), and nothing else", () => {
    const row = tupleOf("blacklist", "raffle-games");
    expect(row.length).toBeGreaterThan(500);
    const own = rowOfFile(g, "blacklist");
    expect(own).not.toBe(row); // sql/207 really changes it
    expect(after207("blacklist", own)).toBe(row);
    expect(g).toContain(`${own}\non conflict (id) do update set`);
    expect(g.match(/^ {2}\('/gm)).toHaveLength(1);
    expect(code(g)).not.toMatch(/delete from/);
  });
  it("tells sellers the QR needs Print QR on sticker and a sticker taller than 40 mm, else type the name", () => {
    const row = tupleOf("blacklist", "raffle-games");
    expect(row).toContain("**Print QR on sticker** is on and the sticker is taller than 40 mm. Otherwise type the name.");
    expect(row).toContain("sellers outside Taiwan");
  });
  it("rollback deletes only that row", () => {
    const r = code(readFileSync("sql/191_guide_blacklist_rollback.sql", "utf8"));
    expect(r).toContain("delete from public.support_guide where id = 'blacklist';");
    expect(r.match(/delete from/g)).toHaveLength(1);
  });
});
