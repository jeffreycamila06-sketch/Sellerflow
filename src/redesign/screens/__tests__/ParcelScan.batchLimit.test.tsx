// Batch limit — at most MAX_PENDING_PARCELS (30) PENDING (not-yet-exported)
// parcels per batch (Jeff's call). At the cap, NEW entries are blocked
// (shutter / file-picker / manual encode / new-row Save) with a clear
// "export first" message; EDIT + DELETE of existing rows stay OPEN (so wrong
// store codes / prices are still fixable). An export flips rows to 'exported'
// → the pending count drops → the gates reopen. Exported rows never count.
// Uses the REAL adapter (importActual) so MAX_PENDING_PARCELS + validators run;
// only the DB / network calls are mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";

const { loadRows, updateParcelScan, deleteParcelScan, markScansExported } = vi.hoisted(() => ({
  loadRows: { current: [] as ParcelScanRow[] },
  updateParcelScan: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  deleteParcelScan: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  markScansExported: vi.fn(async () => ({ ok: true, batchId: "batch-1" }) as { ok: boolean; batchId?: string }),
}));

vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  // Keep the REAL MAX_PENDING_PARCELS / validators / splitScansForExport; mock
  // only the DB + network calls.
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(async () => ({ ok: true, id: "new-1" })),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    scanToXlsRow: vi.fn(() => ({})), markScansExported, unmarkScansExported: vi.fn(),
    deleteParcelScan, deleteExportedParcels: vi.fn(),
    updateParcelScan,
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()),
  buildXlsmFromTemplate: vi.fn(async () => new Uint8Array()),
  deliverXlsm: vi.fn(async () => ({ ok: true })),
  exportFilename: () => "sellerflow_711.xlsm",
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

// Clean name (no digits/symbols/space) so a row passes the 賣貨便 name validator
// and is EXPORT-READY — the export test needs real ready rows.
const mk = (i: number, over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: `r${i}`, customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550,
  notes: "", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z", ...over,
});
const many = (n: number, status: ParcelScanRow["status"] = "confirmed") =>
  Array.from({ length: n }, (_, i) => mk(i + 1, { status }));

const view = (props: { manualOnly?: boolean } = {}) =>
  render(<TProvider><ParcelScan cur="NT$" manualOnly={props.manualOnly} /></TProvider>);

const nav = navigator as unknown as Record<string, unknown>;
let hadMedia = false;
let prevMedia: unknown;
const enableCamera = () => {
  hadMedia = "mediaDevices" in nav; prevMedia = nav.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    configurable: true,
  });
};

beforeEach(() => {
  updateParcelScan.mockClear(); deleteParcelScan.mockClear(); markScansExported.mockClear();
  updateParcelScan.mockResolvedValue({ ok: true });
  deleteParcelScan.mockResolvedValue({ ok: true });
  markScansExported.mockResolvedValue({ ok: true, batchId: "batch-1" });
  loadRows.current = [];
});
afterEach(() => {
  if (hadMedia) Object.defineProperty(navigator, "mediaDevices", { value: prevMedia, configurable: true });
  else { try { delete (navigator as Record<string, unknown>).mediaDevices; } catch { /* ignore */ } }
  hadMedia = false;
});

const norm = (s: string | null) => (s || "").replace(/\s/g, "");

describe("Parcel Scan — batch limit (30 pending)", () => {
  it("29 pending → below the cap: picker + manual enabled, pill 29/30, no banner", async () => {
    loadRows.current = many(29);
    const { findByTestId, getByTestId, queryByTestId } = view();
    await findByTestId("ps-batch");
    expect(norm(getByTestId("ps-batch-n").textContent)).toBe("29/30");
    expect(queryByTestId("ps-batch-full")).toBeNull();
    expect((getByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(false);
    expect((getByTestId("ps-manual") as HTMLButtonElement).disabled).toBe(false);
  });

  it("30 pending → at the cap: picker + manual DISABLED, banner shown, pill 30/30", async () => {
    loadRows.current = many(30);
    const { findByTestId, getByTestId } = view();
    await findByTestId("ps-batch");
    expect(norm(getByTestId("ps-batch-n").textContent)).toBe("30/30");
    expect(getByTestId("ps-batch-full")).toBeTruthy();
    expect((getByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("ps-manual") as HTMLButtonElement).disabled).toBe(true);
  });

  it("30 pending → the camera shutter is DISABLED (camera not hidden)", async () => {
    enableCamera();
    loadRows.current = many(30);
    const { findByTestId } = view();
    const shutter = await findByTestId("ps-shutter") as HTMLButtonElement;
    expect(shutter.disabled).toBe(true);
  });

  it("30 pending → opening manual is blocked (no confirm form appears)", async () => {
    loadRows.current = many(30);
    const { findByTestId, getByTestId, queryByTestId } = view();
    await findByTestId("ps-batch");
    fireEvent.click(getByTestId("ps-manual")); // disabled button — no-op
    expect(queryByTestId("ps-confirm")).toBeNull();
  });

  it("30 pending → EDIT of an existing row STILL WORKS (form opens, save goes through)", async () => {
    loadRows.current = many(30);
    const { findAllByTestId, getByTestId } = view();
    const editBtns = await findAllByTestId("ps-row-edit");
    fireEvent.click(editBtns[0]);
    expect(getByTestId("ps-confirm").getAttribute("data-editing")).toBe("1"); // edit form open despite full
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Fixed Name" } });
    expect((getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(false); // save NOT blocked for an edit
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    const [, fields] = updateParcelScan.mock.calls[0] as [string, { name: string }];
    expect(fields.name).toBe("Fixed Name");
  });

  it("30 pending → DELETE of an existing row STILL WORKS", async () => {
    loadRows.current = many(30);
    const { findAllByTestId, getByTestId } = view();
    const delBtns = await findAllByTestId("ps-row-delete");
    fireEvent.click(delBtns[0]);
    fireEvent.click(getByTestId("ps-confirm-delete"));
    await waitFor(() => expect(deleteParcelScan).toHaveBeenCalledTimes(1));
  });

  it("exported rows are NOT counted — 30 exported + 10 confirmed → pending 10, gates OPEN", async () => {
    loadRows.current = [...many(30, "exported"), ...many(10).map((r, i) => ({ ...r, id: `c${i}` }))];
    const { findByTestId, getByTestId } = view();
    await findByTestId("ps-batch");
    expect(norm(getByTestId("ps-batch-n").textContent)).toBe("10/30");
    expect((getByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(false);
    expect((getByTestId("ps-manual") as HTMLButtonElement).disabled).toBe(false);
  });

  it("after an export the pending count drops to 0 → gates REOPEN (banner gone, picker/manual enabled)", async () => {
    loadRows.current = many(30);
    const { findByTestId, getByTestId, queryByTestId } = view();
    await findByTestId("ps-batch-full"); // full at start
    expect((getByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(true);
    // Export → confirm → rows flip to 'exported' locally → pending 0.
    fireEvent.click(getByTestId("ps-export-btn"));
    fireEvent.click(getByTestId("ps-confirm-export"));
    await waitFor(() => expect(markScansExported).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryByTestId("ps-batch-full")).toBeNull()); // banner cleared
    expect(norm(getByTestId("ps-batch-n").textContent)).toBe("0/30");
    expect((getByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(false);
    expect((getByTestId("ps-manual") as HTMLButtonElement).disabled).toBe(false);
  });

  it("the batch pill shows for a manual-only (paying) seller too", async () => {
    loadRows.current = many(30);
    const { findByTestId, getByTestId } = view({ manualOnly: true });
    await findByTestId("ps-batch");
    expect(norm(getByTestId("ps-batch-n").textContent)).toBe("30/30");
    expect((getByTestId("ps-manual") as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId("ps-batch-full")).toBeTruthy();
  });
});
