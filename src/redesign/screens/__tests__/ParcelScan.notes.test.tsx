// Notes / handle field toggle (manual entry). DEFAULT ON (Phase 5) → the 50-char
// field shows on open → parcel_scans.notes → 賣貨便 col J (其他資訊). A blank field
// still saves null (blank J). An explicit "0" in localStorage keeps it OFF (a
// deliberate opt-out). Per-viewer, persisted in localStorage. Uses the REAL
// validators/formToFields (importActual); only DB calls are mocked.
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

describe("Parcel Scan — notes toggle (col J)", () => {
  it("default ON → notes field shown on open; blank → Save writes notes = null (blank J)", async () => {
    const r = view();                                        // localStorage cleared → new default ON
    fireEvent.click(await r.findByTestId("ps-manual"));
    expect(r.getByTestId("ps-notes")).toBeTruthy();          // field shown by default now
    fillValid(r);
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    const [fields] = saveParcelScan.mock.calls[0] as [{ notes: string | null }];
    expect(fields.notes).toBeNull();                          // blank → null → blank col J
  });

  it("default ON → typed notes saved to col J; toggling OFF hides the field + persists '0'", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "FB: juan.dc" } });
    fillValid(r);
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect((saveParcelScan.mock.calls[0][0] as { notes: string | null }).notes).toBe("FB: juan.dc");
    // deliberate opt-out: toggle OFF hides the field and persists "0"
    fireEvent.click(r.getByTestId("ps-notes-toggle"));
    expect(r.queryByTestId("ps-notes")).toBeNull();
    expect(localStorage.getItem("sfl_rd_ps_notes")).toBe("0");
  });

  it('explicit "0" in localStorage → OFF on open (respects a prior opt-out)', async () => {
    localStorage.setItem("sfl_rd_ps_notes", "0");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    expect(r.queryByTestId("ps-notes")).toBeNull();          // stays off despite the new default
  });

  it("ON but blank notes → saved notes null (blank J)", async () => {
    localStorage.setItem("sfl_rd_ps_notes", "1");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    expect(r.getByTestId("ps-notes")).toBeTruthy();          // persisted ON → shown on open
    fillValid(r);
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    const [fields] = saveParcelScan.mock.calls[0] as [{ notes: string | null }];
    expect(fields.notes).toBeNull();
  });

  it("notes input caps at 50 chars", async () => {
    localStorage.setItem("sfl_rd_ps_notes", "1");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "x".repeat(80) } });
    expect((r.getByTestId("ps-notes") as HTMLInputElement).value.length).toBe(50);
  });

  it("continuous Save clears the notes field for the next parcel", async () => {
    localStorage.setItem("sfl_rd_ps_notes", "1");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fillValid(r);
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "LINE: xyz" } });
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    // stays in manual, form blank for the next → notes cleared
    await waitFor(() => expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe(""));
  });
});
