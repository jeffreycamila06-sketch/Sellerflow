// sql/201 — the five help-guide rows of sql/199's release (2026-11-22): word for word sql/116b's rows, seller words
// only; the rollback puts back the LIVE rows (checked by md5 on production 2026-11-22).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const IDS = ["general-settings", "account-limit", "connect-shopee", "manage-accounts", "other-platforms"];
const up = readFileSync("sql/201_guide_account_limits_v2.sql", "utf8");
const down = readFileSync("sql/201_guide_account_limits_v2_rollback.sql", "utf8");
const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
const rowOf = (s: string, id: string) => { const a = s.indexOf(`  ('${id}',`); const b = s.indexOf("),\n  ('", a); return s.slice(a, b < 0 ? s.indexOf(")\non conflict", a) + 1 : b + 1); };
// the five quoted values of a row, '' → '
const valuesOf = (row: string) => { const out: string[] = []; let j = 0; for (let f = 0; f < 5; f++) { while (row[j] !== "'") j++; let k = j + 1, v = ""; for (;;) { if (row[k] === "'" && row[k + 1] === "'") { v += "'"; k += 2; continue; } if (row[k] === "'") break; v += row[k++]; } out.push(v); j = k + 1; } return out; };
const md5 = (x: string) => createHash("md5").update(x).digest("hex");
const code = (s: string) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("sql/201 — the account-limits guide rows", () => {
  it("files 201 (+ rollback) only; NOT applied; five rows; safe to run twice", () => {
    expect(readdirSync("sql").filter((f) => /^201_/.test(f)).sort()).toEqual(["201_guide_account_limits_v2.sql", "201_guide_account_limits_v2_rollback.sql"]);
    expect(up).toMatch(/NOT APPLIED/);
    for (const s of [up, down]) {
      expect(s.match(/^ {2}\('/gm)).toHaveLength(5);
      expect(s).toContain("is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body)");
      expect(code(s)).not.toMatch(/delete from|drop |alter |create /);
    }
  });
  it("each row = sql/116b's row (= docs/support/sfl-guide.md), checked 2026-11-22", () => {
    // connect-shopee moved on after this file (sql/207, 2026-11-23 — Shopee for every plan): its sql/201 row is
    // the text production has today, kept word for word as sql/207's rollback.
    const s207down = readFileSync("sql/207_guide_shopee_public_rollback.sql", "utf8");
    const one = (s: string) => { const a = s.indexOf("  ('connect-shopee',"); return s.slice(a, s.indexOf(")\non conflict", a) + 1); };
    // account-limit and manage-accounts moved on too (sql/217, 2026-11-25 — Free plan: no 4-hour lock): their
    // sql/201 rows are the text production has today, kept word for word as sql/217's rollback.
    const s217down = readFileSync("sql/217_guide_free_no_account_lock_rollback.sql", "utf8");
    for (const id of IDS) {
      if (id === "connect-shopee") expect(rowOf(up, id)).toBe(one(s207down));
      else if (id === "account-limit" || id === "manage-accounts") expect(rowOf(up, id)).toBe(rowOf(s217down, id));
      else expect(rowOf(up, id)).toBe(rowOf(seed, id));
      expect(rowOf(up, id)).toContain("'2026-11-22'::date");
    }
  });
  it("says what the seller sees, in seller words only", () => {
    const text = IDS.map((id) => rowOf(up, id)).join("\n");
    for (const s of ["**Plan full**", "**End your live first**", "**Upgrade plan**", "**Contact Admin**", "4 hours", "Each Shopee shop counts as one account", "**Shopee shops**", "four boxes"]) expect(text).toContain(s);
    expect(text).not.toMatch(/shopee_account_enforce|account_limits_v2|preview|\buid\b|database|server|sql|seat/i);
  });
  it("the rollback = the live rows (md5 checked on production 2026-11-22)", () => {
    const LIVE: Record<string, [string, string, string]> = {
      "general-settings": ["2026-11-19", "b4beb45a2858101019e1fbf65b2015d4", "a1c2cac1ae7a771bf4068dc777889db5"],
      "account-limit": ["2026-10-11", "50fc030b319417501b0bf2774a9b860a", "2ee5b0a6fe9fd46afc8f0c925fe7ce58"],
      "connect-shopee": ["2026-11-22", "e6d966a98cab3d4a834ae2b2c83e9c9c", "d7dce1bdfa2f3f50c708e77a59402423"],
      "manage-accounts": ["2026-10-11", "1ad4ef2a5d636f90ca41a70f68eec514", "d1c03858a865871ada471fbb8da53524"],
      "other-platforms": ["2026-10-27", "cf5337b798a1d97ac9bb833d68868728", "750d9061daf700291aeffb7b60a22b91"],
    };
    for (const id of IDS) {
      const [, , date, kw, body] = valuesOf(rowOf(down, id));
      expect([date, md5(kw), md5(body)], id).toEqual(LIVE[id]);
    }
  });
});
