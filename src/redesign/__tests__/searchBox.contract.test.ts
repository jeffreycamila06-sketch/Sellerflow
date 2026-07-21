// Header-band search-box readability (pre-existing contrast fix). The 3
// search-in-header inputs (Orders / Products / Customers) sit on the indigo
// --header-bg; their placeholder had no rule → dark browser default → barely
// visible. These pin the shared fix so it can't silently regress.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "..", "redesign.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const read = (f: string) => readFileSync(resolve(__dirname, "..", "screens", f), "utf8");

describe("header search box — readable placeholder", () => {
  it("defines a translucent-WHITE placeholder scoped to .sfl-header-search", () => {
    expect(css).toMatch(/\.sfl-header-search::placeholder\s*\{[^}]*color:\s*rgba\(255,\s*255,\s*255/);
    // opacity:1 so Firefox doesn't dim it
    expect(css).toMatch(/\.sfl-header-search::placeholder\s*\{[^}]*opacity:\s*1/);
  });
  it("does NOT globally restyle every input placeholder (form inputs on light surfaces stay dark)", () => {
    expect(css).not.toMatch(/\[data-redesign\]\s+input::placeholder/);
  });
  it("the 3 header search inputs carry the shared class", () => {
    for (const [file, ph] of [["Orders.tsx", "rd_ord_search"], ["Products.tsx", "rd_prd_search"], ["Customers.tsx", "rd_cus_search"]] as const) {
      const src = read(file);
      const line = src.split("\n").find((l) => l.includes(ph) && l.includes("<input"));
      expect(line, `${file} search input`).toBeTruthy();
      expect(line, `${file} carries sfl-header-search`).toContain("sfl-header-search");
    }
  });
});
