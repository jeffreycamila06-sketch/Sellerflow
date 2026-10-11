// 全家 (sql/119) in the Pickup Status reads: switch off → the exact pre-全家 select (no carrier);
// switch on → `carrier` is read and set on the row. Urgent never counts a 全家 parcel.
import { describe, it, expect, vi, beforeEach } from "vitest";

const selects: string[] = [];
const rows = [{ id: "1", tracking_no: "F1", status: "at_store", carrier: "fm", terminal: false }];
const chain = (): Record<string, unknown> => {
  const ch: Record<string, unknown> = {};
  for (const m of ["eq", "or", "order", "limit", "range", "in", "is"]) ch[m] = () => ch;
  ch.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, count: 1, error: null }).then(f);
  return ch;
};
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "U" } } } }) },
    from: () => ({ select: (s: string) => { selects.push(s); return chain(); } }),
  },
}));

import { loadParcelTracking, loadMoreLive, PT_SELECT, urgentEligible, rowToTracking } from "../parcelTracking";

beforeEach(() => { selects.length = 0; });

describe("Pickup Status reads + 全家", () => {
  it("switch off: every select is the pre-全家 one and rows carry no carrier", async () => {
    const r = await loadParcelTracking();
    await loadMoreLive(0);
    expect(selects.filter((s) => s !== "id").every((s) => s === PT_SELECT)).toBe(true);
    expect(selects.some((s) => s.includes("carrier"))).toBe(false);
    expect(r.rows[0].carrier).toBe("fm"); // the mock returns it anyway; the select never asks for it
  });
  it("switch on: the row selects add carrier", async () => {
    await loadParcelTracking(true);
    await loadMoreLive(0, true);
    expect(selects.filter((s) => s !== "id").every((s) => s === PT_SELECT + ", carrier")).toBe(true);
  });
  it("rowToTracking sets carrier only when present", () => {
    expect("carrier" in rowToTracking({ id: "1" })).toBe(false);
    expect(rowToTracking({ id: "1", carrier: "711" }).carrier).toBe("711");
  });
  it("urgent ignores 全家 rows", () => {
    const at = (carrier?: "fm" | "711") => ({ ...rowToTracking({ id: "1", status: "at_store", pickup_deadline: "2026-10-11", ...(carrier ? { carrier } : {}) }) });
    expect(urgentEligible([at("fm")], "2026-10-11")).toBe(false);
    expect(urgentEligible([at("711")], "2026-10-11")).toBe(true);
    expect(urgentEligible([at()], "2026-10-11")).toBe(true);
  });
});
