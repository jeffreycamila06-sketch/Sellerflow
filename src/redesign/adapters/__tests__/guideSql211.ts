// sql/211 (help guide for the native "Scan sticker QR", 2026-11-22) changes 3 guide rows with phrase
// swaps. The older one-row guide files (sql/191 Blacklist, sql/192 Parcel Scan) keep the words they
// had; with this a test checks "that old row + sql/211's swaps = today's row in sql/116b (the guide)".
// Works on SQL text as written in the files (quotes doubled, real line breaks), like the database does:
// a swap is made only where the old words are found and the new ones are not, and then "checked"
// becomes at least 2026-11-22.
import { readFileSync } from "node:fs";

const SQL211 = readFileSync("sql/211_guide_native_qr_scanner.sql", "utf8");
const SQL_TEXT = "'((?:[^']|'')*)'";

/** The [old, new] phrase pairs sql/211 applies to the row with this id. */
export function swaps211(id: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const block of SQL211.split("update public.support_guide").slice(1)) {
    const where = block.match(/where id = '([\w-]+)'/);
    const swap = block.match(new RegExp(`replace\\(body, ${SQL_TEXT}, ${SQL_TEXT}\\)`, "s"));
    if (where && swap && where[1] === id) out.push([swap[1], swap[2]]);
  }
  return out;
}

/** The row (SQL tuple text) after sql/211 ran on it. */
export function after211(id: string, row: string): string {
  let out = row;
  let changed = false;
  for (const [from, to] of swaps211(id)) {
    if (out.includes(from) && !out.includes(to)) { out = out.replace(from, () => to); changed = true; }
  }
  if (changed) out = out.replace(/'(\d{4}-\d{2}-\d{2})'::date/, (m, d: string) => (d < "2026-11-22" ? "'2026-11-22'::date" : m));
  return out;
}

/** The one guide row of a one-row guide file: from "  ('id'," to its closing ")" before "on conflict". */
export function rowOfFile(sql: string, id: string): string {
  const a = sql.indexOf(`  ('${id}',`);
  return sql.slice(a, sql.indexOf(")\non conflict", a) + 1);
}
