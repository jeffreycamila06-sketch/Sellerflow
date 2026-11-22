// sql/192 — ONE help-guide row (Parcel Scan): Scan QR shows only one sticker. Its row + sql/204's
// phrase swap (native scanner, 2026-11-22) = the parcel-scan row of sql/116b (= docs/support/sfl-guide.md);
// the rollback = the live row before it. sql/191 (Blacklist) carries the same "2 stickers" line in its own row.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { after204, rowOfFile } from "./guideSql204";

const seed = readFileSync("sql/116b_guide_seed.sql", "utf8");
const tupleOf = (id: string) => { const a = seed.indexOf(`  ('${id}',`); return seed.slice(a, seed.indexOf("\n  ('", a + 5) > 0 ? seed.indexOf("),\n  ('", a) + 1 : seed.indexOf(")\non conflict", a) + 1); };
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("sql/192 — the Parcel Scan guide row", () => {
  const up = readFileSync("sql/192_guide_scan_one_sticker.sql", "utf8");
  const down = readFileSync("sql/192_guide_scan_one_sticker_rollback.sql", "utf8");
  it("its row + sql/204's swap = the parcel-scan row of sql/116b; one row only, safe to run twice", () => {
    const row = tupleOf("parcel-scan");
    expect(row.length).toBeGreaterThan(2000);
    const own = rowOfFile(up, "parcel-scan");
    expect(own).not.toBe(row); // sql/204 really changes it
    expect(after204("parcel-scan", own)).toBe(row);
    expect(up).toContain(`${own}\non conflict (id) do update set`);
    expect(up.match(/^ {2}\('/gm)).toHaveLength(1);
    expect(up).toContain("is distinct from (excluded.title, excluded.checked, excluded.keywords, excluded.body)");
    expect(code(up)).not.toMatch(/delete from/);
  });
  it("it says: one sticker in the photo; 2 or more → nothing filled in (and the guide still does)", () => {
    const own = rowOfFile(up, "parcel-scan");
    expect(own).toContain("Show only one sticker in the photo: with 2 or more, nothing is filled in and the app asks you to show only one.");
    expect(own).toContain("'2026-11-20'::date");
    expect(tupleOf("parcel-scan")).toContain("Show only one sticker in a photo: with 2 or more, nothing is filled in and the app asks you to show only one.");
  });
  it("the rollback puts back the row as it was (checked 2026-11-12, without the new line)", () => {
    expect(down.match(/^ {2}\('/gm)).toHaveLength(1);
    expect(down).toContain("('parcel-scan', 'Parcel Scan (7-11) and Customer Details', '2026-11-12'::date");
    expect(down).not.toContain("Show only one sticker");
  });
});

describe("sql/191 (Blacklist, not applied yet) — the same line", () => {
  it("its row + sql/204's swap = sql/116b's blacklist row, which has the '2 stickers' line", () => {
    const row = tupleOf("blacklist");
    expect(row).toContain("**2 stickers in the photo — show only one**: take the photo again with only one sticker in it.");
    expect(after204("blacklist", rowOfFile(readFileSync("sql/191_guide_blacklist.sql", "utf8"), "blacklist"))).toBe(row);
  });
});
