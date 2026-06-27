// Auto Mode — pure match + inventory tests (no DB / socket / React).
import { describe, it, expect } from "vitest";
import { normalizeCode, matchCode, claimStock, type AutoCode } from "../autoMode";

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
