// sql/185 (+ rollback) — text pins. The behaviour itself is proven on a throw-away database by
// scripts/sql185-behaviour.mjs (PGlite); these pins catch an edit of the file that the script would
// only see when someone runs it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const sqlDir = "sql/";
const read = (f: string) => readFileSync(sqlDir + f, "utf8");
const FILE = read("185_fm_site_answer.sql");
const BACK = read("185_fm_site_answer_rollback.sql");
const S151 = read("151_fm_pickup_check.sql");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
// the text of one function definition: from its "create or replace" to the closing $function$;
const fn = (s: string, name: string) => {
  const at = s.indexOf(`create or replace function public.${name}(`);
  if (at < 0) return null;
  const end = s.indexOf("$function$;", s.indexOf("$function$", at) + 10);
  return s.slice(at, end + "$function$;".length);
};
const KEEPS = "public.fm_upload_keeps(t.status, t.fm_answered_at, excluded.status)";
const STAYS = "public.fm_upload_stays_out(t.terminal, t.status, t.fm_site_state, excluded.status)";

describe("sql/185 — the file", () => {
  it("is number 185, with its rollback; no other file uses that number; NOT applied", () => {
    expect(readdirSync(sqlDir).filter((f) => f.startsWith("185_")).sort()).toEqual(["185_fm_site_answer.sql", "185_fm_site_answer_rollback.sql"]);
    expect(FILE).toMatch(/NOT APPLIED/);
  });
  it("one transaction with a lock limit", () => {
    expect(code(FILE)).toMatch(/^begin;\nset local lock_timeout = '5s';/m);
    expect(code(FILE).trim().endsWith("commit;")).toBe(true);
    expect(code(BACK)).toMatch(/^begin;\nset local lock_timeout = '5s';/m);
    expect(code(BACK).trim().endsWith("commit;")).toBe(true);
  });
  it("the saved answer: one nullable text column that holds only the two words", () => {
    expect(code(FILE)).toContain("alter table public.parcel_tracking add column fm_site_state text;");
    expect(code(FILE)).toContain("check (fm_site_state is null or fm_site_state in ('not_found', 'not_dropped')) not valid;");
    expect(code(FILE)).toContain("validate constraint parcel_tracking_fm_site_state_check;");
    expect(code(FILE)).not.toMatch(/fm_site_state text (not null|default)/);
    // no grant to the browser: sellers keep the 8 columns of sql/42
    expect(code(FILE)).not.toMatch(/grant\s+(insert|update)[^;]*parcel_tracking/i);
  });
});

describe("sql/185 — the upload = sql/151 with the two additions, nothing else", () => {
  const before = fn(S151, "fm_pickup_upload")!;
  const after = fn(FILE, "fm_pickup_upload")!;
  it("both found", () => { expect(before).toBeTruthy(); expect(after).toBeTruthy(); });
  it("every keep-condition also keeps a parcel that left while the file still says in transit", () => {
    expect(before.split(KEEPS).length - 1).toBe(6);
    expect(after.split(`${KEEPS} or ${STAYS}`).length - 1).toBe(6);
  });
  it("the saved answer is cleared when the file shows progress", () => {
    expect(after).toContain("fm_site_state   = case when excluded.status = 'in_transit' then t.fm_site_state else null end");
  });
  it("apart from those, the text is sql/151's word for word", () => {
    const back = after
      .split(` or ${STAYS}`).join("")
      .replace(",\n      fm_site_state   = case when excluded.status = 'in_transit' then t.fm_site_state else null end", "");
    expect(back).toBe(before);
  });
  it("the helper: true only for a finished in-transit parcel with a saved answer while the file says in transit", () => {
    expect(code(FILE)).toContain("select coalesce(p_terminal, false) and p_status = 'in_transit' and p_site_state is not null\n     and p_new_status = 'in_transit';");
    expect(code(FILE)).toMatch(/fm_upload_stays_out\(p_terminal boolean, p_status text, p_site_state text, p_new_status text\)\n returns boolean\n language sql\n immutable/);
  });
});

describe("sql/185 — parcels that left are deleted 30 days later, never anything else", () => {
  it("only finished 全家 in-transit rows with a saved answer, checked 30+ days ago; no browser may call it", () => {
    const purge = code(FILE).slice(code(FILE).indexOf("create function public.purge_left_fm_parcels"));
    expect(purge).toContain("where t.terminal\n                     and t.carrier = 'fm'\n                     and t.status = 'in_transit'\n                     and t.fm_site_state is not null\n                     and t.last_polled_at < now() - interval '30 days'");
    expect(code(FILE)).toContain("revoke all on function public.purge_left_fm_parcels(integer) from public, anon, authenticated;");
    expect(code(FILE)).toContain("select cron.schedule('purge-left-fm-parcels', '27 17 * * *', $cron$");
  });
  it("its own time, apart from the 7-11 job (17:25 UTC)", () => {
    expect(code(FILE)).not.toContain("'25 17 * * *'");
  });
});

describe("sql/185 — run counts and the rollback", () => {
  it("three nullable count columns on the health table", () => {
    expect(code(FILE)).toContain("alter table public.parcel_tracking_health\n  add column fm_not_found integer,\n  add column fm_not_shipped integer,\n  add column fm_left integer;");
  });
  it("the rollback: job off, parcels that left back in the list (nothing deleted), sql/151's upload word for word, everything new dropped", () => {
    const b = code(BACK);
    expect(b).toContain("select cron.unschedule('purge-left-fm-parcels');");
    expect(b).toContain("update public.parcel_tracking\n   set terminal = false\n where carrier = 'fm' and terminal and status = 'in_transit' and fm_site_state is not null;");
    // no row is deleted (the only delete left is the upload's own "hide" line inside sql/151's function)
    expect(b.replace(fn(BACK, "fm_pickup_upload")!, "")).not.toMatch(/delete from/i);
    expect(fn(BACK, "fm_pickup_upload")).toBe(fn(S151, "fm_pickup_upload"));
    for (const s of [
      "drop function public.purge_left_fm_parcels(integer);",
      "drop function public.fm_upload_stays_out(boolean, text, text, text);",
      "drop column fm_site_state",
      "drop column fm_not_found", "drop column fm_not_shipped", "drop column fm_left",
    ]) expect(b, s).toContain(s);
    // the parcels go back in the list BEFORE the column that marks them is dropped
    expect(b.indexOf("set terminal = false")).toBeLessThan(b.indexOf("drop column fm_site_state"));
  });
});

describe("sql/186 — the help guide row (Pickup Status), NOT applied", () => {
  const G = read("186_guide_fm_not_dropped.sql");
  const GB = read("186_guide_fm_not_dropped_rollback.sql");
  const guide = readFileSync("docs/support/sfl-guide.md", "utf8");
  const section = guide.slice(guide.indexOf("## pickup-status — Pickup Status"), guide.indexOf("## buyer-alert"));
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
  it("one row only, the guide file's text, with today's date", () => {
    expect(G).toMatch(/NOT APPLIED/);
    expect(code(G).match(/^ {2}\('/gm)).toHaveLength(1);
    expect(G).toContain("('pickup-status', 'Pickup Status', '2026-11-19'::date,");
    expect(section).toContain("Last checked: 2026-11-19");
    for (const line of section.split("\n").filter((l) => l.startsWith("- Some 全家 parcels") || l.startsWith("- When such a parcel"))) {
      expect(G).toContain(lit(line).slice(1, -1));
    }
    expect(code(G)).not.toMatch(/delete from/i);
  });
  it("user words only: no table, column, rule or server word", () => {
    for (const w of ["fm_site_state", "terminal", "server", "database", "sql", "not_found", "not_dropped", "cron", "Taipei"]) expect(section.toLowerCase(), w).not.toContain(w.toLowerCase());
  });
  it("the rollback is the live row of before (checked 2026-11-17, read 2026-11-19)", () => {
    expect(GB).toContain("('pickup-status', 'Pickup Status', '2026-11-17'::date,");
    expect(GB).toContain("body md5 292c0bcddaac384d997eed433695b35f");
    expect(GB).not.toContain("No record yet");
  });
});
