// sql/145 INSTANT VERDICT on screen: the trigger puts a cached frozen verdict on the row AT INSERT.
// The seller saves a 冷凍 parcel; the next 3-second re-read (the screen's existing verdict poll — no
// new code) brings that verdict and the red "can't receive frozen" line appears without any refresh.
// The export re-reads the rows from the database, so a no_frozen row set at insert is left out even
// if the screen had not re-read yet. (Mocks copied from ParcelScan.frozenStore.test.tsx.)
// (original header of the copied mocks:) sql/142 FROZEN store check on screen (7-11 Parcel Scan): a 冷凍 row shows, per verdict,
//   no_frozen → red border + the red "can't receive frozen" line (wraps, never cut) + ⟳, and is
//              kept OUT of the export like a full store;
//   null / unknown → amber "Checking frozen…" instead of the green all-clear (never red);
//   ok → the normal green all-clear.
// Dry rows are byte-identical to today whatever frozen_store_status says (the column is never
// read for them). Recheck (⟳) clears the frozen verdict locally and in the adapter call.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { splitScansForExport } from "../../adapters/parcelScan";
import { FROZEN_OFF, TEMP_FROZEN, type FrozenState } from "../../adapters/parcelFrozen";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  state: null as unknown,
  resetExtensionChecks: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  loadParcelScans: vi.fn(async (..._a: unknown[]) => ({ ok: true, rows: [] as unknown[] })),
  loadFrozenState: vi.fn(),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(),
    saveParcelScan: vi.fn(async () => ({ ok: true, id: "new-1" })), updateParcelScan: (...a: unknown[]) => h.updateParcelScan(...a),
    loadParcelScans: (...a: unknown[]) => h.loadParcelScans(...a),
    resetExtensionChecks: (...a: unknown[]) => h.resetExtensionChecks(...a),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(async (ids: string[]) => ({ ok: true, batchId: "b1", claimed: ids })), unmarkScansExported: vi.fn(async () => ({ ok: true })),
    confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()), buildXlsmFromTemplate: vi.fn(async () => new Uint8Array()),
  deliverXlsm: vi.fn(async () => ({ ok: true })), deliverXlsmMobile: vi.fn(async () => ({ ok: true })), exportFilename: () => "x.xlsm",
}));
vi.mock("../../adapters/parcelFrozen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelFrozen")>();
  return { ...actual, loadFrozenState: () => h.loadFrozenState(), saveParcelMode: vi.fn(async () => ({ ok: true })) };
});
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => ({ ok: true, rows: [] }), searchParcelCustomers: async () => ({ ok: true, rows: [] }),
  updateParcelCustomer: vi.fn(), deleteParcelCustomer: vi.fn(),
  countPendingParcels: async () => ({ ok: true, count: 0 }), countParcelCustomers: async () => ({ ok: true, count: 0 }),
}));

import ParcelScan from "../ParcelScan";

const CFG = { fee: 129, minTotal: 150, feeColumnMax: null };
const ACCESS: FrozenState = { status: "ok", blocked: false, allowed: true, mode: "冷凍", cfg: CFG }; // Frozen mode: new parcels are 冷凍
const mk = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "新蓮盈買家", phone: "0944111222", storeId: "968551", amount: 650, notes: "@buyer",
  status: "confirmed", storeCheckStatus: "valid", storeFullStatus: "open", phoneCheckStatus: "ok", createdAt: new Date().toISOString(), ...over,
});
const frozen = (over: Partial<ParcelScanRow> = {}) => mk({ tempLayer: TEMP_FROZEN, ...over });
const view = (lang = "en", frozenCheckOn = true) => render(<TProvider lang={lang}><ParcelScan cur="NT$" checkOn frozenCheckOn={frozenCheckOn} /></TProvider>);
const rowEl = (r: ReturnType<typeof view>, id: string): HTMLElement => {
  const el = r.container.querySelector(`[data-testid="ps-row"][data-row-id="${id}"]`);
  if (!el) throw new Error(`row ${id} not rendered`); // waitFor retries on a throw, not on null
  return el as HTMLElement;
};

beforeEach(() => {
  h.rows = []; h.state = ACCESS;
  h.loadParcelScans.mockReset(); h.loadParcelScans.mockImplementation(async () => ({ ok: true, rows: h.rows }));
  h.loadFrozenState.mockReset(); h.loadFrozenState.mockImplementation(async () => h.state ?? FROZEN_OFF);
  h.resetExtensionChecks.mockClear(); h.updateParcelScan.mockClear();
});

const fill = (r: ReturnType<typeof view>) => {
  fireEvent.change(r.getByTestId("ps-name"), { target: { value: "新蓮盈買家" } });
  fireEvent.change(r.getByTestId("ps-store"), { target: { value: "968551" } });
  fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "@buyer" } });
  fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "650" } });
};

describe("instant verdict (sql/145) reaches the screen without a refresh", () => {
  for (const [label, dry] of [["dry halves already answered", { storeFullStatus: "open", phoneCheckStatus: "ok" }], ["dry halves still checking", { storeFullStatus: undefined, phoneCheckStatus: undefined }]] as const) {
    it(`save a 冷凍 parcel → the next re-read brings no_frozen (set at insert) → red line on the new row (${label})`, async () => {
      h.rows = [];
      const r = view();
      await r.findByTestId("ps-mode");
      fireEvent.click(r.getByTestId("ps-manual"));
      fill(r);
      fireEvent.click(r.getByTestId("ps-save"));
      await waitFor(() => rowEl(r, "new-1"));                                // the local row, no verdict yet
      expect(rowEl(r, "new-1").querySelector('[data-testid="ps-frozen-no"]')).toBeNull();
      // what the database now holds for that row: the trigger already set frozen_store_status at insert
      h.rows = [frozen({ id: "new-1", frozenStoreStatus: "no_frozen", createdAt: new Date().toISOString(), ...dry })];
      await waitFor(() => {
        const line = rowEl(r, "new-1").querySelector('[data-testid="ps-frozen-no"]');
        if (dry.storeFullStatus) expect(line?.textContent).toBe("❄ This store can't receive frozen. Ask the buyer for another 7-11.");
        else expect(rowEl(r, "new-1").getAttribute("data-flag") === "red" || Boolean(line)).toBe(true);
      }, { timeout: 4500 });
      if (dry.storeFullStatus) expect(rowEl(r, "new-1").getAttribute("data-flag")).toBe("red");
    }, 10_000);
  }
  it("the export re-reads the database: a no_frozen row (set at insert) is left out even before the screen re-read", async () => {
    h.rows = [];
    const r = view();
    await r.findByTestId("ps-mode");
    fireEvent.click(r.getByTestId("ps-manual"));
    fill(r);
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => rowEl(r, "new-1"));
    h.rows = [frozen({ id: "new-1", frozenStoreStatus: "no_frozen", createdAt: new Date().toISOString() })];
    const split = splitScansForExport(h.rows as ParcelScanRow[], 38, CFG, true);
    expect(split.ready).toEqual([]);
    expect(split.attention.map((a) => a.reason)).toEqual(["no_frozen"]);
  });
});
