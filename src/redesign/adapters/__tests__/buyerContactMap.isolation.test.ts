// loadBuyerContacts: the 7-11 reads and the FamilyMart reads fail on their own — a failed
// FamilyMart read empties the FM map only, the 7-11 map it already built stays (and the other
// way round). A read that fails mid-way leaves no partial map for THAT carrier.
import { describe, it, expect, vi } from "vitest";

const mode = { failFm: false, fail711: false };
const builder = (table: string): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "gte", "order"]) b[m] = () => b;
  b.range = async () => {
    if ((table.startsWith("fm_") && mode.failFm) || (!table.startsWith("fm_") && mode.fail711)) throw new Error("network");
    const rows = table === "parcel_scans" ? [{ notes: "maria", store_id: "1", contact_platform: "whatsapp" }]
      : table === "fm_parcel_scans" ? [{ buyer_username: "pedro", store_id: "2", contact_platform: "line" }] : [];
    return { data: rows, error: null };
  };
  return b;
};
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) }, from: (t: string) => builder(t) },
}));
vi.mock("../../../lib/log", () => ({ log: { warn: () => undefined } }));
import { loadBuyerContacts } from "../buyerContactMap";

const rows = [{ handle: "maria", carrier: "711" as const }, { handle: "pedro", carrier: "fm" as const }];

describe("loadBuyerContacts — per-carrier failure isolation", () => {
  it("both fine → both maps", async () => {
    mode.failFm = false; mode.fail711 = false;
    const out = await loadBuyerContacts(rows);
    expect(out.s711.get("maria")).toBe("whatsapp");
    expect(out.fm.get("pedro")).toBe("line");
  });
  it("FamilyMart read throws → FM map empty, 7-11 map kept", async () => {
    mode.failFm = true; mode.fail711 = false;
    const out = await loadBuyerContacts(rows);
    expect(out.s711.get("maria")).toBe("whatsapp");
    expect(out.fm.size).toBe(0);
  });
  it("7-11 read throws → 7-11 map empty, FM map kept", async () => {
    mode.failFm = false; mode.fail711 = true;
    const out = await loadBuyerContacts(rows);
    expect(out.s711.size).toBe(0);
    expect(out.fm.get("pedro")).toBe("line");
  });
});
