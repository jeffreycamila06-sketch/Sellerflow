// Auto Mode — pure match + inventory tests (no DB / socket / React).
import { describe, it, expect } from "vitest";
import { normalizeCode, matchCode, claimStock, planAutoOrder, parseAutoComment, type AutoCode } from "../autoMode";

const code = (over: Partial<AutoCode> = {}): AutoCode => ({ code: "D", productLocalId: 1, price: 52, productName: "Brief", ...over });
const CODES: AutoCode[] = [
  code({ code: "A", productLocalId: 11, price: 150, productName: "T-shirt" }),
  code({ code: "D", productLocalId: 14, price: 52, productName: "Brief" }),
  code({ code: "BB", productLocalId: 22, price: 466, productName: "Sacks" }),
];

describe("normalizeCode", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeCode("  D  ")).toBe("d");
    expect(normalizeCode("Bb")).toBe("bb");
    expect(normalizeCode("")).toBe("");
  });
  it("preserves punctuation (so 'D.' stays distinct from 'D')", () => {
    expect(normalizeCode("D.")).toBe("d.");
    expect(normalizeCode("d.")).not.toBe(normalizeCode("D"));
  });
  it("tolerates null/undefined", () => {
    expect(normalizeCode(undefined as unknown as string)).toBe("");
    expect(normalizeCode(null as unknown as string)).toBe("");
  });
});

describe("matchCode — strict exact match (Q1 case-insensitive, Q2 punctuation rejected)", () => {
  it("matches the exact code regardless of case", () => {
    expect(matchCode("D", CODES)?.productLocalId).toBe(14);
    expect(matchCode("d", CODES)?.productLocalId).toBe(14);
    expect(matchCode("  d  ", CODES)?.productLocalId).toBe(14); // whitespace trimmed
    expect(matchCode("bb", CODES)?.productLocalId).toBe(22);    // multi-char code
  });
  it("rejects anything that is not the code ALONE", () => {
    expect(matchCode("D po", CODES)).toBeNull();
    expect(matchCode("Daming", CODES)).toBeNull();
    expect(matchCode("ok D", CODES)).toBeNull();
    expect(matchCode("D.", CODES)).toBeNull();   // trailing punctuation
    expect(matchCode("D!", CODES)).toBeNull();
    expect(matchCode("DD", CODES)).toBeNull();
  });
  it("empty / whitespace-only comment never matches", () => {
    expect(matchCode("", CODES)).toBeNull();
    expect(matchCode("   ", CODES)).toBeNull();
  });
  it("a comment maps to at most one code; no codes → null", () => {
    expect(matchCode("A", CODES)?.productLocalId).toBe(11);
    expect(matchCode("Z", CODES)).toBeNull();
    expect(matchCode("D", [])).toBeNull();
  });
  it("first entry wins if the map contains duplicate codes", () => {
    const dups = [code({ code: "D", productLocalId: 1 }), code({ code: "d", productLocalId: 2 })];
    expect(matchCode("D", dups)?.productLocalId).toBe(1);
  });
});

describe("claimStock — inventory decrement boundaries", () => {
  it("decrements when stock > 0 and flags sold-out at the last unit", () => {
    expect(claimStock(100)).toEqual({ ok: true, nextStock: 99, soldOut: false });
    expect(claimStock(2)).toEqual({ ok: true, nextStock: 1, soldOut: false });
    expect(claimStock(1)).toEqual({ ok: true, nextStock: 0, soldOut: true }); // last unit
  });
  it("already sold out → ok:false, soldOut:true, never negative", () => {
    expect(claimStock(0)).toEqual({ ok: false, nextStock: 0, soldOut: true });
    expect(claimStock(-3)).toEqual({ ok: false, nextStock: 0, soldOut: true });
  });
  it("a full run from N decrements to exactly 0 in N successful claims", () => {
    let stock = 3;
    const results = [claimStock(stock)]; stock = results[0].nextStock;
    results.push(claimStock(stock)); stock = results[1].nextStock;
    results.push(claimStock(stock)); stock = results[2].nextStock;
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.soldOut)).toEqual([false, false, true]);
    expect(stock).toBe(0);
    expect(claimStock(stock)).toEqual({ ok: false, nextStock: 0, soldOut: true }); // 4th attempt blocked
  });
});

describe("planAutoOrder — match + claim decision (PURE)", () => {
  const stockMap = new Map<number, number>([[14, 2], [11, 0]]);
  const stockOf = (lid: number) => stockMap.get(lid) ?? 0;

  it("non-code comment → none", () => {
    expect(planAutoOrder("D po", CODES, stockOf)).toEqual({ kind: "none" });
    expect(planAutoOrder("", CODES, stockOf)).toEqual({ kind: "none" });
  });
  it("code with stock → order, qty 1, with nextStock + soldOut flag", () => {
    expect(planAutoOrder("D", CODES, stockOf)).toEqual({ kind: "order", code: CODES[1], qty: 1, nextStock: 1, soldOut: false });
  });
  it("code whose last unit is claimed → order with soldOut true", () => {
    const one = new Map([[14, 1]]);
    const plan = planAutoOrder("d", CODES, (lid) => one.get(lid) ?? 0);
    expect(plan).toEqual({ kind: "order", code: CODES[1], qty: 1, nextStock: 0, soldOut: true });
  });
  it("code already at 0 → soldout (no order)", () => {
    expect(planAutoOrder("A", CODES, stockOf)).toEqual({ kind: "soldout", code: CODES[0] });
  });
});

describe("parseAutoComment — Rule 2 quantity (strict '<code> <digits>' only)", () => {
  it("exact code → qty 1 (unchanged)", () => {
    expect(parseAutoComment("D", CODES)).toEqual({ code: CODES[1], qty: 1 });
    expect(parseAutoComment("  bb ", CODES)).toEqual({ code: CODES[2], qty: 1 });
  });
  it("'<code> <n>' → qty n (case-insensitive on the code)", () => {
    expect(parseAutoComment("D 2", CODES)).toEqual({ code: CODES[1], qty: 2 });
    expect(parseAutoComment("a 5", CODES)).toEqual({ code: CODES[0], qty: 5 });
    expect(parseAutoComment("BB 99", CODES)).toEqual({ code: CODES[2], qty: 99 });
  });
  it("'A12' (no space) is NOT 'A1' qty 2 — exact-match only", () => {
    const codes = [code({ code: "A1", productLocalId: 1 }), code({ code: "A12", productLocalId: 2 })];
    expect(parseAutoComment("A12", codes)).toEqual({ code: codes[1], qty: 1 }); // matches literal A12
    expect(parseAutoComment("A1 2", codes)).toEqual({ code: codes[0], qty: 2 }); // A1 + qty 2
  });
  it("a code that literally contains a trailing number wins by EXACT match first", () => {
    const codes = [code({ code: "A1", productLocalId: 1 }), code({ code: "A1 2", productLocalId: 2 })];
    expect(parseAutoComment("A1 2", codes)).toEqual({ code: codes[1], qty: 1 }); // exact "A1 2" beats A1+qty2
  });
  it("rejects qty 0, qty 100, and non-numeric tails", () => {
    expect(parseAutoComment("A 0", CODES)).toEqual({ kind: "nomatch" });    // qty 0
    expect(parseAutoComment("A 100", CODES)).toEqual({ kind: "nomatch" });  // 3 digits → regex never matches
    expect(parseAutoComment("A x2", CODES)).toEqual({ kind: "nomatch" });   // no "x2"
    expect(parseAutoComment("A two", CODES)).toEqual({ kind: "nomatch" });
    expect(parseAutoComment("2 A", CODES)).toEqual({ kind: "nomatch" });    // reversed
  });
  it("still rejects the non-code strings matchCode rejects", () => {
    expect(parseAutoComment("mine A", CODES)).toEqual({ kind: "nomatch" });
    expect(parseAutoComment("A please", CODES)).toEqual({ kind: "nomatch" }); // "please" not digits
    expect(parseAutoComment("", CODES)).toEqual({ kind: "nomatch" });
  });
});

describe("claimStock + planAutoOrder — quantity", () => {
  it("claimStock N units: ok only when the WHOLE qty fits (no partial)", () => {
    expect(claimStock(5, 2)).toEqual({ ok: true, nextStock: 3, soldOut: false });
    expect(claimStock(2, 2)).toEqual({ ok: true, nextStock: 0, soldOut: true }); // exact → sold out
    expect(claimStock(1, 2)).toEqual({ ok: false, nextStock: 0, soldOut: false }); // short (stock>0)
    expect(claimStock(0, 2)).toEqual({ ok: false, nextStock: 0, soldOut: true });  // already out
    expect(claimStock(5, 0)).toEqual({ ok: false, nextStock: 0, soldOut: false }); // qty 0 invalid
    expect(claimStock(5, 100)).toEqual({ ok: false, nextStock: 0, soldOut: false }); // qty > 99 invalid
  });
  it("planAutoOrder 'D 2' with 2 in stock → order qty 2, sold out", () => {
    const s = new Map([[14, 2]]);
    expect(planAutoOrder("D 2", CODES, (lid) => s.get(lid) ?? 0)).toEqual({ kind: "order", code: CODES[1], qty: 2, nextStock: 0, soldOut: true });
  });
  it("planAutoOrder 'D 3' with only 2 in stock → SHORT (reject whole, no partial)", () => {
    const s = new Map([[14, 2]]);
    expect(planAutoOrder("D 3", CODES, (lid) => s.get(lid) ?? 0)).toEqual({ kind: "short", code: CODES[1], qty: 3, available: 2 });
  });
  it("planAutoOrder 'D 2' at 0 stock → soldout (not short)", () => {
    expect(planAutoOrder("D 2", CODES, () => 0)).toEqual({ kind: "soldout", code: CODES[1] });
  });
});
