// Batch E (#12/#14/#15/#16) — PARITY: each consolidated helper must return
// EXACTLY what the old scattered copies returned. Consolidation must not change
// behavior; the reference implementations below are VERBATIM transcriptions of
// the replaced copies.
import { describe, it, expect } from "vitest";
import { isFreePlan, isTimeLimitedPlan } from "../planWindow";
import { PLAN_PRICE, matchPlan } from "../planPricing";
import { fetchAllPages } from "../fetchAllPages";
import { isAdminRole } from "../roles";

// ── #12 isFreePlan — old copies ──────────────────────────────────────────────
// (a) useFreeCap.ts:68 (Batch A) — case-insensitive
const refUseFreeCapIsFreePlan = (plan: string | undefined): boolean =>
  String(plan || "").trim().toLowerCase() === "free";
// (b) sellerExpiry.ts:37 — exact lowercase compare (App.tsx plan domain)
const refSellerExpiryIsFree = (plan: string): boolean => plan === "free";

describe("isFreePlan — parity with both old copies (#12)", () => {
  const ALL = ["free", "Free", "FREE", " free ", "basic", "pro", "master", "trial", "Basic", "", undefined] as const;
  it.each(ALL)("matches the useFreeCap copy for %j", (plan) => {
    expect(isFreePlan(plan)).toBe(refUseFreeCapIsFreePlan(plan as string | undefined));
  });
  // sellerExpiry's exact-compare only ever saw App.tsx lowercase plans — for
  // that real domain the predicates are identical (the case-insensitive widening
  // can only matter for values that never occur in App.tsx data).
  it.each(["free", "trial", "basic", "pro", "master"])("matches sellerExpiry's exact compare for the real App.tsx domain: %j", (plan) => {
    expect(isFreePlan(plan)).toBe(refSellerExpiryIsFree(plan));
  });
  it("stays the exact complement of isTimeLimitedPlan (planWindow invariant)", () => {
    for (const p of ALL) expect(isFreePlan(p)).toBe(!isTimeLimitedPlan(p as string | undefined));
  });
});

// ── #14 plan pricing — old copies ────────────────────────────────────────────
// (a) data.ts:185 (redesign) — the price table literal
const REF_PLAN_PRICE: Record<string, number> = { Free: 0, Basic: 500, Pro: 1200, Master: 1700, Business: 1700, Starter: 500 };
// (b) Admin.tsx:137 — the re-typed threshold matcher
const refMatchPlan = (amt: string) => { const a = +amt || 0; return a >= 1700 ? "Master" : a >= 1200 ? "Pro" : a >= 500 ? "Basic" : "—"; };

describe("planPricing — parity with data.ts PLAN_PRICE + Admin.tsx matchPlan (#14)", () => {
  it("PLAN_PRICE is byte-equal to the old data.ts literal", () => {
    expect(PLAN_PRICE).toEqual(REF_PLAN_PRICE);
  });
  it.each(["", "0", "1", "499", "500", "501", "1199", "1200", "1699", "1700", "1701", "5000", "abc", "-10"])(
    "matchPlan(%j) matches the old Admin.tsx thresholds", (amt) => {
      expect(matchPlan(amt)).toBe(refMatchPlan(amt));
    },
  );
  it("thresholds ARE the tier prices (the consolidation's whole point)", () => {
    expect(matchPlan(String(PLAN_PRICE.Master))).toBe("Master");
    expect(matchPlan(String(PLAN_PRICE.Pro))).toBe("Pro");
    expect(matchPlan(String(PLAN_PRICE.Basic))).toBe("Basic");
    expect(matchPlan(String(PLAN_PRICE.Basic - 1))).toBe("—");
  });
});

// ── #15 fetchAllPages — old loop semantics (accountDb S2 / shippingDb #12) ───
// Verbatim old accountDb.fetchAllProfilePages loop (error → [])
async function refProfilePager<T>(fetchPage: (p: number) => Promise<T[] | null>, size: number): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const rows = await fetchPage(page);
    if (rows === null) return [];
    all.push(...rows);
    if (rows.length < size) return all;
  }
}
const pageData = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("fetchAllPages — parity with the old pager loops (#15)", () => {
  const SIZE = 10;
  const scenarios: Array<[string, Array<number[] | null>]> = [
    ["multi-page + short tail", [pageData(SIZE), pageData(3)]],
    ["single short page", [pageData(4)]],
    ["exactly one full page (+1 confirming empty fetch)", [pageData(SIZE), []]],
    ["empty table", [[]]],
    ["error on page 2", [pageData(SIZE), null]],
    ["error on page 1", [null]],
  ];
  it.each(scenarios)("%s: same rows AND same number of page fetches", async (_name, pages) => {
    const callsA: number[] = []; const callsB: number[] = [];
    const mk = (calls: number[]) => async (p: number) => { calls.push(p); return (pages[p] ?? []) as number[] | null; };
    const shared = await fetchAllPages(mk(callsA), SIZE);
    const ref = await refProfilePager(mk(callsB), SIZE);
    // old contract mapped error to []; the shared core returns null and the
    // accountDb/shippingDb wrappers map it — assert the mapping equals the ref
    expect(shared === null ? [] : shared).toEqual(ref);
    expect(callsA).toEqual(callsB); // identical fetch pattern (no extra/missing pages)
  });
});

// ── #16 isAdminRole — both spellings of the old raw compares ─────────────────
describe("isAdminRole — parity with the raw === checks (#16)", () => {
  // db-cased domain (adapters: connect.ts / useReadData mapping / RedesignApp)
  it.each(["admin", "seller"])("db domain %j: same as role === \"admin\"", (role) => {
    expect(isAdminRole(role)).toBe(role === "admin");
  });
  // display-cased domain (screens: Admin.tsx / useReadData buckets)
  it.each(["Admin", "Seller"])("display domain %j: same as role === \"Admin\"", (role) => {
    expect(isAdminRole(role)).toBe(role === "Admin");
  });
  it("robust on missing values (never throws, never admin)", () => {
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole("")).toBe(false);
  });
});
