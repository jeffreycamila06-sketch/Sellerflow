// 2026-11-19 — a 全家 store-pickup row must land in its status tab and be counted WHATEVER the
// 好賣+ file called the delivery (配送方式 / 運送方式). 70 of 76 live 全家 rows were saved with
// ship_type "全家店寄店取": isChaseable() said no, groupParcels put them in "other" (web: only under
// All; phone: nowhere), and the exact tab counts left them out.
// 7-11 rows and their rules must not change: T4 compares every 7-11 row with the old rule.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── a small database that really applies the filters loadParcelTracking sends ─────────────────
type Row = Record<string, unknown>;
const DB = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: [] as unknown[][], fmHidden: false }));
vi.mock("../../../supabase", () => {
  const empty = (v: unknown) => v == null || v === "";
  class Q {
    f: ((r: Row) => boolean)[] = []; count = false; head = false; lim = Infinity; a = 0; b = Infinity; ord: [string, boolean][] = [];
    select(cols: string, o?: { count?: string; head?: boolean }) { DB.calls.push(["select", cols]); this.count = !!o?.count; this.head = !!o?.head; return this; }
    eq(c: string, v: unknown) { DB.calls.push(["eq", c, v]); this.f.push((r) => r[c] === v); return this; }
    in(c: string, v: unknown[]) { DB.calls.push(["in", c, v]); this.f.push((r) => v.includes(r[c])); return this; }
    is(c: string, v: unknown) { DB.calls.push(["is", c, v]); this.f.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, op: string, v: unknown) {
      DB.calls.push(["not", c, op, v]);
      if (op !== "is" || v !== null) throw new Error(`this fake does not know the filter: not ${op}`);
      this.f.push((r) => (r[c] ?? null) !== null);
      return this;
    }
    or(expr: string) {
      DB.calls.push(["or", expr]);
      if (expr !== "special_type.is.null,special_type.eq.") throw new Error(`this fake does not know the filter: ${expr}`);
      this.f.push((r) => empty(r.special_type));
      return this;
    }
    order(c: string, o?: { ascending?: boolean }) { this.ord.push([c, o?.ascending !== false]); return this; }
    range(a: number, b: number) { this.a = a; this.b = b; return this; }
    limit(n: number) { this.lim = n; return this; }
    then(res: (v: unknown) => unknown) {
      // 全家 switch off → the database itself hides 全家 rows (sql/119, restrictive policy)
      let list = DB.rows.filter((r) => !(DB.fmHidden && r.carrier === "fm")).filter((r) => this.f.every((g) => g(r)));
      const count = list.length;
      list = list.slice(this.a, this.b === Infinity ? undefined : this.b + 1).slice(0, this.lim);
      return Promise.resolve({ data: this.head ? null : list, count: this.count ? count : null, error: null }).then(res);
    }
  }
  return {
    isSupabaseConfigured: true,
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "U" } } } }) }, from: () => new Q() },
  };
});

import {
  loadParcelTracking, groupParcels, rowTab, tabCounts, tabRows, leftCell, sortByDaysLeft, isChaseable, isUnchecked, inStatusTabs, rowToTracking,
  FM_STORE_PICKUP_SAVED, PICKUP_STATUS_TABS, resetFmSiteColumnForTests, type ParcelTrackingRow,
} from "../parcelTracking";

const TODAY = "2026-11-19";
let n = 0;
const mk = (o: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `1635174${String(6000 + n)}`, cmOrderNo: `G26B${n}`, buyerUsername: `buyer${n}`, recipientName: null, storeId: "022131", recStore: "樹林新柑園店",
  status: "at_store", statusMessage: null, pickupDeadline: null, arrivedAt: null, shipType: "C2C", specialType: null, orderAmount: 339, terminal: false, ...o,
});
const fm = (o: Partial<ParcelTrackingRow> = {}) => mk({ carrier: "fm", shipType: "全家店寄店取", ...o });
const STATUSES = ["at_store", "in_transit", "picked_up", "returned"] as const;
const TAB_OF = { at_store: "waiting", in_transit: "transit", picked_up: "picked", returned: "returned" } as const;

beforeEach(() => { DB.rows = []; DB.calls = []; DB.fmHidden = false; resetFmSiteColumnForTests(); });

describe("T1 inStatusTabs — which row belongs in a status tab", () => {
  it("a 全家 row saved as 全家店寄店取 (the 70 live rows) → yes", () => {
    expect(inStatusTabs({ carrier: "fm", shipType: "全家店寄店取", specialType: null })).toBe(true);
    expect(inStatusTabs({ carrier: "fm", shipType: " 全家店寄店取 ", specialType: "" })).toBe(true);
  });
  it("a 全家 row saved as C2C (the older file's 店到店, and every new upload) → yes", () => {
    expect(inStatusTabs({ carrier: "fm", shipType: "C2C", specialType: null })).toBe(true);
  });
  it("a 全家 row whose saved text says home delivery / community pickup → no (as before)", () => {
    for (const t of ["宅配", "全家宅配", "社區取件"]) expect(inStatusTabs({ carrier: "fm", shipType: t, specialType: null }), t).toBe(false);
  });
  it("the saved words are exactly the two that exist in the live table", () => {
    expect([...FM_STORE_PICKUP_SAVED]).toEqual(["C2C", "全家店寄店取"]);
  });
  it("a 7-11 row is never helped by the 全家 words: only isChaseable decides", () => {
    for (const carrier of [undefined, "711"] as const) {
      expect(inStatusTabs({ carrier, shipType: "全家店寄店取", specialType: null })).toBe(false);
      expect(inStatusTabs({ carrier, shipType: "C2C", specialType: null })).toBe(true);
      expect(inStatusTabs({ carrier, shipType: "C2C", specialType: "4.店到宅服務單" })).toBe(false);
    }
  });
  it("a 全家 row with a special flow is not a plain store pickup (same rule as 7-11)", () => {
    expect(inStatusTabs({ carrier: "fm", shipType: "全家店寄店取", specialType: "4.店到宅服務單" })).toBe(false);
  });
});

describe("T2 groupParcels / rowTab / leftCell with 全家店寄店取 rows", () => {
  const rows = () => [
    fm({ id: "w1", status: "at_store", pickupDeadline: "2026-11-21" }),
    fm({ id: "w2", status: "at_store", pickupDeadline: "2026-11-25" }),
    fm({ id: "t1", status: "in_transit" }),
    fm({ id: "p1", status: "picked_up", terminal: true }),
    fm({ id: "x1", status: "returned", terminal: true }),
    fm({ id: "c1", status: "in_transit", shipType: "C2C" }),
  ];
  it("each row is in its status group — none in 'other'", () => {
    const g = groupParcels(rows(), TODAY);
    expect(g.waitingPickup.map((r) => r.id)).toEqual(["w1", "w2"]);
    expect(g.inTransit.map((r) => r.id).sort()).toEqual(["c1", "t1"]);
    expect(g.pickedUp.map((r) => r.id)).toEqual(["p1"]);
    expect(g.returned.map((r) => r.id)).toEqual(["x1"]);
    expect(g.other).toEqual([]);
  });
  it("rowTab gives the status tab for every status, and agrees with groupParcels", () => {
    for (const s of STATUSES) expect(rowTab(fm({ status: s })), s).toBe(TAB_OF[s]);
    const list = rows();
    const g = groupParcels(list, TODAY);
    const where = (id: string) => (g.waitingPickup.some((r) => r.id === id) ? "waiting" : g.inTransit.some((r) => r.id === id) ? "transit" : g.pickedUp.some((r) => r.id === id) ? "picked" : g.returned.some((r) => r.id === id) ? "returned" : null);
    for (const r of list) expect(rowTab(r), r.id).toBe(where(r.id));
  });
  it("tab counts (derived) count them; each status tab lists them", () => {
    const g = groupParcels(rows(), TODAY);
    expect(tabCounts(g)).toEqual({ all: 6, waiting: 2, transit: 2, picked: 1, returned: 1 });
    expect(tabRows(g, "waiting", TODAY).map((r) => r.id)).toEqual(["w1", "w2"]);
    for (const tab of PICKUP_STATUS_TABS) expect(tabRows(g, tab, TODAY).length, tab).toBeGreaterThan(0);
  });
  it("a waiting 全家 row has its days-left countdown (red at 2 days or fewer), a picked-up one says done", () => {
    expect(leftCell(fm({ status: "at_store", pickupDeadline: "2026-11-21" }), TODAY)).toEqual({ kind: "days", days: 2, urgent: true });
    expect(leftCell(fm({ status: "at_store", pickupDeadline: "2026-11-25" }), TODAY)).toEqual({ kind: "days", days: 6, urgent: false });
    expect(leftCell(fm({ status: "picked_up" }), TODAY)).toEqual({ kind: "done" });
    expect(leftCell(fm({ status: "returned" }), TODAY)).toEqual({ kind: "returned" });
  });
  it("in the 'all' list a waiting 全家 row ranks with the waiting rows, not at the bottom", () => {
    const list = [mk({ id: "seven-picked", status: "picked_up" }), fm({ id: "fm-wait", status: "at_store", pickupDeadline: "2026-11-30" })];
    expect(sortByDaysLeft(list, TODAY).map((r) => r.id)).toEqual(["fm-wait", "seven-picked"]);
  });
  it("a 全家 home-delivery row stays in 'other' (web: only under All), as before", () => {
    const g = groupParcels([fm({ id: "home", shipType: "宅配" })], TODAY);
    expect(g.other.map((r) => r.id)).toEqual(["home"]);
    expect(rowTab(fm({ shipType: "宅配" }))).toBeNull();
  });
  it("the store filter's list (全家 rows only, grouped the same way) is no longer empty", () => {
    const all = [mk({ id: "s1" }), mk({ id: "s2", status: "in_transit" }), ...rows()];
    const onlyFm = all.filter((r) => (r.carrier === "fm" ? "fm" : "711") === "fm");
    expect(tabCounts(groupParcels(onlyFm, TODAY))).toEqual({ all: 6, waiting: 2, transit: 2, picked: 1, returned: 1 });
    const only711 = all.filter((r) => (r.carrier === "fm" ? "fm" : "711") === "711");
    expect(tabCounts(groupParcels(only711, TODAY))).toEqual({ all: 2, waiting: 1, transit: 1, picked: 0, returned: 0 });
  });
});

describe("T3 the exact tab counts from the database (loadParcelTracking totals)", () => {
  const db = (o: Row) => ({ id: `d${++n}`, user_id: "U", tracking_no: "16351746626", status: "at_store", ship_type: "C2C", special_type: null, terminal: false, carrier: "711", pickup_deadline: null, ...o });
  const LIVE = () => [
    db({ status: "at_store" }), db({ status: "at_store" }), db({ status: "in_transit" }),           // 7-11 store pickup
    db({ status: "at_store", special_type: "4.店到宅服務單" }),                                       // 7-11 home delivery
    db({ status: "created", ship_type: null }),                                                       // 7-11 not checked yet
    ...[1, 2, 3].map(() => db({ carrier: "fm", ship_type: "全家店寄店取", status: "at_store" })),
    ...[1, 2].map(() => db({ carrier: "fm", ship_type: "全家店寄店取", status: "in_transit" })),
    db({ carrier: "fm", ship_type: "C2C", status: "in_transit" }),
    db({ carrier: "fm", ship_type: "宅配", status: "at_store" }),                                     // 全家 home delivery: not a store pickup
    ...[1, 2].map(() => db({ carrier: "fm", ship_type: "全家店寄店取", status: "picked_up", terminal: true })),
    db({ carrier: "fm", ship_type: "全家店寄店取", status: "returned", terminal: true }),
  ];
  it("全家 on: Waiting and In transit count the 全家店寄店取 rows", async () => {
    DB.rows = LIVE();
    const r = await loadParcelTracking(true);
    expect(r.ok).toBe(true);
    // waiting: 2 (7-11) + 3 (全家); transit: 1 (7-11) + 1 (7-11 not checked yet) + 2 + 1 (全家)
    expect(r.totals).toMatchObject({ waiting: 5, transit: 5, picked: 2, returned: 1 });
  });
  it("the numbers agree with the lists the screen builds from the same rows", async () => {
    DB.rows = LIVE();
    const r = await loadParcelTracking(true);
    const g = groupParcels(r.rows, TODAY);
    expect(g.waitingPickup.length).toBe(r.totals!.waiting);
    expect(g.inTransit.length).toBe(r.totals!.transit);
    expect(g.pickedUp.length).toBe(r.totals!.picked);
    expect(g.returned.length).toBe(r.totals!.returned);
    expect(g.other.map((x) => x.shipType).sort()).toEqual(["C2C", "宅配"]); // the 7-11 home delivery + the 全家 home delivery
  });
  it("全家 on: a 7-11 home-delivery row and a 全家 home-delivery row are still not counted", async () => {
    DB.rows = [db({ status: "at_store", special_type: "4.店到宅服務單" }), db({ carrier: "fm", ship_type: "宅配", status: "at_store" }), db({ carrier: "fm", ship_type: "社區取件", status: "in_transit" })];
    const r = await loadParcelTracking(true);
    expect(r.totals).toMatchObject({ waiting: 0, transit: 0 });
  });
  it("全家 on, 7-11 rows only: the same numbers as with 全家 off", async () => {
    const seven = () => LIVE().filter((x) => x.carrier === "711");
    DB.rows = seven();
    const on = await loadParcelTracking(true);
    DB.rows = seven();
    const off = await loadParcelTracking();
    expect(on.totals).toEqual({ ...off.totals, notDropped: 0 }); // the same numbers; 全家 on also carries the (empty) group count
    expect(off.totals).toMatchObject({ waiting: 2, transit: 2 });
    expect("notDropped" in off.totals!).toBe(false);
  });
  it("全家 off: the count questions are EXACTLY the old ones (ship_type = C2C), and no 全家 word is sent", async () => {
    DB.rows = LIVE();
    DB.fmHidden = true; // what the database does while 全家 is off for this seller
    const r = await loadParcelTracking();
    expect(r.totals).toMatchObject({ waiting: 2, transit: 2 });
    expect(DB.calls.filter((c) => c[0] === "eq" && c[1] === "ship_type")).toEqual([["eq", "ship_type", "C2C"], ["eq", "ship_type", "C2C"]]);
    expect(DB.calls.some((c) => c[0] === "in")).toBe(false);
    expect(JSON.stringify(DB.calls)).not.toContain("全家");
    expect(DB.calls.some((c) => c[0] === "eq" && c[1] === "carrier")).toBe(false);
  });
  it("全家 on: 8 questions (the 7 of before + the count of the 'not dropped off yet' group), same delivery-type filter", async () => {
    DB.rows = LIVE();
    await loadParcelTracking(true);
    const on = DB.calls.slice();
    DB.calls = [];
    await loadParcelTracking();
    const off = DB.calls.slice();
    const selects = (c: unknown[][]) => c.filter((x) => x[0] === "select").length;
    expect(selects(on)).toBe(8);
    expect(selects(off)).toBe(6); // 全家 off never asks for the not-checked-yet 全家 rows, nor for the group
    // three counts carry the delivery-type filter now: at a store, moving, and the group
    expect(on.filter((c) => c[0] === "in")).toEqual(Array(3).fill(["in", "ship_type", ["C2C", "全家店寄店取"]]));
    expect(on.some((c) => c[0] === "eq" && c[1] === "ship_type")).toBe(false);
    // the "no special flow" condition is the same sentence in both
    expect(new Set(on.filter((c) => c[0] === "or").map((c) => c[1]))).toEqual(new Set(off.filter((c) => c[0] === "or").map((c) => c[1])));
    // 全家 off: nothing of the saved answer is ever sent
    expect(off.some((c) => c[0] === "is" || c[0] === "not")).toBe(false);
    expect(JSON.stringify(off)).not.toContain("fm_site_state");
  });
});

describe("T4 7-11 rows: every tab decision is the old rule", () => {
  // the rule as it was before 2026-11-19, written out
  const oldRowTab = (row: ParcelTrackingRow) => {
    if (isUnchecked(row)) return row.carrier === "fm" ? "waiting" : "transit";
    if (!isChaseable(row.shipType, row.specialType)) return null;
    return row.status === "at_store" ? "waiting" : row.status === "in_transit" ? "transit" : row.status === "picked_up" ? "picked" : row.status === "returned" ? "returned" : null;
  };
  const SHIP = ["C2C", "c2c", " C2C ", null, "", "B2C", "全家店寄店取", "宅配", "店到店"];
  const SPECIAL = [null, "", "4.店到宅服務單", "0.退貨便服務單"];
  const STATUS = ["created", "at_store", "in_transit", "picked_up", "returned", "not_found", "weird"];
  it("carrier 7-11 (and no carrier at all): rowTab and groupParcels are unchanged for every ship type × special type × status", () => {
    let rows = 0;
    for (const carrier of [undefined, "711"] as const) for (const shipType of SHIP) for (const specialType of SPECIAL) for (const status of STATUS) {
      rows += 1;
      const r = mk({ status, shipType, specialType, ...(carrier ? { carrier } : {}) });
      const want = oldRowTab(r);
      expect(rowTab(r), `${carrier} ${shipType} ${specialType} ${status}`).toBe(want);
      const g = groupParcels([r], TODAY);
      const got = g.waitingPickup.length ? "waiting" : g.inTransit.length ? "transit" : g.pickedUp.length ? "picked" : g.returned.length ? "returned" : null;
      expect(got, `${carrier} ${shipType} ${specialType} ${status}`).toBe(want);
    }
    expect(rows).toBe(2 * 9 * 4 * 7);
  });
  it("isChaseable itself is untouched (it mirrors the server's rule)", () => {
    expect(isChaseable("全家店寄店取", null)).toBe(false);
    expect(isChaseable("C2C", null)).toBe(true);
    expect(isChaseable("C2C", "4.店到宅服務單")).toBe(false);
  });
  it("a 全家 row that is not checked yet keeps its place under Waiting", () => {
    expect(rowTab(rowToTracking({ id: "1", status: "created", carrier: "fm" }))).toBe("waiting");
  });
});
