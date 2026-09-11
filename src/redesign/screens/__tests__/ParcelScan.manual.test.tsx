// FIX 3 — Manual encode: add a parcel with NO camera and NO AI scan. The
// pinned requirement is ZERO CREDIT — it must go through saveParcelScan (a
// direct parcel_scans INSERT) and NEVER through scanParcel (the /admin/parcel-
// scan vision call, the ONLY path that hits check_and_debit_credit). It must
// still run the E-Map store-code check and land in the saved list (All tab,
// exportable). jsdom has no getUserMedia → the manual link shows under the
// fallback picker.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { scanParcel, saveParcelScan, checkEmapStore } = vi.hoisted(() => ({
  scanParcel: vi.fn(),
  saveParcelScan: vi.fn(async () => ({ ok: true, id: "srv-1" }) as { ok: boolean; id?: string; error?: string }),
  checkEmapStore: vi.fn(async () => ({ status: "valid" as const })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  MAX_PENDING_PARCELS: 30, // batch-cap constant the screen reads on every render (inert here — no test loads >=30 pending)
  fileToScanBase64: vi.fn(),
  scanParcel,
  saveParcelScan,
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: [] })),
  checkEmapStore,
  saveStoreCheck: vi.fn(async () => ({ ok: true })),
  formErrors: (f: { name: string; phone: string; store: string; amount: string; notes: string }) => ({
    name: false,
    phone: false,
    store: f.store.trim() !== "" && !/^\d{6}$/.test(f.store.trim()),
    empty: f.name.trim() === "" && f.phone.trim() === "" && f.store.trim() === "" && f.amount.trim() === "" && f.notes.trim() === "",
  }),
  amountWarns: () => false,
  splitScansForExport: () => ({ ready: [], attention: [] }),
  scanToXlsRow: vi.fn(),
  markScansExported: vi.fn(),
  deleteParcelScan: vi.fn(),
  deleteExportedParcels: vi.fn(),
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  scanParcel.mockClear(); saveParcelScan.mockClear(); checkEmapStore.mockClear();
  saveParcelScan.mockResolvedValue({ ok: true, id: "srv-1" });
});

describe("Parcel Scan — manual encode (zero credit)", () => {
  it("opens the shared confirm form BLANK (no pre-fill)", async () => {
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    const form = getByTestId("ps-confirm");
    expect(form.getAttribute("data-manual")).toBe("1");
    expect(form.getAttribute("data-editing")).toBeNull(); // not an edit
    expect((getByTestId("ps-name") as HTMLInputElement).value).toBe("");
    expect((getByTestId("ps-store") as HTMLInputElement).value).toBe("");
    expect((getByTestId("ps-amount") as HTMLInputElement).value).toBe("");
  });

  it("Save INSERTS via saveParcelScan and NEVER calls scanParcel (no debit)", async () => {
    const { findByTestId, getByTestId, getAllByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Juan Dela Cruz" } });
    fireEvent.change(getByTestId("ps-store"), { target: { value: "266402" } });
    fireEvent.change(getByTestId("ps-amount"), { target: { value: "550" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    // ZERO CREDIT: the vision/debit path is never touched.
    expect(scanParcel).not.toHaveBeenCalled();
    // The inserted fields are the typed values; raw_extraction is null (manual).
    const [fields, raw] = saveParcelScan.mock.calls[0] as [{ name: string; store_id: string; amount: number }, unknown];
    expect(fields.name).toBe("Juan Dela Cruz");
    expect(fields.store_id).toBe("266402");
    expect(fields.amount).toBe(550);
    expect(raw).toBeNull();
    // Lands in the saved list.
    await waitFor(() => expect(getAllByTestId("ps-row")).toHaveLength(1));
  });

  it("continuous mode: Save keeps the manual form open + blank, increments the manual counter, no scan", async () => {
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "First Buyer" } });
    fireEvent.change(getByTestId("ps-store"), { target: { value: "266402" } });
    fireEvent.change(getByTestId("ps-amount"), { target: { value: "300" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    // Stays in manual mode with a fresh blank form (camera-loop style).
    await waitFor(() => expect(getByTestId("ps-manual-count").textContent).toContain("1"));
    const form = getByTestId("ps-confirm");
    expect(form.getAttribute("data-manual")).toBe("1");            // still manual
    expect((getByTestId("ps-name") as HTMLInputElement).value).toBe("");   // blanked
    expect((getByTestId("ps-store") as HTMLInputElement).value).toBe("");
    expect((getByTestId("ps-amount") as HTMLInputElement).value).toBe("");
    // Second parcel → counter 2, still zero credit.
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Second Buyer" } });
    fireEvent.change(getByTestId("ps-store"), { target: { value: "266402" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getByTestId("ps-manual-count").textContent).toContain("2"));
    expect(scanParcel).not.toHaveBeenCalled();
  });

  it("the notes field is removed from the form (shorter form)", async () => {
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    getByTestId("ps-name");                     // form is open
    expect(queryByTestId("ps-notes")).toBeNull(); // notes input gone
  });

  it("runs the E-Map store-code check on the typed store (like the scan/edit flow)", async () => {
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "A" } });
    fireEvent.change(getByTestId("ps-store"), { target: { value: "266402" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(checkEmapStore).toHaveBeenCalledWith("266402"));
    expect(scanParcel).not.toHaveBeenCalled(); // still zero credit
  });

  it("Cancel closes the manual form without inserting", async () => {
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.click(getByTestId("ps-manual-cancel"));
    expect(queryByTestId("ps-confirm")).toBeNull();
    expect(saveParcelScan).not.toHaveBeenCalled();
    expect(scanParcel).not.toHaveBeenCalled();
  });
});
