// Choose price before print — 12 prices, three columns: prices 1–6 in `prices`, 7–9 in `prices_more` (sql/196),
// 10–12 in `prices_extra` (sql/238). Two OLD apps can still be open on a second device:
//   · the 9-price app (main before this change, frozen in fixtures/useChoosePrice.main9.ts);
//   · the 6-price app (before sql/196, frozen in fixtures/useChoosePrice.main.ts).
// All apps run here against ONE fake database row that behaves like PostgREST + Postgres:
//   · an upsert writes ONLY the columns in the request (INSERT … ON CONFLICT DO UPDATE SET <those columns>);
//   · the table's checks: at most 6 in prices, at most 3 in prices_more, at most 3 in prices_extra, no price
//     twice in the three together, every price above 0, ON needs a price; before sql/238 a request with
//     prices_extra is refused.
// Proves: neither old app ever sends prices_extra, so prices 10–12 survive EVERY old Settings action;
// an old add of a price that is already 10th–12th is refused and changes nothing; the new app reads and saves
// 12, refuses a 13th, and a seller with 9 or fewer sends exactly the request sent today.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Row = { user_id: string; enabled: boolean; prices: number[]; updated_at: string; show_free: boolean; prices_more: number[]; prices_extra?: number[] };
const DB = vi.hoisted(() => ({
  row: null as Row | null,
  sql238: true,                 // is sql/238 applied (the prices_extra column exists)?
  sent: [] as Record<string, unknown>[],
  refused: [] as string[],
}));

function check(r: Row): string | null {
  const more = r.prices_more ?? [], extra = r.prices_extra ?? [];
  const all = [...r.prices, ...more, ...extra];
  if (r.prices.length > 6) return "prices_max6";
  if (more.length > 3) return "more_max3";
  if (extra.length > 3) return "extra_max3";
  if (all.some((p) => !(typeof p === "number" && p > 0))) return "positive";
  if (new Set(r.prices).size !== r.prices.length) return "prices_distinct";
  if (new Set([...r.prices, ...more]).size !== r.prices.length + more.length) return "all_distinct";
  if (new Set(all).size !== all.length) return "all3_distinct";
  if (r.enabled && r.prices.length < 1) return "on_needs_price";
  return null;
}
async function upsertRow(req: Record<string, unknown>): Promise<{ error: unknown }> {
  DB.sent.push(structuredClone(req));
  if (!DB.sql238 && "prices_extra" in req) { DB.refused.push("no_column"); return { error: { code: "PGRST204", message: "Could not find the 'prices_extra' column" } }; }
  const base: Row = DB.row ?? { user_id: String(req.user_id), enabled: false, prices: [], updated_at: "", show_free: false, prices_more: [], ...(DB.sql238 ? { prices_extra: [] } : {}) };
  const next = { ...base, ...structuredClone(req) } as Row;     // ONLY the sent columns change
  const bad = check(next);
  if (bad) { DB.refused.push(bad); return { error: { code: "23514", message: `violates check constraint "seller_price_choices_${bad}"` } }; }
  DB.row = next;
  return { error: null };
}
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: DB.row ? structuredClone(DB.row) : null, error: null }) }) }),
      upsert: (row: Record<string, unknown>) => upsertRow(row),
    }),
  },
}));

import { useChoosePrice as useNew, makeDefaultPrice, removeChoicePrice, addChoicePrice, MAX_CHOICE_PRICES, readChoiceCache, writeChoiceCache, splitForSave, joinStoredPrices, normalizePriceList } from "../useChoosePrice";
import { useChoosePrice as useOld9, readChoiceCache as readOld9Cache } from "./fixtures/useChoosePrice.main9";
import { useChoosePrice as useOld6 } from "./fixtures/useChoosePrice.main";

const TWELVE = [50, 80, 100, 120, 150, 180, 200, 250, 300, 350, 400, 500];
const seedTwelve = () => {
  DB.row = { user_id: "u1", enabled: true, prices: TWELVE.slice(0, 6), prices_more: TWELVE.slice(6, 9), prices_extra: TWELVE.slice(9), updated_at: "t0", show_free: true };
};
const keysOf = (r: Record<string, unknown>) => Object.keys(r).filter((k) => k !== "updated_at").sort();
const EXTRA = [350, 400, 500];

beforeEach(() => {
  localStorage.clear();
  DB.row = null; DB.sql238 = true; DB.sent.length = 0; DB.refused.length = 0;
});

describe("pure helpers", () => {
  it("the most is 12; a 13th is never kept", () => {
    expect(MAX_CHOICE_PRICES).toBe(12);
    expect(normalizePriceList([...TWELVE, 600])).toEqual(TWELVE);
    expect(addChoicePrice(TWELVE, "600")).toEqual({ ok: false, reason: "max" });
    expect(addChoicePrice(TWELVE.slice(0, 11), "600")).toEqual({ ok: true, prices: [...TWELVE.slice(0, 11), 600] });
  });
  it("joinStoredPrices reads three columns in order (a missing third = none)", () => {
    expect(joinStoredPrices([1, 2], [3], [4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(joinStoredPrices([1, 2], [3])).toEqual([1, 2, 3]);
    expect(joinStoredPrices([1, 2], [3], null)).toEqual([1, 2, 3]);
    expect(joinStoredPrices(TWELVE.slice(0, 6), TWELVE.slice(6, 9), TWELVE.slice(9))).toEqual(TWELVE);
  });
  it.each([
    [[1, 2, 3], [1, 2], { prices: [1, 2, 3], more: null, extra: null }],
    [[1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6], { prices: [1, 2, 3, 4, 5, 6], more: [7], extra: null }],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8], { prices: [1, 2, 3, 4, 5, 6], more: [7, 8, 9], extra: null }],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9], { prices: [1, 2, 3, 4, 5, 6], more: [7, 8, 9], extra: [10] }],
    [TWELVE, TWELVE, { prices: TWELVE.slice(0, 6), more: TWELVE.slice(6, 9), extra: EXTRA }],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { prices: [1, 2, 3, 4, 5, 6], more: [7, 8, 9], extra: [] }],
    [[1, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { prices: [1, 2], more: [], extra: [] }],
  ])("splitForSave(%j, prev %j)", (next, prev, want) => {
    expect(splitForSave(next, prev)).toEqual(want);
  });
});

describe("the OLD 9-price app on a second device never deletes prices 10–12", () => {
  it("it reads only the first 9, and none of its requests carries prices_extra", async () => {
    seedTwelve();
    const { result } = renderHook(() => useOld9("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual(TWELVE.slice(0, 9));
    await act(async () => { await result.current.setEnabled(false); });
    await act(async () => { await result.current.setShowFree(false); });
    expect(DB.sent.length).toBe(2);
    for (const req of DB.sent) expect("prices_extra" in req).toBe(false);
  });

  const actions: [string, (h: ReturnType<typeof useOld9>) => Promise<unknown>, number[], Partial<Row>][] = [
    ["switch OFF", (h) => h.setEnabled(false), TWELVE.slice(0, 9), { enabled: false }],
    ["switch ON", (h) => h.setEnabled(true), TWELVE.slice(0, 9), { enabled: true }],
    ["Show Free OFF", (h) => h.setShowFree(false), TWELVE.slice(0, 9), { show_free: false }],
    ["Show Free ON", (h) => h.setShowFree(true), TWELVE.slice(0, 9), { show_free: true }],
    ["☆ makes 300 the default", (h) => h.setPrices(makeDefaultPrice(h.prices, 300)), [300, 50, 80, 100, 120, 150, 180, 200, 250], {}],
    ["× removes 80", (h) => h.setPrices(removeChoicePrice(h.prices, 80)), [50, 100, 120, 150, 180, 200, 250, 300], {}],
    ["Same price ON (Choose price saved as OFF)", (h) => h.setEnabled(false), TWELVE.slice(0, 9), { enabled: false }],
  ];
  it.each(actions)("old 9-price app, %s → prices 10–12 still saved; the change itself is kept", async (_what, act1, firstNine, more) => {
    seedTwelve();
    const { result } = renderHook(() => useOld9("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: unknown;
    await act(async () => { ok = await act1(result.current); });
    expect(ok).toBe(true);
    expect(DB.refused).toEqual([]);
    expect(DB.row!.prices_extra).toEqual(EXTRA);                      // untouched
    expect([...DB.row!.prices, ...DB.row!.prices_more]).toEqual(firstNine);
    expect(DB.row).toMatchObject(more);
    const n = renderHook(() => useNew("u1"));
    await waitFor(() => expect(n.result.current.loading).toBe(false));
    expect(n.result.current.prices).toEqual([...firstNine, ...EXTRA]);
  });

  it("all old actions one after another → prices 10–12 kept after each", async () => {
    seedTwelve();
    const { result } = renderHook(() => useOld9("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const [, act1] of actions) {
      await act(async () => { await act1(result.current); });
      expect(DB.row!.prices_extra).toEqual(EXTRA);
    }
    expect(DB.refused).toEqual([]);
  });

  it("old 9-price app adds a price that is already 10th–12th (hidden from it) → refused, nothing is lost", async () => {
    seedTwelve();
    const { result } = renderHook(() => useOld9("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 80)); });
    const before = structuredClone(DB.row);
    const add = addChoicePrice(result.current.prices, "400");        // the old app sees 8 prices → allowed on its side
    expect(add.ok).toBe(true);
    let ok: unknown;
    await act(async () => { ok = await result.current.setPrices((add as { prices: number[] }).prices); });
    expect(ok).toBe(false);
    expect(DB.refused).toEqual(["all3_distinct"]);
    expect(DB.row).toEqual(before);
    expect(result.current.saveErrors).toBe(1);
  });

  it("old 9-price app adds a NEW price after removing one → saved; 12 again, 10–12 kept", async () => {
    seedTwelve();
    const { result } = renderHook(() => useOld9("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 80)); });
    await act(async () => { await result.current.setPrices([...result.current.prices, 90]); });
    expect(DB.row!.prices_extra).toEqual(EXTRA);
    expect([...DB.row!.prices, ...DB.row!.prices_more, ...DB.row!.prices_extra].length).toBe(12);
  });

  it("the old app reading the new app's saved copy on the device keeps 9 there, and saves nothing by itself", async () => {
    writeChoiceCache("u1", true, TWELVE, true);                       // written by the new app
    expect(readChoiceCache("u1")!.prices).toEqual(TWELVE);
    expect(readOld9Cache("u1")!.prices).toEqual(TWELVE.slice(0, 9));
    seedTwelve();
    const { result } = renderHook(() => useOld9("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(DB.sent).toEqual([]);
    expect(DB.row!.prices_extra).toEqual(EXTRA);
  });
});

describe("the OLD 6-price app never deletes prices 7–12", () => {
  it.each([
    ["switch OFF", (h: ReturnType<typeof useOld6>) => h.setEnabled(false)],
    ["Show Free OFF", (h: ReturnType<typeof useOld6>) => h.setShowFree(false)],
    ["× removes 80", (h: ReturnType<typeof useOld6>) => h.setPrices(removeChoicePrice(h.prices, 80))],
  ] as const)("old 6-price app, %s → 7–9 and 10–12 kept", async (_w, act1) => {
    seedTwelve();
    const { result } = renderHook(() => useOld6("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await act1(result.current); });
    expect(DB.refused).toEqual([]);
    expect(DB.row!.prices_more).toEqual([200, 250, 300]);
    expect(DB.row!.prices_extra).toEqual(EXTRA);
    for (const req of DB.sent) { expect("prices_extra" in req).toBe(false); expect("prices_more" in req).toBe(false); }
  });
});

describe("the NEW app: 12 prices in three columns", () => {
  it("reads the three columns as ONE list of 12", async () => {
    seedTwelve();
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual(TWELVE);
    expect(readChoiceCache("u1")!.prices).toEqual(TWELVE);
  });
  it("adds the 10th–12th: they go to prices_extra; a 13th is refused", async () => {
    DB.row = { user_id: "u1", enabled: true, prices: TWELVE.slice(0, 6), prices_more: TWELVE.slice(6, 9), prices_extra: [], updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const p of EXTRA) {
      const r = addChoicePrice(result.current.prices, String(p));
      expect(r.ok).toBe(true);
      await act(async () => { await result.current.setPrices((r as { prices: number[] }).prices); });
    }
    expect(DB.row!.prices).toEqual(TWELVE.slice(0, 6));
    expect(DB.row!.prices_more).toEqual(TWELVE.slice(6, 9));
    expect(DB.row!.prices_extra).toEqual(EXTRA);
    expect(result.current.prices).toEqual(TWELVE);
    expect(addChoicePrice(result.current.prices, "600")).toEqual({ ok: false, reason: "max" });
  });
  it("a seller with 9 or fewer sends EXACTLY today's request (no prices_extra key) — same keys as the old 9-price app", async () => {
    DB.row = { user_id: "u1", enabled: true, prices: [39, 59], prices_more: [], prices_extra: [], updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices([39, 59, 99, 129, 149, 199, 249]); });
    await act(async () => { await result.current.setPrices([39, 59, 99, 129, 149, 199, 249, 299, 349]); });
    await act(async () => { await result.current.setEnabled(false); });
    await act(async () => { await result.current.setShowFree(true); });
    const fresh = DB.sent.map(keysOf);
    expect(fresh).toEqual([
      ["enabled", "prices", "prices_more", "user_id"],
      ["enabled", "prices", "prices_more", "user_id"],
      ["enabled", "prices", "prices_more", "user_id"],
      ["enabled", "prices", "prices_more", "show_free", "user_id"],
    ]);
    // the old 9-price app sends the very same requests for the same actions from the same start
    DB.row = { user_id: "u1", enabled: true, prices: [39, 59], prices_more: [], prices_extra: [], updated_at: "t0", show_free: false };
    const newReqs = DB.sent.map((r) => { const { updated_at: _u, ...rest } = r; return rest; });
    DB.sent.length = 0; localStorage.clear();
    const o = renderHook(() => useOld9("u1"));
    await waitFor(() => expect(o.result.current.loading).toBe(false));
    await act(async () => { await o.result.current.setPrices([39, 59, 99, 129, 149, 199, 249]); });
    await act(async () => { await o.result.current.setPrices([39, 59, 99, 129, 149, 199, 249, 299, 349]); });
    await act(async () => { await o.result.current.setEnabled(false); });
    await act(async () => { await o.result.current.setShowFree(true); });
    expect(DB.sent.map((r) => { const { updated_at: _u, ...rest } = r; return rest; })).toEqual(newReqs);
  });
  it("12 → 10 → 9 by ×: prices_extra follows (the last step empties it)", async () => {
    seedTwelve();
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 500)); });
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 400)); });
    expect(DB.row!.prices_extra).toEqual([350]);
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 50)); });
    expect(DB.row!.prices).toEqual([80, 100, 120, 150, 180, 200]);
    expect(DB.row!.prices_more).toEqual([250, 300, 350]);
    expect(DB.row!.prices_extra).toEqual([]);
    expect(DB.sent.at(-1)).toMatchObject({ prices_extra: [] });
  });
  it("☆ on the 12th price: it moves to the front, the others shift one place across the columns", async () => {
    seedTwelve();
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(makeDefaultPrice(result.current.prices, 500)); });
    expect(DB.row!.prices).toEqual([500, 50, 80, 100, 120, 150]);
    expect(DB.row!.prices_more).toEqual([180, 200, 250]);
    expect(DB.row!.prices_extra).toEqual([300, 350, 400]);
  });
  it("before sql/238: adding a 10th fails with the normal error and the list goes back to 9", async () => {
    DB.sql238 = false;
    DB.row = { user_id: "u1", enabled: true, prices: TWELVE.slice(0, 6), prices_more: TWELVE.slice(6, 9), updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual(TWELVE.slice(0, 9));
    let ok: unknown;
    await act(async () => { ok = await result.current.setPrices([...result.current.prices, 350]); });
    expect(ok).toBe(false);
    expect(DB.refused).toEqual(["no_column"]);
    expect(result.current.prices).toEqual(TWELVE.slice(0, 9));
    expect(result.current.saveErrors).toBe(1);
    await act(async () => { ok = await result.current.setEnabled(false); });  // 9 or fewer: works as today
    expect(ok).toBe(true);
    expect(DB.row!.enabled).toBe(false);
  });
  it("an old device's change (8 + 3) is read as 11 and the next new save splits it again", async () => {
    DB.row = { user_id: "u1", enabled: true, prices: [50, 100, 120, 150, 180, 200], prices_more: [250, 300], prices_extra: EXTRA, updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual([50, 100, 120, 150, 180, 200, 250, 300, 350, 400, 500]);
    await act(async () => { await result.current.setEnabled(false); });
    expect(DB.row!.prices_more).toEqual([250, 300, 350]);
    expect(DB.row!.prices_extra).toEqual([400, 500]);
  });
});
