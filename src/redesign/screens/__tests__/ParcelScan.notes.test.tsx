// Buyer @username (handle) field — REQUIRED (manual entry). The field is ALWAYS shown
// (no toggle), stored in parcel_scans.notes → 賣貨便 col J (其它資訊). A blank handle
// BLOCKS Save; a typed handle saves VERBATIM to col J. 50-char cap; continuous mode
// clears it per parcel. Uses the REAL validators/formToFields (importActual); DB mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { saveParcelScan, loadRows } = vi.hoisted(() => ({
  saveParcelScan: vi.fn(async () => ({ ok: true, id: "new-1" }) as { ok: boolean; id?: string; error?: string }),
  loadRows: { current: [] as ParcelScanRow[] },
}));

vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan,
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: vi.fn(async () => ({ ok: true })),
    resetExtensionChecks: vi.fn(async () => ({ ok: true })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);
const fillValid = (r: ReturnType<typeof view>) => {
  fireEvent.change(r.getByTestId("ps-name"), { target: { value: "Juan" } });
  fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
  fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "550" } });
};

beforeEach(() => {
  saveParcelScan.mockClear(); saveParcelScan.mockResolvedValue({ ok: true, id: "new-1" });
  loadRows.current = [];
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe("Parcel Scan — buyer @username (col J) is required, no toggle", () => {
  it("field ALWAYS shown on open; no toggle exists", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    expect(r.getByTestId("ps-notes")).toBeTruthy();          // always visible
    expect(r.queryByTestId("ps-notes-toggle")).toBeNull();   // toggle removed
  });

  it("blank handle → Save BLOCKED (no write); typing one → saves VERBATIM to col J (notes)", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fillValid(r);                                            // name/store/amount, but no handle
    expect((r.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("ps-save"));
    expect(saveParcelScan).not.toHaveBeenCalled();           // blocked, nothing written
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "Ashley102031(IG)" } });
    expect((r.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect((saveParcelScan.mock.calls[0][0] as { notes: string | null }).notes).toBe("Ashley102031(IG)"); // verbatim
  });

  it("whitespace-only handle is rejected (trimmed non-empty)", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fillValid(r);
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "   " } });
    expect((r.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("handle input caps at 50 chars", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "x".repeat(80) } });
    expect((r.getByTestId("ps-notes") as HTMLInputElement).value.length).toBe(50);
  });

  it("continuous Save clears the handle field for the next parcel", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fillValid(r);
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "@buyer1" } });
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    // stays in manual, form blank for the next → handle cleared (re-entered per parcel)
    await waitFor(() => expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe(""));
  });
});
