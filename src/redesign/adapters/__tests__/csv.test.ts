// Phase 5j — CSV serialization; byte-parity with App.tsx:281 for CLEAN data, plus
// CSV-injection neutralization (CWE-1236 / OWASP CSV Injection) for triggering cells.
import { describe, it, expect, afterEach, vi } from "vitest";
import { toCSV, csvSafeCell, dayStamp } from "../csv";

// VERBATIM reference from App.tsx:281 (the pre-neutralization serializer).
const ref = (headers: string[], rows: (string | number)[][]) =>
  [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");

describe("toCSV — byte-parity with App.tsx csvDL for clean data (no leading trigger)", () => {
  it("quotes every cell + joins rows with newlines", () => {
    const h = ["Name", "Total"], rows: (string | number)[][] = [["Ann", 320], ["Bob", 150]];
    expect(toCSV(h, rows)).toBe(ref(h, rows));
    expect(toCSV(h, rows)).toBe('"Name","Total"\n"Ann","320"\n"Bob","150"');
  });
  it("escapes embedded quotes (\" → \"\")", () => {
    const h = ["Item"], rows = [['He said "mine"']];
    expect(toCSV(h, rows)).toBe(ref(h, rows));
    expect(toCSV(h, rows)).toBe('"Item"\n"He said ""mine"""');
  });
  it("handles commas + INTERNAL newlines inside cells (no leading trigger → unchanged)", () => {
    const h = ["A", "B"], rows = [["x,y", "line1\nline2"]];
    expect(toCSV(h, rows)).toBe(ref(h, rows)); // internal \n is not a LEADING trigger
  });
  it("headers-only when no rows", () => {
    expect(toCSV(["A", "B"], [])).toBe('"A","B"');
  });
});

describe("csvSafeCell — formula-injection neutralization", () => {
  it("prepends ' to each ASCII trigger char: = + - @ TAB CR LF", () => {
    for (const t of ["=", "+", "-", "@", "\t", "\r", "\n"]) {
      expect(csvSafeCell(`${t}HYPERLINK("http://evil")`)).toBe(`'${t}HYPERLINK("http://evil")`);
    }
  });
  it("prepends ' to full-width variants: ＝ ＋ － ＠", () => {
    for (const t of ["＝", "＋", "－", "＠"]) {
      expect(csvSafeCell(`${t}cmd`)).toBe(`'${t}cmd`);
    }
  });
  it("neutralizes the canonical DDE payload", () => {
    expect(csvSafeCell("=cmd|'/C calc'!A0")).toBe("'=cmd|'/C calc'!A0");
  });
  it("prepends ' to a LEGIT value starting with + or @ (safe false-positive by design)", () => {
    expect(csvSafeCell("+886912345678")).toBe("'+886912345678"); // phone
    expect(csvSafeCell("@meidolltw")).toBe("'@meidolltw");       // handle
  });
  it("leaves a normal name UNCHANGED (no leading trigger)", () => {
    expect(csvSafeCell("Mei Lin")).toBe("Mei Lin");
    expect(csvSafeCell("陳小美")).toBe("陳小美");
    expect(csvSafeCell("A=B")).toBe("A=B");   // trigger not in FIRST position → untouched
    expect(csvSafeCell(320)).toBe("320");     // numeric cell
    expect(csvSafeCell("")).toBe("");         // empty
  });
});

describe("toCSV — neutralization flows through every export sink", () => {
  // All 6 redesign sinks (orders/customers/miners/sales + Products + Admin audit)
  // call csvDL → toCSV, so a malicious buyer name/handle is neutralized in ALL of them.
  it("neutralizes a malicious buyer name embedded in a row", () => {
    const out = toCSV(["Name", "Total"], [['=HYPERLINK("http://evil","x")', "NT$320"]]);
    expect(out).toBe('"Name","Total"\n"\'=HYPERLINK(""http://evil"",""x"")","NT$320"');
  });
  it("neutralizes a malicious @handle cell", () => {
    // exportOrders/exportSales pass `@${handle}`; a handle of `=cmd` yields `@=cmd`
    // (leading @ is itself a trigger → neutralized).
    expect(toCSV(["U"], [["@=cmd"]])).toBe('"U"\n"\'@=cmd"');
  });
  it("clean rows stay byte-identical to the legacy serializer", () => {
    const h = ["Order", "#", "Customer"], rows: (string | number)[][] = [["#SF111", 23, "Mei Lin"]];
    expect(toCSV(h, rows)).toBe(ref(h, rows)); // "#SF111"/23/"Mei Lin" — no leading trigger
  });
});

describe("dayStamp — export-filename date stamp", () => {
  afterEach(() => vi.useRealTimers());
  it("matches production's new Date().toISOString().slice(0,10)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T05:30:00.000Z"));
    expect(dayStamp()).toBe("2026-06-26");
    expect(dayStamp()).toBe(new Date().toISOString().slice(0, 10));
  });
  it("is UTC-based (a Taipei-evening instant is still that UTC day)", () => {
    vi.useFakeTimers();
    // 2026-06-26 23:30 Taipei == 2026-06-26 15:30 UTC → still 06-26 stamp.
    vi.setSystemTime(new Date("2026-06-26T15:30:00.000Z"));
    expect(dayStamp()).toBe("2026-06-26");
  });
});
