// 13. dry parcels' write payloads are byte-identical to main: frozen_store_status is sent ONLY for a
// 冷凍 row (Recheck with frozenRow=true, or an edit with resetChecks.frozen).
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { table: string; patch: Record<string, unknown> }[] = [];
const builder = (table: string) => {
  const b: Record<string, unknown> = {};
  b.update = (patch: Record<string, unknown>) => { calls.push({ table, patch }); return b; };
  b.eq = () => b;
  b.then = (f: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(f);
  return b;
};
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) }, from: (t: string) => builder(t) },
}));
import { resetExtensionChecks, updateParcelScan } from "../parcelScan";

beforeEach(() => { calls.length = 0; });
const F = { name: "A", phone: "0912345678", store_id: "266402", amount: 500, notes: "@a" };

describe("frozen_store_status in write payloads", () => {
  it("Recheck: a dry row's reset has exactly today's 6 keys; a 冷凍 row's adds frozen_store_status: null", async () => {
    await resetExtensionChecks("d1");
    expect(Object.keys(calls[0].patch)).toEqual(["store_full_status", "store_full_at", "phone_check_status", "phone_check_at", "phone_check_message", "phone_restricted_until"]);
    await resetExtensionChecks("f1", true);
    expect(calls[1].patch).toMatchObject({ frozen_store_status: null });
    expect(Object.keys(calls[1].patch)).toHaveLength(7);
  });
  it("edit: resetChecks without frozen → no frozen key (even with storeFull); frozen: true → frozen_store_status: null", async () => {
    await updateParcelScan("d1", F, { storeFull: true, phoneCheck: false });
    expect("frozen_store_status" in calls[0].patch).toBe(false);
    expect(calls[0].patch).toMatchObject({ store_full_status: null, store_full_at: null });
    await updateParcelScan("f1", F, { storeFull: true, phoneCheck: false, frozen: true });
    expect(calls[1].patch).toMatchObject({ store_full_status: null, frozen_store_status: null });
    await updateParcelScan("d2", F);
    expect("frozen_store_status" in calls[2].patch).toBe(false);
  });
});
