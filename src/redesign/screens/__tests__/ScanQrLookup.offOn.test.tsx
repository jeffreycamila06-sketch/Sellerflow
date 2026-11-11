// Scan QR → fill from Customers with the REAL read (nothing of the lookup is mocked) and a recording
// database client, from the screen down:
//   OFF (switch off and login not listed) → the Customers tables are NEVER read by a scan.
//   ON → exactly ONE read per scan, of THIS screen's Customers table only, own rows only; the NEWEST
//        record of the username (rule #4) fills the form.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { TProvider } from "../../i18n";
import { clearParcelDrafts } from "../../adapters/parcelDrafts";

const h = vi.hoisted(() => ({
  reads: [] as { table: string; eq: unknown[][]; or: string[]; writes: string[] }[],
  rows: {} as Record<string, Record<string, unknown>[]>,
  fail: false,
  decode: vi.fn(),
}));
vi.mock("../../../supabase", () => {
  const from = (table: string) => {
    const rec = { table, eq: [] as unknown[][], or: [] as string[], writes: [] as string[] };
    h.reads.push(rec);
    const q: unknown = new Proxy(function () { /* chain */ }, {
      get(_t, prop: string) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(h.fail ? { data: null, error: { message: "boom" }, count: 0 } : { data: h.rows[table] ?? [], error: null, count: 0 }).then(res, rej);
        return (...args: unknown[]) => {
          if (prop === "eq") rec.eq.push(args);
          if (prop === "or") rec.or.push(String(args[0]));
          if (["insert", "update", "upsert", "delete"].includes(prop)) rec.writes.push(prop);
          return q;
        };
      },
    });
    return q;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: { getSession: async () => ({ data: { session: { user: { id: "me-1" }, access_token: "t" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* none */ } } } }) },
    },
  };
});
vi.mock("../../adapters/fmScan", async (orig) => ({
  ...(await orig<typeof import("../../adapters/fmScan")>()),
  saveFmScan: vi.fn(), loadFmScans: async () => ({ ok: true, rows: [] }), deleteFmScan: vi.fn(), loadFmGlobalFee: async () => 39,
}));
vi.mock("../../adapters/parcelScan", async (orig) => ({
  ...(await orig<typeof import("../../adapters/parcelScan")>()),
  saveParcelScan: vi.fn(), loadParcelScans: async () => ({ ok: true, rows: [] }),
  loadLastExportBatch: async () => ({ ok: true, batch: null }), loadUndeliveredExports: async () => ({ ok: true, batches: [] }),
  checkEmapStore: async () => ({ status: "valid" }), saveStoreCheck: async () => ({ ok: true }),
  getCreditBalance: async () => ({ ok: true, balance: 5 }), updateParcelScan: async () => ({ ok: true }),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile: h.decode }));

import ParcelScan from "../ParcelScan";
import FmParcelScan from "../FmParcelScan";

const CUSTOMER_TABLES = ["parcel_customers", "fm_parcel_customers"];
const customerReads = () => h.reads.filter((r) => CUSTOMER_TABLES.includes(r.table));
const row = (id: string, user: string, username: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: user, name, phone: "0911222333", store_id: "246810", notes: username, buyer_username: username, contact_platform: null, updated_at: "2026-11-01T02:00:00+00:00", ...extra,
});
const SCREENS = {
  "711": { p: "ps", handle: "ps-notes", table: "parcel_customers", col: "notes", el: (on: boolean) => <ParcelScan cur="NT$" manualOnly lookupOn={on} /> },
  fm: { p: "fms", handle: "fms-username", table: "fm_parcel_customers", col: "buyer_username", el: (on: boolean) => <FmParcelScan cur="NT$" lookupOn={on} /> },
};

beforeEach(() => { h.reads.length = 0; h.rows = {}; h.fail = false; h.decode.mockReset(); });
afterEach(() => { cleanup(); clearParcelDrafts(); });

describe.each(Object.keys(SCREENS) as (keyof typeof SCREENS)[])("%s Parcel Scan — the real read", (key) => {
  const S = SCREENS[key];
  const id = (s: string) => `${S.p}-${s}`;
  const name = (r: ReturnType<typeof render>) => (r.getByTestId(id("name")) as HTMLInputElement).value;
  const openAndScan = async (on: boolean, payload: string, handle: string) => {
    const r = render(<TProvider lang="en">{S.el(on)}</TProvider>);
    await waitFor(() => expect((r.getByTestId(id("manual")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("manual")));
    h.reads.length = 0; // only what the SCAN reads counts from here
    h.decode.mockResolvedValueOnce(payload);
    fireEvent.change(r.getByTestId(id("qr-file")), { target: { files: [new File([new Uint8Array([1])], "s.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect((r.getByTestId(S.handle) as HTMLInputElement).value).toBe(handle));
    await act(async () => { await new Promise((res) => setTimeout(res, 30)); });
    return r;
  };
  const again = () => { cleanup(); clearParcelDrafts(); };

  it("OFF: a scan fills the username and reads NOTHING from the database", async () => {
    h.rows[S.table] = [row("c1", "me-1", "maria_shops", "Maria Santos")];
    const r = await openAndScan(false, "https://tiktok.com/@maria_shops", "maria_shops");
    expect(customerReads()).toEqual([]);
    expect(h.reads).toEqual([]); // no table at all
    expect(name(r)).toBe("");
  });

  it("ON: ONE read, of this screen's Customers only, own rows only, read-only — and the form is filled", async () => {
    h.rows[S.table] = [row("c1", "me-1", "@Maria_Shops (U)", "Maria Santos")];
    h.rows[S.table === "parcel_customers" ? "fm_parcel_customers" : "parcel_customers"] = [row("x1", "me-1", "maria_shops", "From The Other Screen")];
    const r = await openAndScan(true, "https://tiktok.com/@maria_shops", "maria_shops");
    await waitFor(() => expect(name(r)).toBe("Maria Santos"));
    expect(h.reads).toHaveLength(1);
    expect(h.reads[0].table).toBe(S.table);
    expect(h.reads[0].eq).toEqual([["user_id", "me-1"]]);
    expect(h.reads[0].or).toEqual([`${S.col}.ilike.maria_shops,${S.col}.ilike.@maria_shops,${S.col}.ilike.@maria_shops %,${S.col}.ilike.@ maria_shops,${S.col}.ilike.@ maria_shops %`]);
    expect(h.reads[0].writes).toEqual([]);
    expect(r.container.querySelector('[data-testid*="-ql"]')).toBeNull();
  });

  it("ON, 2+ records: the NEWEST one fills the form (no list), whatever order the database hands them over in", async () => {
    h.rows[S.table] = [
      row("old", "me-1", "pedro123", "Oldest Name", { updated_at: "2026-09-01T00:00:00+00:00", phone: "0900000001", store_id: "111111" }),
      row("new", "me-1", "@pedro123 (U)", "Newest Name", { updated_at: "2026-11-10T00:00:00+00:00", phone: "0900000003", store_id: "333333" }),
      row("mid", "me-1", "@ pedro123", "Middle Name", { updated_at: "2026-10-01T00:00:00+00:00", phone: "0900000001", store_id: "222222" }),
    ]; // 3 records, 2 different phones
    const r = await openAndScan(true, "pedro123", "pedro123");
    await waitFor(() => expect(name(r)).toBe("Newest Name"));
    expect((r.getByTestId(id("phone")) as HTMLInputElement).value).toBe("0900000003");
    expect((r.getByTestId(id("store")) as HTMLInputElement).value).toBe("333333");
    expect(r.container.textContent).not.toMatch(/Oldest Name|Middle Name/);
    expect(customerReads()).toHaveLength(1);
  });

  it("ON, 3 DIFFERENT phones under the scanned word (a word used for many buyers): ONE read, NOTHING is filled, same message, nothing new on screen", async () => {
    h.rows[S.table] = [
      row("a", "me-1", "user", "Buyer One", { updated_at: "2026-11-10T00:00:00+00:00", phone: "0900000001", store_id: "111111" }),
      row("b", "me-1", "@user", "Buyer Two", { updated_at: "2026-11-09T00:00:00+00:00", phone: "0900000002", store_id: "222222" }),
      row("c", "me-1", "@user (U)", "Buyer Three", { updated_at: "2026-11-08T00:00:00+00:00", phone: "0900000003", store_id: "333333" }),
    ];
    const r = await openAndScan(true, "https://tiktok.com/@user", "user");
    expect(customerReads()).toHaveLength(1);
    await new Promise((done) => setTimeout(done, 30)); // any answer has arrived by now
    expect(name(r)).toBe("");
    expect((r.getByTestId(id("phone")) as HTMLInputElement).value).toBe("");
    expect((r.getByTestId(id("store")) as HTMLInputElement).value).toBe("");
    expect(r.getByTestId(id("toast")).textContent).toBe("Filled @username from QR");
    expect(r.container.textContent).not.toMatch(/Buyer One|Buyer Two|Buyer Three/);
    expect(r.container.querySelector('[data-testid*="-ql"]')).toBeNull();
  });

  it("ON, the third phone belongs to ANOTHER app's record / another seller's row: only the username's own 2 phones count → the newest is filled", async () => {
    h.rows[S.table] = [
      row("new", "me-1", "@pedro123", "Newest Name", { updated_at: "2026-11-10T00:00:00+00:00", phone: "0900000001" }),
      row("old", "me-1", "pedro123", "Older Name", { updated_at: "2026-09-01T00:00:00+00:00", phone: "0900000002" }),
      row("line", "me-1", "pedro123", "Line Buyer", { updated_at: "2026-11-11T00:00:00+00:00", phone: "0900000003", contact_platform: "line" }),
      row("else", "someone-else", "pedro123", "Other Seller's Buyer", { updated_at: "2026-11-11T00:00:00+00:00", phone: "0900000004" }),
      row("near", "me-1", "@pedro1234", "Longer Name", { updated_at: "2026-11-11T00:00:00+00:00", phone: "0900000005" }),
    ];
    const r = await openAndScan(true, "pedro123", "pedro123");
    await waitFor(() => expect(name(r)).toBe("Newest Name"));
    expect(customerReads()).toHaveLength(1);
  });

  it.each([
    ["@pedro123", true], ["pedro123", true], ["@PEDRO123", true], ["@pedro123 (U)", true], ["@pedro123 #3", true], ["@ pedro123", true], ["@pedro123 Garcia (NA)", true],
    ["@pedro12", false], ["@pedro1234", false], ["(U) @pedro123", false], ["Pedro Garcia", false], ["pedro123 (U)", false], ["@pedro123(U)", false],
  ])("ON, rule #4: a record saved as %j — filled for a scan of @pedro123? %s", async (saved, fills) => {
    h.rows[S.table] = [row("a", "me-1", saved as string, "Record Name")];
    const r = await openAndScan(true, "pedro123", "pedro123");
    if (fills) await waitFor(() => expect(name(r)).toBe("Record Name"));
    else expect(name(r)).toBe("");
    again();
  });

  it("ON: a row of ANOTHER seller (even if the database handed it over), another app and a near-name are never used", async () => {
    h.rows[S.table] = [row("o1", "someone-else", "maria_shops", "Other Seller's Buyer"), row("n1", "me-1", "mariaXshops", "Near Name"), row("n2", "me-1", "maria_shops2", "Longer Name"), row("l1", "me-1", "maria_shops", "Line Buyer", { contact_platform: "line" })];
    const r = await openAndScan(true, "maria_shops", "maria_shops");
    expect(customerReads()).toHaveLength(1);
    expect(name(r)).toBe("");
    expect(r.container.textContent).not.toContain("Other Seller's Buyer");
  });

  it("ON: the database answers with an error → username only, nothing shown", async () => {
    h.fail = true;
    const r = await openAndScan(true, "maria_shops", "maria_shops");
    expect(customerReads()).toHaveLength(1);
    expect(name(r)).toBe("");
    expect(r.getByTestId(id("toast")).textContent).toBe("Filled @username from QR");
    expect(r.container.querySelector('[data-testid*="-ql"]')).toBeNull();
  });
});
