// REPORT ONLY (no change to orderLogic): numbering is `existing?.num || buyers.length + 1`.
// If one buyer's rows are missing from the session load — deleted, or never saved — the
// reloaded buyer COUNT drops below the highest number, so the next new buyer REPEATS an
// existing number. Pinned here as today's behaviour so any future change is deliberate.
import { describe, it, expect } from "vitest";
import { buildOrderFromComment, rebuildSessionFromRows, type LiveSessionRow } from "../orderLogic";

const row = (n: number, handle: string): LiveSessionRow => ({ buyer_number: n, handle, customer_name: handle, platform: "TikTok", product: "100", price: 100, created_at: `2026-10-04T0${n}:00:00Z`, session_date: "2026-10-04" });
const nextNew = (rows: LiveSessionRow[]) => buildOrderFromComment({ handle: "@new", name: "@new", comment: "", platform: "TikTok", time: "" } as never, rebuildSessionFromRows(rows).buyers, 100, new Date()).order.bNum;

describe("buyer count gap → repeated number (today's behaviour)", () => {
  const all = [row(1, "@a"), row(2, "@b"), row(3, "@c"), row(4, "@d"), row(5, "@e")];
  it("all rows present → next new buyer #6", () => {
    expect(nextNew(all)).toBe(6);
  });
  it("buyer #3's rows missing after a reload → next new buyer gets #5, which @e already has", () => {
    const withoutC = all.filter((r) => r.handle !== "@c");
    expect(nextNew(withoutC)).toBe(5);
    expect(withoutC.some((r) => r.buyer_number === 5)).toBe(true); // collision with @e
  });
});
