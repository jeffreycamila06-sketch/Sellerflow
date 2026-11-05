// loadBuyerContacts reads BOTH the 7-11 and the FamilyMart sources whenever there is at least
// one row — a seller with only FamilyMart parcels still gets the 7-11 phonebook as the fallback
// map (and the other way round). Caps and the fail-open stay as they were.
import { describe, it, expect, vi, beforeEach } from "vitest";

const tables: string[] = [];
const builder = (): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "gte", "order"]) b[m] = () => b;
  b.range = async () => ({ data: [], error: null });
  return b;
};
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (t: string) => { tables.push(t); return builder(); },
  },
}));
vi.mock("../../../lib/log", () => ({ log: { warn: () => undefined } }));
import { loadBuyerContacts } from "../buyerContactMap";

beforeEach(() => { tables.length = 0; });

describe("loadBuyerContacts — both sources", () => {
  it("FamilyMart-only rows still read the 7-11 phonebook (and 7-11-only rows the FM one)", async () => {
    await loadBuyerContacts([{ handle: "pedro", carrier: "fm" }]);
    expect(tables).toEqual(["parcel_scans", "parcel_customers", "fm_parcel_scans", "fm_parcel_customers"]);
    tables.length = 0;
    await loadBuyerContacts([{ handle: "maria", carrier: "711" }]);
    expect(tables).toEqual(["parcel_scans", "parcel_customers", "fm_parcel_scans", "fm_parcel_customers"]);
    tables.length = 0;
    await loadBuyerContacts([{ handle: "maria" }]); // no carrier at all
    expect(tables).toEqual(["parcel_scans", "parcel_customers", "fm_parcel_scans", "fm_parcel_customers"]);
  });
  it("no usable handle → nothing is read", async () => {
    const out = await loadBuyerContacts([{ handle: "", carrier: "fm" }, { handle: null }]);
    expect(tables).toEqual([]);
    expect(out.s711.size + out.fm.size).toBe(0);
  });
});
