// Amount is now REQUIRED with a MIN_PARCEL_AMOUNT (20) floor — blank / 0 /
// below-min BLOCK Save via the shared formErrors/saveBlocked mechanism, with a
// clear "amount" error (not a generic block). Applies to manual encode AND the
// edit flow (an old parcel below the minimum is blocked until raised — no
// exception). This test uses the REAL validators (importActual) so the actual
// gate runs; only the DB calls are mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { loadRows, updateParcelScan } = vi.hoisted(() => ({
  loadRows: { current: [] as ParcelScanRow[] },
  updateParcelScan: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
}));

vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  // Keep the REAL validation (formErrors / validAmount / amountWarns /
  // MIN_PARCEL_AMOUNT / splitScansForExport); mock only the DB/network calls.
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(async () => ({ ok: true, id: "new-1" })),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan,
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const mk = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "Old", phone: "0912345678", storeId: "266402", amount: 550,
  notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z", ...over,
});
const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);
const save = (r: ReturnType<typeof view>) => r.getByTestId("ps-save") as HTMLButtonElement;

beforeEach(() => { updateParcelScan.mockClear(); updateParcelScan.mockResolvedValue({ ok: true }); loadRows.current = []; });

describe("Parcel Scan — amount required with min (manual encode)", () => {
  it("blank amount → Save disabled + amount error", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-name"), { target: { value: "Juan" } });
    fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
    expect(save(r).disabled).toBe(true);
    expect(r.getByTestId("ps-amount-err").textContent).toContain("20"); // the minimum, clearly the amount
  });

  it("below minimum (19) → still blocked; exactly 20 → enabled, error gone", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-name"), { target: { value: "Juan" } });
    fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
    fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "19" } });
    expect(save(r).disabled).toBe(true);
    expect(r.queryByTestId("ps-amount-err")).toBeTruthy();
    fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "20" } });
    expect(save(r).disabled).toBe(false);
    expect(r.queryByTestId("ps-amount-err")).toBeNull();
  });
});

describe("Parcel Scan — editing an old low-amount parcel is blocked until raised", () => {
  it("amount 10 row → edit opens with Save disabled + amount error; raise to 30 → enabled and saves", async () => {
    loadRows.current = [mk({ id: "r1", amount: 10, customerName: "Old" })];
    const r = view();
    fireEvent.click(await r.findByTestId("ps-row-edit"));
    // Editing another field does NOT clear the block — the amount is the problem.
    fireEvent.change(r.getByTestId("ps-name"), { target: { value: "Fixed Name" } });
    expect(save(r).disabled).toBe(true);
    expect(r.getByTestId("ps-amount-err").textContent).toContain("20");
    expect(updateParcelScan).not.toHaveBeenCalled();
    // Raise the amount over the minimum → unblocked, save goes through.
    fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "30" } });
    expect(save(r).disabled).toBe(false);
    fireEvent.click(save(r));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    const [, fields] = updateParcelScan.mock.calls[0] as [string, { amount: number }];
    expect(fields.amount).toBe(30);
  });
});
