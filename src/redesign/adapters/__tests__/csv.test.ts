// Phase 5j — CSV serialization parity with App.tsx:281.
import { describe, it, expect } from "vitest";
import { toCSV } from "../csv";

// VERBATIM reference from App.tsx:281.
const ref = (headers: string[], rows: (string | number)[][]) =>
  [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");

describe("toCSV — byte-parity with App.tsx csvDL", () => {
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
  it("handles commas/newlines inside cells (stay quoted)", () => {
    const h = ["A", "B"], rows = [["x,y", "line1\nline2"]];
    expect(toCSV(h, rows)).toBe(ref(h, rows));
  });
  it("headers-only when no rows", () => {
    expect(toCSV(["A", "B"], [])).toBe('"A","B"');
  });
});
