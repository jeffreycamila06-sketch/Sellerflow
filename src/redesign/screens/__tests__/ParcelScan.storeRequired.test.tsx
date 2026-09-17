// 7-11 STORE CODE REQUIRED (bug: a manual/import parcel saved with a blank store_id
// silently passed into the batch and would be REJECTED at the 賣貨便 upload). The
// store code is now REQUIRED and must be EXACTLY 6 digits before Save/Import on the
// MANUAL encode, the parcel EDIT form, and the Customer Details → Import path — same
// gate shape as the amount. The SCAN/OCR confirm path is UNCHANGED (blank store
// stays allowed there, flagged + excluded from export, fixable via edit).
//
// Uses the REAL formErrors + validators (importOriginal spread) so the actual gate
// is exercised; only the DB/network calls are mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import { formErrors } from "../../adapters/parcelScan";
import type { ScanFormState } from "../../adapters/parcelScan";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import type { ParcelCustomer } from "../../adapters/parcelCustomers";

// ── UNIT: the real formErrors store gate ──────────────────────────────────────
describe("formErrors — store gate", () => {
  const base: ScanFormState = { name: "", phone: "", store: "", amount: "550", notes: "" };
  it("requireStore=false (SCAN path): blank store is ALLOWED (unchanged)", () => {
    expect(formErrors({ ...base, store: "" }, 38, false).store).toBe(false);
  });
  it("requireStore=false: filled-but-wrong-length still flags (existing format check)", () => {
    expect(formErrors({ ...base, store: "12345" }, 38, false).store).toBe(true);
  });
  it("default (no 3rd arg) === scan behavior (blank allowed)", () => {
    expect(formErrors({ ...base, store: "" }, 38).store).toBe(false);
  });
  it("requireStore=true: blank → blocked", () => {
    expect(formErrors({ ...base, store: "" }, 38, true).store).toBe(true);
  });
  it("requireStore=true: 5 digits → blocked", () => {
    expect(formErrors({ ...base, store: "12345" }, 38, true).store).toBe(true);
  });
  it("requireStore=true: non-digits → blocked", () => {
    expect(formErrors({ ...base, store: "12a45b" }, 38, true).store).toBe(true);
  });
  it("requireStore=true: EXACTLY 6 digits → OK", () => {
    expect(formErrors({ ...base, store: "266402" }, 38, true).store).toBe(false);
  });
});

// ── COMPONENT: manual + edit + import gates ───────────────────────────────────
const { loadRows, recent, saveParcelScan, updateParcelScan, loadParcelScans, countPending } = vi.hoisted(() => ({
  loadRows: { current: [] as ParcelScanRow[] },
  recent: { current: { ok: true, rows: [] as ParcelCustomer[] } as { ok: boolean; rows: ParcelCustomer[]; error?: string } },
  saveParcelScan: vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; id?: string; error?: string }>>(async () => ({ ok: true, id: "srv-1" })),
  updateParcelScan: vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
  countPending: vi.fn(async () => ({ ok: true, count: 0 }) as { ok: boolean; count: number; error?: string }),
}));

vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual, // REAL formErrors + validators + constants
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(),
    saveParcelScan: (...a: unknown[]) => saveParcelScan(...(a as [])),
    updateParcelScan: (...a: unknown[]) => updateParcelScan(...(a as [])),
    loadParcelScans: () => loadParcelScans(),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => recent.current,
  searchParcelCustomers: async () => recent.current,
  updateParcelCustomer: vi.fn(async () => ({ ok: true })),
  deleteParcelCustomer: vi.fn(async () => ({ ok: true })),
  countPendingParcels: () => countPending(),
  countParcelCustomers: async () => ({ ok: true, count: 3 }),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const mkRow = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550,
  notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z", ...over,
});
const mkCust = (over: Partial<ParcelCustomer> = {}): ParcelCustomer => ({
  id: "c1", phone: "0912345678", name: "Maria", storeId: "266402", notes: "@maria",
  createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", ...over,
});
const view = () => render(<TProvider lang="en"><ParcelScan cur="NT$" /></TProvider>);
const disabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

beforeEach(() => {
  loadRows.current = [];
  recent.current = { ok: true, rows: [mkCust()] };
  saveParcelScan.mockClear(); saveParcelScan.mockResolvedValue({ ok: true, id: "srv-1" });
  updateParcelScan.mockClear(); updateParcelScan.mockResolvedValue({ ok: true });
  countPending.mockClear(); countPending.mockResolvedValue({ ok: true, count: 0 });
});

describe("ParcelScan — 7-11 store code required (manual encode)", () => {
  it("blank store → Save DISABLED + required error, no insert", async () => {
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Juan" } });
    fireEvent.change(getByTestId("ps-amount"), { target: { value: "550" } });
    // store left blank
    expect(disabled(getByTestId("ps-save"))).toBe(true);
    expect(getByTestId("ps-store-err").textContent).toContain("required");
    fireEvent.click(getByTestId("ps-save")); // disabled → no-op
    await Promise.resolve();
    expect(saveParcelScan).not.toHaveBeenCalled();
  });

  it("5-digit store → Save DISABLED + error (format)", async () => {
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Juan" } });
    fireEvent.change(getByTestId("ps-amount"), { target: { value: "550" } });
    fireEvent.change(getByTestId("ps-store"), { target: { value: "12345" } });
    expect(disabled(getByTestId("ps-save"))).toBe(true);
    expect(getByTestId("ps-store-err")).toBeTruthy();
    expect(saveParcelScan).not.toHaveBeenCalled();
  });

  it("valid 6-digit store → Save ENABLED and inserts", async () => {
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Juan" } });
    fireEvent.change(getByTestId("ps-amount"), { target: { value: "550" } });
    fireEvent.change(getByTestId("ps-store"), { target: { value: "266402" } });
    expect(disabled(getByTestId("ps-save"))).toBe(false);
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0][0]).toMatchObject({ store_id: "266402" });
  });
});

describe("ParcelScan — 7-11 store code required (edit)", () => {
  it("clearing the store on an existing parcel → Save DISABLED + required error, no update", async () => {
    loadRows.current = [mkRow({ id: "r1", storeId: "982063" })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    expect((getByTestId("ps-store") as HTMLInputElement).value).toBe("982063");
    fireEvent.change(getByTestId("ps-store"), { target: { value: "" } }); // clear it
    expect(disabled(getByTestId("ps-save"))).toBe(true);
    expect(getByTestId("ps-store-err").textContent).toContain("required");
    fireEvent.click(getByTestId("ps-save"));
    await Promise.resolve();
    expect(updateParcelScan).not.toHaveBeenCalled();
  });

  it("editing with a valid 6-digit store still saves (no regression)", async () => {
    loadRows.current = [mkRow({ id: "r1", storeId: "982063", customerName: "Old" })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Fixed" } });
    expect(disabled(getByTestId("ps-save"))).toBe(false);
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
  });
});

describe("ParcelScan — 7-11 store code required (Customer Details → Import)", () => {
  async function openOverlay(r: ReturnType<typeof view>) {
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.click(await r.findByTestId("ps-open-customers"));
    await waitFor(() => expect(r.getByTestId("ps-customers-overlay")).toBeTruthy());
  }

  it("importing a phonebook customer with a BLANK store → blocked with required error, no save", async () => {
    recent.current = { ok: true, rows: [mkCust({ storeId: "" })] }; // contact has no store
    const r = view();
    await openOverlay(r);
    fireEvent.click(await r.findByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-price")).toBeTruthy());
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toContain("required"));
    expect(saveParcelScan).not.toHaveBeenCalled();
    expect(r.getByTestId("ps-customers-overlay")).toBeTruthy(); // overlay stays open
  });

  it("importing a customer WITH a valid 6-digit store still succeeds", async () => {
    recent.current = { ok: true, rows: [mkCust({ storeId: "266402" })] };
    const r = view();
    await openOverlay(r);
    fireEvent.click(await r.findByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-price")).toBeTruthy());
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0][0]).toMatchObject({ store_id: "266402" });
  });
});
