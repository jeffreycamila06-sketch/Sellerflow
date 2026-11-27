// WAYBILL USERNAME — who is the buyer: the masked username rule, the candidates (own TikTok buyers of
// today + yesterday only) and the one database read (paged, never partial, own rows only).
import { beforeEach, describe, expect, it, vi } from "vitest";

const S = vi.hoisted(() => ({ calls: [] as { m: string; a: unknown[] }[], pages: [] as unknown[][] | null, failPage: -1 }));
vi.mock("../../../supabase", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "ilike", "in", "order"]) b[m] = (...a: unknown[]) => { S.calls.push({ m, a }); return b; };
    b.range = (from: number, to: number) => {
      S.calls.push({ m: "range", a: [from, to] });
      const page = Math.floor(from / 1000);
      if (page === S.failPage) return Promise.resolve({ data: null, error: { message: "x" } });
      return Promise.resolve({ data: S.pages?.[page] ?? [], error: null });
    };
    return b;
  };
  return { isSupabaseConfigured: true, supabase: { from: (t: string) => { S.calls.push({ m: "from", a: [t] }); return builder(); } } };
});

import { maskFits, buildCandidates, candidatesFor, searchCandidates, loadWaybillCandidates, stripAt, type CandidateRow } from "../waybillMatch";

const ME = "u-me", OTHER = "u-other";
const TODAY = "2026-11-27", YDAY = "2026-11-26";
const row = (handle: string, day: string, o: Partial<CandidateRow> = {}): CandidateRow => ({ user_id: ME, platform: "TikTok", session_date: day, handle, customer_name: handle.toUpperCase(), buyer_number: 1, price: 100, qty: 1, created_at: `${day}T05:00:00Z`, ...o });

describe("the TikTok mask: first character, last character, length", () => {
  it("a****8 fits a 6-character username that starts with a and ends with 8", () => {
    expect(maskFits("a****8", "ana_k8")).toBe(true);
    expect(maskFits("a****8", "ana_ko8")).toBe(false);   // 7 characters
    expect(maskFits("a****8", "bna_k8")).toBe(false);    // starts with b
    expect(maskFits("a****8", "ana_k9")).toBe(false);    // ends with 9
  });
  it("case does not matter (both sides), an @ in front does not count", () => {
    expect(maskFits("A****8", "ana_k8")).toBe(true);
    expect(maskFits("a****8", "@ANA_K8")).toBe(true);
    expect(stripAt("@@x ")).toBe("x");
  });
  it("a mask without stars must be the username itself; only stars tells nothing", () => {
    expect(maskFits("anak8", "ANAK8")).toBe(true);
    expect(maskFits("anak8", "anak9")).toBe(false);
    expect(maskFits("******", "abcdef")).toBe(false);
    expect(maskFits("", "abc")).toBe(false);
  });
  it("letters that TikTok shows in the middle must match too", () => {
    expect(maskFits("m*r**3", "mar_x3")).toBe(true);
    expect(maskFits("m*r**3", "mal_x3")).toBe(false);
  });
});

describe("the candidates", () => {
  it("only TikTok rows, only today + yesterday, only MY rows (another seller's row never counts)", () => {
    const c = buildCandidates([
      row("ana_k8", TODAY),
      row("fb_buyer", TODAY, { platform: "Facebook" }),
      row("shopee_b", TODAY, { platform: "Shopee" }),
      row("old_buyer", "2026-11-25"),
      row("not_mine", TODAY, { user_id: OTHER }),
      row("no_user", TODAY, { user_id: null }),
      row("", TODAY),
      row("amy_b8", YDAY, { platform: "tiktok" }),
    ], ME, TODAY);
    expect(c.map((x) => x.handle).sort()).toEqual(["amy_b8", "ana_k8"]);
  });
  it("one buyer = one candidate: orders counted, total = Σ price × qty, today wins over yesterday, the latest name and number", () => {
    const [c] = buildCandidates([
      row("Ana_K8", YDAY, { price: 150, qty: 2, buyer_number: 4, customer_name: "Ana Y", created_at: `${YDAY}T05:00:00Z` }),
      row("ana_k8", TODAY, { price: 99, qty: 1, buyer_number: 9, customer_name: "Ana T", created_at: `${TODAY}T05:00:00Z` }),
      row("@ana_k8", TODAY, { price: 1, qty: 0, buyer_number: 9, customer_name: "", created_at: `${TODAY}T04:00:00Z` }),
    ], ME, TODAY);
    expect(c).toMatchObject({ handle: "ana_k8", key: "ana_k8", orders: 3, total: 300 + 99 + 1, day: "today", buyerNumber: 9, name: "Ana T" });
  });
  it("sorted: today first, then the latest order", () => {
    const c = buildCandidates([row("b_y", YDAY, { created_at: `${YDAY}T09:00:00Z` }), row("a_t", TODAY, { created_at: `${TODAY}T01:00:00Z` }), row("c_t", TODAY, { created_at: `${TODAY}T08:00:00Z` })], ME, TODAY);
    expect(c.map((x) => x.handle)).toEqual(["c_t", "a_t", "b_y"]);
  });
  const all = buildCandidates([row("ana_k8", TODAY), row("amy_b8", YDAY), row("abby.08", TODAY), row("mariel_3", TODAY)], ME, TODAY);
  it("ONE candidate fits → that one", () => {
    expect(candidatesFor("m******3", all).map((x) => x.handle)).toEqual(["mariel_3"]);
  });
  it("TWO candidates fit → both (the seller picks)", () => {
    expect(candidatesFor("a****8", all).map((x) => x.handle).sort()).toEqual(["amy_b8", "ana_k8"]);
  });
  it("NONE fits → empty (the seller picks or leaves it blank)", () => {
    expect(candidatesFor("z****9", all)).toEqual([]);
  });
  it("search: contains, over username and name, case-insensitive; empty = everybody", () => {
    expect(searchCandidates("ABB", all).map((x) => x.handle)).toEqual(["abby.08"]);
    expect(searchCandidates("@mariel", all).map((x) => x.handle)).toEqual(["mariel_3"]);
    expect(searchCandidates("  ", all)).toHaveLength(4);
  });
});

describe("the one read", () => {
  beforeEach(() => { S.calls = []; S.pages = []; S.failPage = -1; });
  it("asks for MY TikTok rows of yesterday + today, ordered, page by page", async () => {
    S.pages = [[row("ana_k8", TODAY)]];
    const r = await loadWaybillCandidates(ME, TODAY);
    expect(r).toMatchObject({ ok: true, today: TODAY });
    expect(r.ok && r.candidates.map((c) => c.handle)).toEqual(["ana_k8"]);
    const by = (m: string) => S.calls.filter((c) => c.m === m).map((c) => c.a);
    expect(by("from")).toEqual([["live_session_orders"]]);
    expect(by("eq")).toEqual([["user_id", ME]]);
    expect(by("ilike")).toEqual([["platform", "tiktok"]]);
    expect(by("in")).toEqual([["session_date", [YDAY, TODAY]]]);
    expect(by("range")).toEqual([[0, 999]]);
  });
  it("more than 1,000 rows → the next page is read too (never cut at 1,000)", async () => {
    S.pages = [Array.from({ length: 1000 }, (_, i) => row(`b${i}`, TODAY)), [row("last_one", TODAY)]];
    const r = await loadWaybillCandidates(ME, TODAY);
    expect(r.ok && r.candidates.length).toBe(1001);
    expect(S.calls.filter((c) => c.m === "range").map((c) => c.a)).toEqual([[0, 999], [1000, 1999]]);
  });
  it("any page fails → not ok (never a part of the list)", async () => {
    S.pages = [Array.from({ length: 1000 }, (_, i) => row(`b${i}`, TODAY)), [row("x", TODAY)]];
    S.failPage = 1;
    expect(await loadWaybillCandidates(ME, TODAY)).toEqual({ ok: false });
  });
  it("no user → no read", async () => {
    expect(await loadWaybillCandidates("", TODAY)).toEqual({ ok: false });
    expect(S.calls).toEqual([]);
  });
  it("a row of another seller that slips through is still dropped", async () => {
    S.pages = [[row("mine1", TODAY), row("theirs", TODAY, { user_id: OTHER })]];
    const r = await loadWaybillCandidates(ME, TODAY);
    expect(r.ok && r.candidates.map((c) => c.handle)).toEqual(["mine1"]);
  });
});
