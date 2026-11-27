// WAYBILL USERNAME — one row per waybill page, the seller's choices, the counts, what gets written.
import { describe, expect, it } from "vitest";
import { buildRows, showRow, counts, stampsOf, tailOf, type PageFacts } from "../waybillRows";
import { buildCandidates, type CandidateRow } from "../waybillMatch";
import type { CsvOrder } from "../waybillCsv";

const TODAY = "2026-11-27";
const r = (handle: string, day = TODAY): CandidateRow => ({ user_id: "me", platform: "TikTok", session_date: day, handle, price: 100, qty: 1, created_at: `${day}T01:00:00Z` });
const CANDS = buildCandidates([r("ana_k8"), r("amy_b8", "2026-11-26"), r("mariel_3"), r("jessa.ukays")], "me", TODAY);
const ORDERS: CsvOrder[] = [
  { orderId: "580000000000000001", tracking: "JT0000000000001", masked: "m******3" },   // one → auto
  { orderId: "580000000000000002", tracking: "JT0000000000002", masked: "a****8" },     // two → pick
  { orderId: "580000000000000003", tracking: "JT0000000000003", masked: "z****9" },     // none → pick
  { orderId: null, tracking: "JT0000000000004", masked: "j*********s" },                // only the tracking number
  { orderId: "580000000000000005", tracking: null, masked: "m******3" },
];
const page = (index: number, orderId: string | null, words: string[] = [], slot: PageFacts["slot"] = { ok: true }): PageFacts => ({ index, orderId, words, slot });
const PAGES = [
  page(0, "580000000000000001"),
  page(1, "580000000000000002"),
  page(2, "580000000000000003"),
  page(3, null, ["JT0000000000004"]),             // found by its tracking number
  page(4, "589999999999999999"),                  // not in the order list
  page(5, null, [], { ok: false, reason: "unreadable" }),
  page(6, "580000000000000005", [], { ok: false, reason: "no_labels" }),
];
const rows = buildRows(PAGES, ORDERS, CANDS);
const all = (handle: string) => !!handle;

describe("rows", () => {
  it("each page gets its status", () => {
    expect(rows.map((x) => [x.index, x.status, x.handle])).toEqual([
      [0, "auto", "mariel_3"], [1, "pick", null], [2, "pick", null], [3, "auto", "jessa.ukays"],
      [4, "not_in_list", null], [5, "unreadable", null], [6, "no_room", null],
    ]);
    expect(rows[1].cands.map((c) => c.handle).sort()).toEqual(["amy_b8", "ana_k8"]);
    expect(rows[2].cands).toEqual([]);
  });
  it("the order id wins over the tracking number; the tracking number is the fallback", () => {
    const rr = buildRows([page(0, "580000000000000001", ["JT0000000000004"])], ORDERS, CANDS);
    expect(rr[0].masked).toBe("m******3");
    expect(tailOf(rows[3])).toBe("0004");
    expect(tailOf(rows[0])).toBe("0001");
  });
  it("shown: auto = stamp, pick = pick, the three messages", () => {
    const shown = rows.map((x) => showRow(x, undefined, (_, h) => all(h)));
    expect(shown.map((x) => x.kind)).toEqual(["stamp", "pick", "pick", "stamp", "not_in_list", "unreadable", "no_room"]);
    expect(counts(shown)).toEqual({ all: 7, added: 2, needs: 2 });
    expect([...stampsOf(shown)]).toEqual([[0, "mariel_3"], [3, "jessa.ukays"]]);
  });
  it("a pick → stamp; leave blank → printed without; changing an auto match works", () => {
    expect(showRow(rows[1], { handle: "ana_k8" }, () => true)).toMatchObject({ kind: "stamp", final: "ana_k8", picked: true });
    expect(showRow(rows[1], { handle: null }, () => true)).toMatchObject({ kind: "blank", final: null });
    expect(showRow(rows[0], { handle: "jessa.ukays" }, () => true)).toMatchObject({ kind: "stamp", final: "jessa.ukays", picked: true });
    expect(showRow(rows[0], { handle: null }, () => true).kind).toBe("blank");
  });
  it("a username that does not fit the space → 'couldn't place' (never in the stamps)", () => {
    const s = showRow(rows[0], undefined, () => false);
    expect(s.kind).toBe("cant_place");
    expect(stampsOf([s]).size).toBe(0);
  });
  it("a page with no place is never offered a pick (nothing could be written there)", () => {
    expect(showRow(rows[6], { handle: "ana_k8" }, () => true).kind).toBe("no_room");
  });
});
