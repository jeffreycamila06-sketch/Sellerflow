// Choose price before print — 9 prices, two columns (sql/196): prices 1–6 in `prices`, 7–9 in `prices_more`.
// The OLD app (main before this change, frozen in fixtures/useChoosePrice.main.ts) can still be open on a
// second device. Both apps run here against ONE fake database row that behaves like PostgREST + Postgres:
//   · an upsert writes ONLY the columns in the request (INSERT … ON CONFLICT DO UPDATE SET <those columns>);
//   · the table's checks: at most 6 in prices, at most 3 in prices_more, no price twice in the two together,
//     every price above 0, ON needs a price; before sql/196 a request with prices_more is refused.
// Proves: the old app never sends prices_more, so prices 7–9 survive EVERY old Settings action
// (switch on / off, Show Free on / off, ☆, ×, Same price on); its add of a price that is already 7th–9th
// is refused and changes nothing; the new app reads and saves 9, refuses a 10th, and a seller with 6 or
// fewer sends exactly the request sent before.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Row = { user_id: string; enabled: boolean; prices: number[]; updated_at: string; show_free: boolean; prices_more?: number[] };
const DB = vi.hoisted(() => ({
  row: null as Row | null,
  sql196: true,                 // is sql/196 applied (the prices_more column exists)?
  sent: [] as Record<string, unknown>[],
  refused: [] as string[],
}));

// One user's row; the checks of sql/180 + sql/184 + sql/196.
function check(r: Row): string | null {
  const more = r.prices_more ?? [];
  if (r.prices.length > 6) return "prices_max6";
  if (more.length > 3) return "more_max3";
  if ([...r.prices, ...more].some((p) => !(typeof p === "number" && p > 0))) return "positive";
  if (new Set(r.prices).size !== r.prices.length) return "prices_distinct";
  if (new Set([...r.prices, ...more]).size !== r.prices.length + more.length) return "all_distinct";
  if (r.enabled && r.prices.length < 1) return "on_needs_price";
  return null;
}
async function upsertRow(req: Record<string, unknown>): Promise<{ error: unknown }> {
  DB.sent.push(structuredClone(req));
  if (!DB.sql196 && "prices_more" in req) { DB.refused.push("no_column"); return { error: { code: "PGRST204", message: "Could not find the 'prices_more' column" } }; }
  const base: Row = DB.row ?? { user_id: String(req.user_id), enabled: false, prices: [], updated_at: "", show_free: false, ...(DB.sql196 ? { prices_more: [] } : {}) };
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

import { useChoosePrice as useNew, makeDefaultPrice, removeChoicePrice, addChoicePrice, MAX_CHOICE_PRICES, readChoiceCache, writeChoiceCache } from "../useChoosePrice";
import { useChoosePrice as useOld, readChoiceCache as readOldCache } from "./fixtures/useChoosePrice.main";

const NINE = [50, 80, 100, 120, 150, 180, 200, 250, 300];
const seedNine = () => {
  DB.row = { user_id: "u1", enabled: true, prices: NINE.slice(0, 6), prices_more: NINE.slice(6), updated_at: "t0", show_free: true };
};
const keysOf = (r: Record<string, unknown>) => Object.keys(r).filter((k) => k !== "updated_at").sort();

beforeEach(() => {
  localStorage.clear();
  DB.row = null; DB.sql196 = true; DB.sent.length = 0; DB.refused.length = 0;
});

describe("the OLD app on a second device (6-price client) never deletes prices 7–9", () => {
  it("it reads only the first 6, and none of its requests carries prices_more", async () => {
    seedNine();
    const { result } = renderHook(() => useOld("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual(NINE.slice(0, 6));
    await act(async () => { await result.current.setEnabled(false); });
    await act(async () => { await result.current.setShowFree(false); });
    for (const req of DB.sent) expect("prices_more" in req).toBe(false);
  });

  // Every Settings action the old app has (GeneralSettings → these three hook calls, RedesignApp lines
  // onSetChoosePriceEnabled / onSetChoosePrices / onSetChooseShowFree). "Same price ON" = Settings turns
  // Choose price OFF through the same setEnabled(false).
  const actions: [string, (h: ReturnType<typeof useOld>) => Promise<unknown>, number[], Partial<Row>][] = [
    ["switch OFF", (h) => h.setEnabled(false), NINE.slice(0, 6), { enabled: false }],
    ["switch ON", (h) => h.setEnabled(true), NINE.slice(0, 6), { enabled: true }],
    ["Show Free OFF", (h) => h.setShowFree(false), NINE.slice(0, 6), { show_free: false }],
    ["Show Free ON", (h) => h.setShowFree(true), NINE.slice(0, 6), { show_free: true }],
    ["☆ makes 120 the default", (h) => h.setPrices(makeDefaultPrice(h.prices, 120)), [120, 50, 80, 100, 150, 180], {}],
    ["× removes 80", (h) => h.setPrices(removeChoicePrice(h.prices, 80)), [50, 100, 120, 150, 180], {}],
    ["Same price ON (Choose price saved as OFF)", (h) => h.setEnabled(false), NINE.slice(0, 6), { enabled: false }],
  ];
  it.each(actions)("old app, %s → prices 7–9 still saved; the change itself is kept", async (_what, act1, firstSix, more) => {
    seedNine();
    const { result } = renderHook(() => useOld("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: unknown;
    await act(async () => { ok = await act1(result.current); });
    expect(ok === undefined || ok === true).toBe(true);
    expect(DB.refused).toEqual([]);
    expect(DB.row!.prices_more).toEqual([200, 250, 300]);                 // untouched
    expect(DB.row!.prices).toEqual(firstSix);
    expect(DB.row).toMatchObject(more);
    // the new app (this or another device) reads the old device's change + prices 7–9
    const n = renderHook(() => useNew("u1"));
    await waitFor(() => expect(n.result.current.loading).toBe(false));
    expect(n.result.current.prices).toEqual([...firstSix, 200, 250, 300]);
  });

  it("all old actions one after another → the new app still reads prices 7–9 after each", async () => {
    seedNine();
    const { result } = renderHook(() => useOld("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const [, act1] of actions) {
      await act(async () => { await act1(result.current); });
      expect(DB.row!.prices_more).toEqual([200, 250, 300]);
    }
    expect(DB.refused).toEqual([]);
  });

  it("old app adds a price that is already 7th–9th (hidden from it) → refused, it goes back, nothing is lost", async () => {
    seedNine();
    const { result } = renderHook(() => useOld("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 80)); });
    const before = structuredClone(DB.row);
    const add = addChoicePrice(result.current.prices, "250");        // the old app sees 5 prices → allowed on its side
    expect(add.ok).toBe(true);
    let ok: unknown;
    await act(async () => { ok = await result.current.setPrices((add as { prices: number[] }).prices); });
    expect(ok).toBe(false);
    expect(DB.refused).toEqual(["all_distinct"]);
    expect(DB.row).toEqual(before);
    expect(result.current.prices).toEqual([50, 100, 120, 150, 180]);   // the old app went back
    expect(result.current.saveErrors).toBe(1);
  });

  it("old app adds a NEW price after removing one → saved; the seller now has 9 again, 7–9 kept", async () => {
    seedNine();
    const { result } = renderHook(() => useOld("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 80)); });
    await act(async () => { await result.current.setPrices([...result.current.prices, 90]); });
    expect(DB.row!.prices).toEqual([50, 100, 120, 150, 180, 90]);
    expect(DB.row!.prices_more).toEqual([200, 250, 300]);
  });

  it("the old app reading the new app's saved copy on the device keeps 6 there, and saves nothing by itself", async () => {
    writeChoiceCache("u1", true, NINE, true);                        // written by the new app
    expect(readChoiceCache("u1")!.prices).toEqual(NINE);
    expect(readOldCache("u1")!.prices).toEqual(NINE.slice(0, 6));    // the old app's own reading: cut, on screen only
    seedNine();
    const { result } = renderHook(() => useOld("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(DB.sent).toEqual([]);                                     // a read never writes
    expect(DB.row!.prices_more).toEqual([200, 250, 300]);
  });
});

describe("the NEW app: 9 prices in two columns", () => {
  it("reads prices + prices_more as ONE list of 9", async () => {
    seedNine();
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual(NINE);
    expect(result.current.active).toBe(true);
    expect(readChoiceCache("u1")!.prices).toEqual(NINE);             // the device copy keeps all 9
  });
  it("saves 9: prices 1–6 in prices, 7–9 in prices_more (a 10th: see the 12-price test)", async () => {
    DB.row = { user_id: "u1", enabled: true, prices: NINE.slice(0, 6), prices_more: [], updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const p of [200, 250, 300]) {
      const r = addChoicePrice(result.current.prices, String(p));
      expect(r.ok).toBe(true);
      await act(async () => { await result.current.setPrices((r as { prices: number[] }).prices); });
    }
    expect(DB.row!.prices).toEqual(NINE.slice(0, 6));
    expect(DB.row!.prices_more).toEqual([200, 250, 300]);
    expect(result.current.prices).toEqual(NINE);
    // A 10th is no longer refused here: since the 12-price change it goes to prices_extra
    // (choosePriceTwelve.oldDevice.test.tsx). The 9-price split above is unchanged.
    expect(addChoicePrice(result.current.prices, "350").ok).toBe(true);
    expect(MAX_CHOICE_PRICES).toBe(12);
  });
  it("a seller with 6 or fewer sends EXACTLY the request sent before (no prices_more key)", async () => {
    DB.row = { user_id: "u1", enabled: true, prices: [39, 59], prices_more: [], updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices([39, 59, 99, 129, 149, 199]); });
    await act(async () => { await result.current.setEnabled(false); });
    await act(async () => { await result.current.setShowFree(true); });
    expect(DB.sent.map(keysOf)).toEqual([
      ["enabled", "prices", "user_id"],
      ["enabled", "prices", "user_id"],
      ["enabled", "prices", "show_free", "user_id"],
    ]);
    // and the old app sends the very same keys for the same actions
    DB.sent.length = 0;
    const o = renderHook(() => useOld("u1"));
    await waitFor(() => expect(o.result.current.loading).toBe(false));
    await act(async () => { await o.result.current.setEnabled(true); });
    expect(DB.sent.map(keysOf)).toEqual([["enabled", "prices", "show_free", "user_id"]]);
  });
  it("9 → 7 → 6 by ×: prices_more follows (the last step empties it)", async () => {
    seedNine();
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 300)); });
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 250)); });
    expect(DB.row!.prices_more).toEqual([200]);
    await act(async () => { await result.current.setPrices(removeChoicePrice(result.current.prices, 50)); });
    expect(DB.row!.prices).toEqual([80, 100, 120, 150, 180, 200]);
    expect(DB.row!.prices_more).toEqual([]);
    expect(DB.sent.at(-1)).toMatchObject({ prices_more: [] });
  });
  it("☆ on the 9th price: it moves to the front, the 6th moves into prices_more", async () => {
    seedNine();
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setPrices(makeDefaultPrice(result.current.prices, 300)); });
    expect(DB.row!.prices).toEqual([300, 50, 80, 100, 120, 150]);
    expect(DB.row!.prices_more).toEqual([180, 200, 250]);
  });
  it("before sql/196: adding a 7th fails with the normal error and the list goes back to 6", async () => {
    DB.sql196 = false;
    DB.row = { user_id: "u1", enabled: true, prices: NINE.slice(0, 6), updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual(NINE.slice(0, 6));             // no column → nothing extra
    let ok: unknown;
    await act(async () => { ok = await result.current.setPrices([...result.current.prices, 200]); });
    expect(ok).toBe(false);
    expect(DB.refused).toEqual(["no_column"]);
    expect(result.current.prices).toEqual(NINE.slice(0, 6));
    expect(result.current.saveErrors).toBe(1);
    await act(async () => { ok = await result.current.setEnabled(false); });   // 6 or fewer: works as before
    expect(ok).toBe(true);
    expect(DB.row!.enabled).toBe(false);
  });
  it("an old device's change (5 + 3) is read as 8 and the next new save splits it again", async () => {
    DB.row = { user_id: "u1", enabled: true, prices: [50, 100, 120, 150, 180], prices_more: [200, 250, 300], updated_at: "t0", show_free: false };
    const { result } = renderHook(() => useNew("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prices).toEqual([50, 100, 120, 150, 180, 200, 250, 300]);
    await act(async () => { await result.current.setEnabled(false); });
    expect(DB.row!.prices).toEqual([50, 100, 120, 150, 180, 200]);
    expect(DB.row!.prices_more).toEqual([250, 300]);
  });
});
