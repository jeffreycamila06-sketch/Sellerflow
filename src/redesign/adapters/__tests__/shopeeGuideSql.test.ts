// sql/198 — the Shopee Live (beta) help-guide row (2026-11-22): word for word sql/116b's row, one row only,
// user words only; the rollback puts back the LIVE row (checked on production 2026-11-22).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
const a = seed.indexOf("  ('connect-shopee',");
const row = seed.slice(a, seed.indexOf("),\n  ('", a) + 1);
const up = readFileSync("sql/198_guide_shopee_connect.sql", "utf8");
const down = readFileSync("sql/198_guide_shopee_connect_rollback.sql", "utf8");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("sql/198 — the Shopee Live (beta) guide row", () => {
  it("files 198 (+ rollback) only; NOT applied; one row; safe to run twice", () => {
    expect(readdirSync("sql").filter((f) => /^198_/.test(f)).sort()).toEqual(["198_guide_shopee_connect.sql", "198_guide_shopee_connect_rollback.sql"]);
    expect(up).toMatch(/NOT APPLIED/);
    expect(up).toContain(`${row}\non conflict (id) do update set`);
    for (const s of [up, down]) {
      expect(s.match(/^ {2}\('/gm)).toHaveLength(1);
      expect(s).toContain("is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body)");
      expect(code(s)).not.toMatch(/delete from|drop |alter |create /);
    }
  });
  it("says what the seller sees: Connecting…, ✓ Connected, the remembered link, the five stop messages", () => {
    expect(row).toContain("'2026-11-22'::date");
    for (const s of ["**Connecting…**", "**✓ Connected**", "Last link used. Paste a new one for a new live.",
      "Your Shopee live has ended.", "Shopee stopped answering. Tap Connect to try again.", "Shopee was connected on another device.",
      "Connection was reset. Tap Connect to continue.", "Shopee live reached the time limit. Tap Connect to continue."]) expect(row).toContain(s);
    expect(row).not.toMatch(/localStorage|session_end|restart|reason|socket|server/i);
  });
  it("the rollback is the live row: checked 2026-10-27, same keywords/body as main's 116b", () => {
    expect(down).toContain("('connect-shopee', 'Shopee Live (beta)', '2026-10-27'::date");
    expect(down).toContain("body md5 ac36a11aa3bcb15cc1f11972c9199539");
    expect(down).not.toContain("✓ Connected");
  });
});
