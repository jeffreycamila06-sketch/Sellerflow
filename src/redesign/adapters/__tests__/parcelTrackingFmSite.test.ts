// 2026-11-19 (sql/186) — Pickup Status: 全家 parcels FamilyMart's site has NOTHING for yet.
// The check saves what the site said (fm_site_state). The app lists those parcels in their own group
// under In transit, does not count them in the In transit number, and says when they leave the list.
// While sql/186 is not applied, the read is exactly the one of before (same select, same 7 questions).
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const DB = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], queries: [] as unknown[][][], noColumn: false }));
vi.mock("../../../supabase", () => {
  const empty = (v: unknown) => v == null || v === "";
  const missing = { code: "42703", message: "column parcel_tracking.fm_site_state does not exist" };
  class Q {
    f: ((r: Row) => boolean)[] = []; count = false; head = false; lim = Infinity; a = 0; b = Infinity; calls: unknown[][] = []; bad = false;
    constructor() { DB.queries.push(this.calls); }
    select(cols: string, o?: { count?: string; head?: boolean }) { this.calls.push(["select", cols]); this.count = !!o?.count; this.head = !!o?.head; if (cols.includes("fm_site_state")) this.bad = true; return this; }
    eq(c: string, v: unknown) { this.calls.push(["eq", c, v]); this.f.push((r) => r[c] === v); return this; }
    in(c: string, v: unknown[]) { this.calls.push(["in", c, v]); this.f.push((r) => v.includes(r[c])); return this; }
    is(c: string, v: unknown) { this.calls.push(["is", c, v]); if (c === "fm_site_state") this.bad = true; this.f.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, op: string, v: unknown) {
      this.calls.push(["not", c, op, v]);
      if (op !== "is" || v !== null) throw new Error(`unknown filter not ${op}`);
      if (c === "fm_site_state") this.bad = true;
      this.f.push((r) => (r[c] ?? null) !== null);
      return this;
    }
    or(expr: string) {
      this.calls.push(["or", expr]);
      if (expr !== "special_type.is.null,special_type.eq.") throw new Error(`unknown filter ${expr}`);
      this.f.push((r) => empty(r.special_type));
      return this;
    }
    order(c: string, o?: { ascending?: boolean }) { this.calls.push(["order", c, o?.ascending !== false]); return this; }
    range(a: number, b: number) { this.calls.push(["range", a, b]); this.a = a; this.b = b; return this; }
    limit(n: number) { this.calls.push(["limit", n]); this.lim = n; return this; }
    then(res: (v: unknown) => unknown) {
      if (DB.noColumn && this.bad) return Promise.resolve({ data: null, count: null, error: missing }).then(res);
      let list = DB.rows.filter((r) => this.f.every((g) => g(r)));
      const count = list.length;
      list = list.slice(this.a, this.b === Infinity ? undefined : this.b + 1).slice(0, this.lim);
      // columns the select did not ask for are not returned (like PostgREST)
      const cols = String(this.calls.find((c) => c[0] === "select")?.[1] ?? "").split(",").map((s) => s.trim());
      const pick = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => cols.includes(k)));
      return Promise.resolve({ data: this.head ? null : list.map(pick), count: this.count ? count : null, error: null }).then(res);
    }
  }
  return {
    isSupabaseConfigured: true,
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "U" } } } }) }, from: () => new Q() },
  };
});

import {
  loadParcelTracking, loadMoreLive, rowToTracking, isFmNothingYet, fmLeaves, sortByDaysLeft, groupParcels, tabCounts, tabRows, fmNotDroppedCount,
  resetFmSiteColumnForTests, PT_SELECT, FM_LEAVE_AFTER_DAYS, type ParcelTrackingRow,
} from "../parcelTracking";

const TODAY = "2026-11-19";
let n = 0;
const mk = (o: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `163${String(10000000 + n)}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: null, storeId: "022131", recStore: "樹林新柑園店",
  status: "in_transit", statusMessage: null, pickupDeadline: null, arrivedAt: null, shipType: "C2C", specialType: null, orderAmount: 339, terminal: false, carrier: "fm", ...o,
});
const held = (o: Partial<ParcelTrackingRow> = {}) => mk({ fmSiteState: "not_dropped", createdAt: "2026-11-15T02:00:00.000Z", ...o });

// (?. so that, run against main's code — which has no such helper —, each test fails on its own check)
beforeEach(() => { DB.rows = []; DB.queries = []; DB.noColumn = false; resetFmSiteColumnForTests?.(); });

describe("rowToTracking — the saved answer", () => {
  it("read only when the column came back; an unknown word is no answer", () => {
    expect(rowToTracking({ id: "a", status: "in_transit", fm_site_state: "not_found", created_at: "2026-11-15T02:00:00Z" })).toMatchObject({ fmSiteState: "not_found", createdAt: "2026-11-15T02:00:00Z" });
    expect(rowToTracking({ id: "a", fm_site_state: "not_dropped" }).fmSiteState).toBe("not_dropped");
    expect(rowToTracking({ id: "a", fm_site_state: "maybe" }).fmSiteState).toBeNull();
    expect(rowToTracking({ id: "a", fm_site_state: null }).fmSiteState).toBeNull();
    const before = rowToTracking({ id: "a", status: "in_transit", created_at: "2026-11-15T02:00:00Z" });
    expect("fmSiteState" in before).toBe(false);
    expect("createdAt" in before).toBe(false);
  });
});

describe("isFmNothingYet", () => {
  it("a 全家 parcel in transit, unfinished, with one of the two saved answers → yes", () => {
    expect(isFmNothingYet(held())).toBe(true);
    expect(isFmNothingYet(held({ fmSiteState: "not_found" }))).toBe(true);
  });
  it("anything else → no", () => {
    expect(isFmNothingYet(held({ carrier: "711" }))).toBe(false);
    expect(isFmNothingYet(held({ carrier: undefined }))).toBe(false);
    expect(isFmNothingYet(held({ status: "at_store" }))).toBe(false);
    expect(isFmNothingYet(held({ status: "created" }))).toBe(false);
    expect(isFmNothingYet(held({ terminal: true }))).toBe(false);
    expect(isFmNothingYet(held({ fmSiteState: null }))).toBe(false);
    expect(isFmNothingYet(mk())).toBe(false);
  });
});

describe("fmLeaves — the day it leaves the list (the server's two rules)", () => {
  it("saved day (Taipei) + 10 days", () => {
    expect(FM_LEAVE_AFTER_DAYS).toBe(10);
    expect(fmLeaves(held({ createdAt: "2026-11-15T02:00:00.000Z" }), TODAY)).toEqual({ date: "2026-11-25", next: false });
    // 16:30 UTC on the 9th = 00:30 on the 10th in Taipei
    expect(fmLeaves(held({ createdAt: "2026-11-09T16:30:00.000Z" }), TODAY)).toEqual({ date: "2026-11-20", next: false });
    expect(fmLeaves(held({ createdAt: "2026-11-09T15:30:00.000Z" }), TODAY)).toEqual({ date: "2026-11-19", next: true });
    expect(fmLeaves(held({ createdAt: "2026-10-01T00:00:00.000Z" }), TODAY)?.next).toBe(true);
  });
  it("FamilyMart does not know the number + a drop-off date → the day after it, when sooner", () => {
    expect(fmLeaves(held({ fmSiteState: "not_found", pickupDeadline: "2026-11-18" }), TODAY)).toEqual({ date: "2026-11-19", next: true });
    expect(fmLeaves(held({ fmSiteState: "not_found", pickupDeadline: "2026-11-21" }), TODAY)).toEqual({ date: "2026-11-22", next: false });
    expect(fmLeaves(held({ fmSiteState: "not_found", pickupDeadline: "2026-12-30" }), TODAY)).toEqual({ date: "2026-11-25", next: false });
    // knows the order (not handed in): the date does not shorten it
    expect(fmLeaves(held({ fmSiteState: "not_dropped", pickupDeadline: "2026-11-18" }), TODAY)).toEqual({ date: "2026-11-25", next: false });
  });
  it("not such a row / no readable saved time → null", () => {
    expect(fmLeaves(mk(), TODAY)).toBeNull();
    expect(fmLeaves(held({ createdAt: null }), TODAY)).toBeNull();
    expect(fmLeaves(held({ createdAt: "garbage" }), TODAY)).toBeNull();
  });
});

describe("the list and the numbers", () => {
  const rows = () => [
    held({ id: "h1", buyerUsername: "held_one" }),
    mk({ id: "m1", buyerUsername: "moving_one", statusMessage: "貨件進行配送中" }),
    held({ id: "h2", buyerUsername: "held_two", fmSiteState: "not_found" }),
    mk({ id: "s1", carrier: "711", buyerUsername: "seven_moving" }),
    mk({ id: "w1", status: "at_store", pickupDeadline: "2026-11-22" }),
  ];
  it("In transit: the moving parcels first, then the group", () => {
    const g = groupParcels(rows(), TODAY);
    expect(tabRows(g, "transit", TODAY).map((r) => r.id)).toEqual(["m1", "s1", "h1", "h2"]);
    expect(sortByDaysLeft(rows(), TODAY).map((r) => r.id)).toEqual(["w1", "m1", "s1", "h1", "h2"]);
  });
  it("the In transit number counts the moving parcels only; the group has its own number", () => {
    const g = groupParcels(rows(), TODAY);
    expect(tabCounts(g).transit).toBe(2);
    expect(fmNotDroppedCount(g)).toBe(2);
    expect(tabCounts(g).waiting).toBe(1);
    expect(tabCounts(g).all).toBe(5); // All still lists every parcel
  });
  it("exact numbers from the database win", () => {
    const g = groupParcels(rows(), TODAY);
    expect(tabCounts(g, { all: 9, picked: 0, returned: 0, transit: 7 }).transit).toBe(7);
    expect(fmNotDroppedCount(g, { all: 9, picked: 0, returned: 0, notDropped: 4 })).toBe(4);
  });
  it("without the saved answer (7-11, 全家 off, sql/186 not applied) nothing changes", () => {
    const plain = rows().map(({ fmSiteState: _f, createdAt: _c, ...r }) => r as ParcelTrackingRow);
    const g = groupParcels(plain, TODAY);
    expect(tabCounts(g).transit).toBe(4);
    expect(fmNotDroppedCount(g)).toBe(0);
  });
});

// ── the read ───────────────────────────────────────────────────────────────────
const row = (o: Row = {}): Row => ({
  id: `d${++n}`, user_id: "U", carrier: "fm", tracking_no: `163${10000000 + n}`, status: "in_transit", terminal: false, ship_type: "C2C", special_type: null,
  pickup_deadline: null, last_polled_at: null, created_at: "2026-11-15T02:00:00Z", fm_site_state: null, ...o,
});
const seed = () => {
  DB.rows = [
    row({ fm_site_state: "not_dropped" }), row({ fm_site_state: "not_found", ship_type: "全家店寄店取" }), row(), row(),
    row({ carrier: "711" }), row({ carrier: "711", status: "at_store" }), row({ status: "at_store" }),
    row({ fm_site_state: "not_found", terminal: true }), // left the list: not counted anywhere unfinished
  ];
};
const sel = (q: unknown[][]) => String(q.find((c) => c[0] === "select")?.[1]);

describe("loadParcelTracking — 全家 on, sql/186 applied", () => {
  it("8 questions; the In transit count leaves the group out; the group has its own exact count", async () => {
    seed();
    const res = await loadParcelTracking(true);
    expect(res.ok).toBe(true);
    expect(DB.queries).toHaveLength(8);
    expect(res.totals).toMatchObject({ transit: 3, notDropped: 2, waiting: 2 }); // 2 全家 + 1 7-11 moving; 2 held
    expect(sel(DB.queries[0])).toBe(`${PT_SELECT}, carrier, fm_site_state, created_at`);
    const transitQ = DB.queries[5];
    expect(transitQ).toEqual(expect.arrayContaining([["eq", "status", "in_transit"], ["is", "fm_site_state", null]]));
    const heldQ = DB.queries[7];
    expect(heldQ).toEqual(expect.arrayContaining([["eq", "terminal", false], ["eq", "status", "in_transit"], ["eq", "carrier", "fm"], ["not", "fm_site_state", "is", null]]));
    const h = res.rows.find((r) => r.fmSiteState === "not_dropped");
    expect(h).toMatchObject({ carrier: "fm", createdAt: "2026-11-15T02:00:00Z" });
  });
});

describe("loadParcelTracking — sql/186 NOT applied yet", () => {
  const OLD_SELECT = `${PT_SELECT}, carrier`;
  it("the first read says 'no such column' → read again exactly as before (same select, 7 questions); later reads go straight to it", async () => {
    seed(); DB.noColumn = true;
    const res = await loadParcelTracking(true);
    expect(res.ok).toBe(true);
    expect(DB.queries).toHaveLength(15); // 8 refused + 7
    const second = DB.queries.slice(8);
    for (const q of second) expect(JSON.stringify(q)).not.toContain("fm_site_state");
    expect(sel(second[0])).toBe(OLD_SELECT);
    expect(res.totals).not.toHaveProperty("notDropped");
    expect(res.rows.every((r) => !("fmSiteState" in r))).toBe(true);
    DB.queries = [];
    await loadParcelTracking(true);
    expect(DB.queries).toHaveLength(7);
    expect(sel(DB.queries[0])).toBe(OLD_SELECT);
  });
  it("Load more falls back the same way", async () => {
    seed(); DB.noColumn = true;
    const res = await loadMoreLive(0, true);
    expect(res.ok).toBe(true);
    expect(DB.queries.map(sel)).toEqual([`${PT_SELECT}, carrier, fm_site_state, created_at`, OLD_SELECT]);
  });
  it("another read error is not retried (never partial — as before)", async () => {
    seed();
    const { supabase } = await import("../../../supabase");
    const spy = vi.spyOn(supabase!, "from").mockImplementation(() => ({ select: () => { throw new Error("boom"); } }) as never);
    await expect(loadParcelTracking(true)).rejects.toThrow("boom");
    spy.mockRestore();
  });
});

describe("全家 off — the read of before, byte for byte", () => {
  it("PT_SELECT alone, 6 questions (as on main), no saved-answer filter", async () => {
    seed();
    const res = await loadParcelTracking(false);
    expect(res.ok).toBe(true);
    expect(DB.queries).toHaveLength(6);
    expect(sel(DB.queries[0])).toBe(PT_SELECT);
    expect(JSON.stringify(DB.queries)).not.toContain("fm_site_state");
    expect(res.totals).not.toHaveProperty("notDropped");
  });
});
