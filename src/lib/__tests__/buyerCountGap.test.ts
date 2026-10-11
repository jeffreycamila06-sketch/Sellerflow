// Numbering is `existing?.num || nextBuyerNumber(buyers)` = highest number + 1. It used to be
// buyers.length + 1: when one buyer's rows were missing from the session load (deleted, or never
// saved) the count dropped below the highest number and the next new buyer REPEATED an existing
// number. Changed 2026-10-11 (duplicate buyer numbers inside one multi-day session).
import { describe, it, expect } from "vitest";
import { buildOrderFromComment, rebuildSessionFromRows, type LiveSessionRow } from "../orderLogic";

const row = (n: number, handle: string): LiveSessionRow => ({ buyer_number: n, handle, customer_name: handle, platform: "TikTok", product: "100", price: 100, created_at: `2026-10-04T0${n}:00:00Z`, session_date: "2026-10-04" });
const nextNew = (rows: LiveSessionRow[]) => buildOrderFromComment({ handle: "@new", name: "@new", comment: "", platform: "TikTok", time: "" } as never, rebuildSessionFromRows(rows).buyers, 100, new Date()).order.bNum;

describe("buyer count gap → next number", () => {
  const all = [row(1, "@a"), row(2, "@b"), row(3, "@c"), row(4, "@d"), row(5, "@e")];
  it("all rows present → next new buyer #6", () => {
    expect(nextNew(all)).toBe(6);
  });
  it("buyer #3's rows missing after a reload → next new buyer still gets #6 (not #5, which @e has)", () => {
    expect(nextNew(all.filter((r) => r.handle !== "@c"))).toBe(6);
  });
});
