// Pickup Status redesign — PURE tab helpers (rowTab / leftCell / sortByDaysLeft / tabRows /
// tabCounts). Presentation only: same rows + same grouping as groupParcels.
import { describe, it, expect } from "vitest";
import {
  groupParcels, rowTab, leftCell, sortByDaysLeft, tabRows, tabCounts, PICKUP_TABS, PICKUP_STATUS_TABS,
  type ParcelTrackingRow,
} from "../parcelTracking";

const TODAY = "2026-09-24";
let n = 0;
const mk = (over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `F${n}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: null,
  storeId: "Store A", recStore: null, status: "at_store", statusMessage: null, pickupDeadline: null,
  arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, ...over,
});

describe("rowTab — mirrors groupParcels' bucketing (parity)", () => {
  it("maps statuses; non-chaseable / created / not_found → null (the 'other' bucket)", () => {
    expect(rowTab(mk({ status: "at_store" }))).toBe("waiting");
    expect(rowTab(mk({ status: "in_transit" }))).toBe("transit");
    expect(rowTab(mk({ status: "picked_up" }))).toBe("picked");
    expect(rowTab(mk({ status: "returned" }))).toBe("returned");
    expect(rowTab(mk({ status: "created" }))).toBeNull();
    expect(rowTab(mk({ status: "at_store", shipType: "HOME" }))).toBeNull();
    expect(rowTab(mk({ status: "at_store", specialType: "return" }))).toBeNull();
  });
  it("agrees with groupParcels for every row", () => {
    const rows = ["at_store", "in_transit", "picked_up", "returned", "created", "not_found"].flatMap((s) =>
      [mk({ status: s }), mk({ status: s, shipType: "HOME" })]);
    const g = groupParcels(rows, TODAY);
    const byGroup = new Map<string, string | null>();
    g.waitingPickup.forEach((r) => byGroup.set(r.id, "waiting"));
    g.inTransit.forEach((r) => byGroup.set(r.id, "transit"));
    g.pickedUp.forEach((r) => byGroup.set(r.id, "picked"));
    g.returned.forEach((r) => byGroup.set(r.id, "returned"));
    g.other.forEach((r) => byGroup.set(r.id, null));
    for (const r of rows) expect(rowTab(r)).toBe(byGroup.get(r.id));
  });
});

describe("leftCell — the 'Left' column", () => {
  it("waiting: days until pickup_deadline; urgent when ≤2 days (incl. overdue) or returning-soon", () => {
    expect(leftCell(mk({ pickupDeadline: "2026-09-29" }), TODAY)).toEqual({ kind: "days", days: 5, urgent: false });
    expect(leftCell(mk({ pickupDeadline: "2026-09-26" }), TODAY)).toEqual({ kind: "days", days: 2, urgent: true });
    expect(leftCell(mk({ pickupDeadline: "2026-09-24" }), TODAY)).toEqual({ kind: "days", days: 0, urgent: true });
    expect(leftCell(mk({ pickupDeadline: "2026-09-22" }), TODAY)).toEqual({ kind: "days", days: -2, urgent: true });
    expect(leftCell(mk({ pickupDeadline: "2026-09-30", statusMessage: "將退回物流中心" }), TODAY)).toEqual({ kind: "days", days: 6, urgent: true });
    expect(leftCell(mk({ pickupDeadline: null }), TODAY)).toEqual({ kind: "days", days: null, urgent: false });
  });
  it("in transit → none ('—'); picked up → done; returned → returned; other → none", () => {
    expect(leftCell(mk({ status: "in_transit" }), TODAY)).toEqual({ kind: "none" });
    expect(leftCell(mk({ status: "picked_up", pickupDeadline: "2026-09-01" }), TODAY)).toEqual({ kind: "done" });
    expect(leftCell(mk({ status: "returned" }), TODAY)).toEqual({ kind: "returned" });
    expect(leftCell(mk({ status: "created" }), TODAY)).toEqual({ kind: "none" });
  });
});

describe("sortByDaysLeft — most urgent first", () => {
  it("days-left ascending; no deadline last; returning-soon wins a tie; never mutates", () => {
    const a = mk({ pickupDeadline: "2026-09-29" });               // 5
    const b = mk({ pickupDeadline: "2026-09-25" });               // 1
    const c = mk({ pickupDeadline: null });                       // none
    const d = mk({ pickupDeadline: "2026-09-22" });               // -2 (overdue)
    const e = mk({ pickupDeadline: "2026-09-25", statusMessage: "將退回" }); // 1, returning soon
    const input = [a, b, c, d, e];
    const out = sortByDaysLeft(input, TODAY);
    expect(out.map((r) => r.id)).toEqual([d.id, e.id, b.id, a.id, c.id]);
    expect(input.map((r) => r.id)).toEqual([a.id, b.id, c.id, d.id, e.id]); // untouched
  });
  it("in the mixed 'all' list a picked-up parcel's stale past deadline never floats above a live waiting one", () => {
    const picked = mk({ status: "picked_up", pickupDeadline: "2026-08-01" });  // very "overdue" but done
    const waiting = mk({ status: "at_store", pickupDeadline: "2026-09-29" });
    const transit = mk({ status: "in_transit" });
    const other = mk({ status: "created" });
    expect(sortByDaysLeft([other, picked, transit, waiting], TODAY).map((r) => r.id))
      .toEqual([waiting.id, transit.id, picked.id, other.id]);
  });
});

describe("tabRows / tabCounts", () => {
  const rows = [
    mk({ status: "at_store", pickupDeadline: "2026-09-29" }),
    mk({ status: "at_store", pickupDeadline: "2026-09-25", buyerUsername: null }), // no username — stays visible
    mk({ status: "in_transit" }),
    mk({ status: "picked_up" }),
    mk({ status: "returned" }),
    mk({ status: "created" }),                         // other
    mk({ status: "at_store", shipType: "HOME" }),      // other (non-chaseable)
  ];
  const g = groupParcels(rows, TODAY);

  it("counts per tab; 'all' counts every row incl. the other bucket", () => {
    expect(tabCounts(g)).toEqual({ all: 7, waiting: 2, transit: 1, picked: 1, returned: 1 });
  });
  it("'all' keeps every row (nothing disappears); status tabs are exact", () => {
    expect(tabRows(g, "all", TODAY)).toHaveLength(7);
    expect(tabRows(g, "waiting", TODAY).map((r) => r.status)).toEqual(["at_store", "at_store"]);
    expect(tabRows(g, "transit", TODAY)).toHaveLength(1);
  });
  it("a no-username parcel is visible in its status tab, sorted by days-left", () => {
    const w = tabRows(g, "waiting", TODAY);
    expect(w[0].buyerUsername).toBeNull();        // 1 day left → first
    expect(w[1].pickupDeadline).toBe("2026-09-29");
  });
  it("tab + card order follows the real parcel flow (transit → waiting → picked → returned)", () => {
    expect(PICKUP_TABS).toEqual(["all", "transit", "waiting", "picked", "returned"]);
    expect(PICKUP_STATUS_TABS).toEqual(["transit", "waiting", "picked", "returned"]);
  });
});
