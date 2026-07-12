// REPRINT — ⚠️ THE ZERO-WRITE CONTRACT (Jeff's hard gate) + parity suite.
// A reprint tap must be printSlip and NOTHING else: no saveOrderToDatabase,
// no saveLiveSessionOrder, no saveCustomerToDatabase, no stock RPC, no
// free-cap RPC — a copy of the original sticker, zero state change. The
// buyer sent to printSlip must carry the ORIGINAL order's data (bNum /
// product / price / orderNum), not fresh values.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

// Spy on EVERY write surface the order fan-out uses. reprint.ts must never
// import these — the mocks prove that even transitively, a reprint triggers
// zero calls (if a future edit routes a reprint anywhere near the create
// path, these spies turn red).
const dbMocks = vi.hoisted(() => ({
  saveOrderToDatabase: vi.fn(),
  saveLiveSessionOrder: vi.fn(),
  saveCustomerToDatabase: vi.fn(),
}));
vi.mock("../../../db", () => dbMocks);
const stockMock = vi.hoisted(() => ({ decrementStockAndTouch: vi.fn() }));
vi.mock("../productsDb", () => stockMock);
const printSlipMock = vi.hoisted(() => vi.fn(() => ({ ok: true, via: "bluetooth" as const })));
vi.mock("../printing", async (orig) => ({ ...(await orig() as object), printSlip: (...a: unknown[]) => printSlipMock(...a) }));

import { snapshotFromCreate, reprintBuyer, performReprint, type ReprintRow } from "../reprint";
import { buildOrderFromComment, rebuildSessionFromRows } from "../../../lib/orderLogic";
import { buildOrderedMsgIds } from "../useLiveSession";
import { DEF_SETTINGS } from "../printing";
import type { Buyer } from "../../../lib/orderTypes";

const COMMENT: ProdComment = {
  platform: "TikTok", handle: "jojo_tw", name: "Aileen Go", comment: "mine red lipstick",
  timestamp: "2026-07-12T03:00:00.000Z", time: "11:00:00 AM",
} as ProdComment;

const ROW: ReprintRow = {
  buyer_number: 7, handle: "jojo_tw", customer_name: "Aileen Go", platform: "TikTok",
  product: "mine red lipstick", price: 150, created_at: "2026-07-12T03:00:05.000Z",
  session_date: "2026-07-12",
};

beforeEach(() => { vi.clearAllMocks(); });

describe("⚠️ ZERO-WRITE CONTRACT — a reprint is printSlip and nothing else", () => {
  it("performReprint → printSlip called ONCE; every write surface called ZERO times", () => {
    const r = performReprint(ROW, "NT$", "MyStore", DEF_SETTINGS);
    expect(r.ok).toBe(true);
    expect(printSlipMock).toHaveBeenCalledTimes(1);
    expect(dbMocks.saveOrderToDatabase).not.toHaveBeenCalled();       // billing ledger untouched
    expect(dbMocks.saveLiveSessionOrder).not.toHaveBeenCalled();      // no new session row / buyer#
    expect(dbMocks.saveCustomerToDatabase).not.toHaveBeenCalled();    // no CRM bump
    expect(stockMock.decrementStockAndTouch).not.toHaveBeenCalled();  // no stock deduction
  });

  it("printSlip receives the ORIGINAL order's data — bNum / product / price / orderNum (original Taiwan time), same cfg snapshot", () => {
    performReprint(ROW, "NT$", "MyStore", DEF_SETTINGS);
    const [buyer, cur, store, cfg] = printSlipMock.mock.calls[0] as [Buyer, string, string, unknown];
    expect(buyer.num).toBe(7);                                        // ORIGINAL buyer#, not a new one
    expect(buyer.name).toBe("Aileen Go");
    expect(buyer.handle).toBe("jojo_tw");
    expect(buyer.orders).toHaveLength(1);
    expect(buyer.orders[0].item).toBe("mine red lipstick");
    expect(buyer.orders[0].price).toBe(150);
    expect(buyer.orders[0].total).toBe(150);
    expect(buyer.orders[0].orderNum).toBe(Date.parse("2026-07-12T03:00:05.000Z")); // original epoch ms → original Taiwan time on the sticker
    expect(cur).toBe("NT$"); expect(store).toBe("MyStore"); expect(cfg).toBe(DEF_SETTINGS);
  });

  it("unresolvable snapshot (defensive) → honest {ok:false}, printSlip NOT called", () => {
    const r = performReprint(null as unknown as ReprintRow, "NT$", "S", DEF_SETTINGS);
    expect(r).toEqual({ ok: false, via: "none" });
    expect(printSlipMock).not.toHaveBeenCalled();
  });
});

describe("parity — the reprint buyer is built by the REAL session rebuild (no drifting copy)", () => {
  it("reprintBuyer(row) === rebuildSessionFromRows([row]).buyers[0] (identical object content)", () => {
    expect(reprintBuyer(ROW)).toEqual(rebuildSessionFromRows([ROW]).buyers[0]);
  });

  it("snapshotFromCreate round-trip: reprinting an in-session order reproduces the ORIGINAL printed buyer (buildOrderFromComment.singleOrderBuyer print fields)", () => {
    const { order, singleOrderBuyer } = buildOrderFromComment(COMMENT, [], 150, new Date("2026-07-12T03:00:05.000Z"));
    const snap = snapshotFromCreate(COMMENT, order);
    const reprinted = reprintBuyer(snap)!;
    // Every field the sticker/slip renders must round-trip exactly:
    expect(reprinted.num).toBe(singleOrderBuyer.num);
    expect(reprinted.name).toBe(singleOrderBuyer.name);
    expect(reprinted.handle).toBe(singleOrderBuyer.handle);
    expect(reprinted.platform).toBe(singleOrderBuyer.platform);
    expect(reprinted.totalSpent).toBe(singleOrderBuyer.totalSpent);
    expect(reprinted.orders[0].item).toBe(singleOrderBuyer.orders[0].item);
    expect(reprinted.orders[0].price).toBe(singleOrderBuyer.orders[0].price);
    expect(reprinted.orders[0].total).toBe(singleOrderBuyer.orders[0].total);
    expect(reprinted.orders[0].bNum).toBe(singleOrderBuyer.orders[0].bNum);
    expect(reprinted.orders[0].orderNum).toBe(singleOrderBuyer.orders[0].orderNum); // epoch ms survives the ISO round-trip
  });
});

describe("ordered-check map upgrade (Set → Map) — same .has() semantics + the row rides along", () => {
  it("buildOrderedMsgIds: msgId → row; E3 (empty msgIds never enter); first-wins per msgId", () => {
    const rows = [
      { ...ROW, comment_msg_id: "m1" },
      { ...ROW, buyer_number: 8, comment_msg_id: "m1" },            // duplicate msgId (defensive) — first wins
      { ...ROW, buyer_number: 9, comment_msg_id: "" },              // E3: never enters
      { ...ROW, buyer_number: 10, comment_msg_id: "  " },           // E3: whitespace never enters
      { ...ROW, buyer_number: 11, comment_msg_id: "m2" },
    ];
    const map = buildOrderedMsgIds(rows);
    expect(map.size).toBe(2);
    expect(map.has("m1")).toBe(true);                                // ordered-check semantics unchanged
    expect(map.get("m1")!.buyer_number).toBe(7);                     // FIRST row (the original order)
    expect(map.get("m2")!.buyer_number).toBe(11);
    expect(map.has("")).toBe(false);
  });
});
