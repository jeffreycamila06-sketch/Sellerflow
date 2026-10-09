// Build 16 — the small "N parcel(s) need your attention" box under the Manual entry form
// (wrong store codes only) is gone: the Build 15 sticky top bar counts every problem, wrong
// codes included. Display only. Pinned here: the box never renders; the top bar still counts a
// wrong code; the row keeps its red flag + "Wrong code" filter; the form's OWN store-code field
// error (under "7-11 store #") still shows. Real formErrors/validators; only DB calls mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";

const { loadRows } = vi.hoisted(() => ({ loadRows: { current: [] as ParcelScanRow[] } }));

vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual, // REAL formErrors + validators + wrongStoreCode
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(async () => ({ ok: true, id: "srv-1" })),
    updateParcelScan: vi.fn(async () => ({ ok: true })),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })),
    loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const mk = (id: string, over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id, customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550,
  notes: "@juan", status: "confirmed", storeCheckStatus: "valid", createdAt: new Date().toISOString(), ...over,
});
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function view() {
  const r = render(<TProvider lang="en"><ParcelScan cur="NT$" /></TProvider>);
  await flush();
  return r;
}

beforeEach(() => { loadRows.current = []; });

describe("Parcel Scan — the duplicate wrong-code box is gone", () => {
  it("a wrong store code → no box under the form; the top bar counts it; the row stays red with its filter", async () => {
    loadRows.current = [mk("ok1"), mk("wrong1", { storeCheckStatus: "not_found" }), mk("wrong2", { storeCheckStatus: "not_found" })];
    const { queryByTestId, getByTestId, queryByText, getAllByTestId } = await view();
    expect(queryByTestId("ps-attention")).toBeNull();
    expect(queryByText(/parcel\(s\) need your attention/)).toBeNull();
    expect(getByTestId("ps-attn").textContent).toBe("⚠ 2 need attention");
    expect(getAllByTestId("ps-row").filter((r) => r.getAttribute("data-flag") === "red")).toHaveLength(2);
    expect(getByTestId("ps-tab-wrong").textContent).toBe("Wrong code · 2");
  });

  it("the form's own store-code error under \"7-11 store #\" still shows", async () => {
    const { findByTestId, getByTestId } = await view();
    fireEvent.click(await findByTestId("ps-manual"));
    fireEvent.change(getByTestId("ps-name"), { target: { value: "Juan" } });
    fireEvent.change(getByTestId("ps-amount"), { target: { value: "550" } });
    fireEvent.change(getByTestId("ps-store"), { target: { value: "12345" } });   // 5 digits
    expect(getByTestId("ps-store-err")).toBeTruthy();
    expect((getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("its string is gone too (it belonged only to that box)", () => {
    const src = readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8");
    expect(src).not.toContain('data-testid="ps-attention"');
    expect(src).not.toMatch(/t\.rd_ps2_attention\b(?!_)/);
    expect(readFileSync("src/redesign/i18n/index.tsx", "utf8")).not.toMatch(/^ {2}rd_ps2_attention: /m);
  });
});
