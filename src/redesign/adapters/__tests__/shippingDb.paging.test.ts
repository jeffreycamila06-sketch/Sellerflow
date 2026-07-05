// EVIDENCE + regression for audit #12 (Batch C2): loadShippingEntries had no
// .range()/pager, so PostgREST silently caps the read at 1,000 rows — a heavy
// seller (~405 buyers/day × 3-day window, plus split bags) crosses that and the
// Shipping screen would silently drop the HIGHEST buyer numbers (re-saves could
// then double-create bags). The mock below simulates the PostgREST cap exactly:
// an un-ranged select returns at most 1,000 rows; .range(f,t) returns the slice.
import { describe, it, expect, vi } from "vitest";

const TOTAL = 1200;
const DATASET = Array.from({ length: TOTAL }, (_, i) => ({
  id: `row-${i + 1}`, session_key: "2026-07-03~3d", buyer_number: i + 1, bag_number: 1,
  included_order_ids: [], recipient_name: `B${i + 1}`, phone: "0912345678", store_id: "123456",
  temp_layer: "ambient", product_desc: "x", order_amount: 100, shipping_fee: 38,
  buyer_username: "", status: "encoded", export_batch_id: null, exported_at: null, shipped_at: null,
}));

const POSTGREST_CAP = 1000;
class FakeBuilder {
  private rangeArgs: [number, number] | null = null;
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  range(from: number, to: number) { this.rangeArgs = [from, to]; return this; }
  then(resolve: (v: { data: unknown[]; error: null }) => void) {
    const rows = this.rangeArgs
      ? DATASET.slice(this.rangeArgs[0], this.rangeArgs[1] + 1)
      : DATASET.slice(0, POSTGREST_CAP); // the silent server-side cap
    resolve({ data: rows, error: null });
  }
}

vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(() => new FakeBuilder()),
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })) },
  },
}));

import { loadShippingEntries } from "../shippingDb";

describe("loadShippingEntries paging (audit #12)", () => {
  it("heavy-seller window (1,200 encoded bags): returns ALL rows past the 1,000-row cap", async () => {
    const rows = await loadShippingEntries("2026-07-03~3d");
    console.log(`EVIDENCE: dataset=${TOTAL} rows · loadShippingEntries returned=${rows.length}` +
      (rows.length < TOTAL ? `  ← ${TOTAL - rows.length} NEWEST buyer bags silently dropped` : "  (complete)"));
    expect(rows).toHaveLength(TOTAL);                       // the old un-ranged read capped at 1,000
    expect(rows[TOTAL - 1].buyerNumber).toBe(TOTAL);        // highest buyer# retained
  });
});
