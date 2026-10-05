// Parcel Scan Dry / Frozen on screen (sql/79): no access (or a read error → FROZEN_OFF) = no
// control and saves without temp_layer; access = the switch, confirmation before switching
// (never touching saved rows), new parcels use the mode, frozen min total, the ❄ 冷凍 badge, the
// edit layer, the Export-card frozen count, and Customer Details Import using the current mode.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import type { FrozenState } from "../../adapters/parcelFrozen";

const h = vi.hoisted(() => ({
  state: null as unknown,
  rows: [] as unknown[],
  saveParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-1" })),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  saveParcelMode: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string }),
  loadParcelScans: vi.fn(async (..._a: unknown[]) => ({ ok: true, rows: [] as unknown[] })),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(),
    saveParcelScan: (...a: unknown[]) => h.saveParcelScan(...a),
    updateParcelScan: (...a: unknown[]) => h.updateParcelScan(...a),
    loadParcelScans: (...a: unknown[]) => h.loadParcelScans(...a),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(), deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/parcelFrozen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelFrozen")>();
  return { ...actual, loadFrozenState: vi.fn(async () => h.state ?? actual.FROZEN_OFF), saveParcelMode: (...a: unknown[]) => h.saveParcelMode(...a) };
});
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => ({ ok: true, rows: [{ id: "c1", phone: "0912345678", name: "Maria", storeId: "266402", notes: "@maria", createdAt: "", updatedAt: "" }] }),
  searchParcelCustomers: async () => ({ ok: true, rows: [] }),
  updateParcelCustomer: vi.fn(), deleteParcelCustomer: vi.fn(),
  countPendingParcels: async () => ({ ok: true, count: 0 }),
  countParcelCustomers: async () => ({ ok: true, count: 1 }),
}));

import ParcelScan from "../ParcelScan";
import CustomerDetails from "../CustomerDetails";

const CFG = { fee: 129, minTotal: 150, feeColumnMax: null };
const ACCESS = (mode: "常溫" | "冷凍" = "常溫"): FrozenState => ({ allowed: true, sqlReady: true, mode, cfg: CFG });
const mk = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 500, notes: "@j",
  status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-10-06T00:00:00Z", ...over,
});
const view = () => render(<TProvider lang="en"><ParcelScan cur="NT$" /></TProvider>);
const fill = (r: ReturnType<typeof view>, amount: string) => {
  fireEvent.change(r.getByTestId("ps-name"), { target: { value: "Juan" } });
  fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
  fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "@buyer" } });
  fireEvent.change(r.getByTestId("ps-amount"), { target: { value: amount } });
};
const save = (r: ReturnType<typeof view>) => r.getByTestId("ps-save") as HTMLButtonElement;

beforeEach(() => {
  h.state = null; h.rows = [];
  h.saveParcelScan.mockClear(); h.updateParcelScan.mockClear(); h.saveParcelMode.mockClear();
  h.saveParcelMode.mockResolvedValue({ ok: true });
  h.loadParcelScans.mockReset(); h.loadParcelScans.mockImplementation(async () => ({ ok: true, rows: h.rows }));
});

describe("no access (or a read error) → today's Parcel Scan", () => {
  it("no control, no badge, the 20 minimum, and saves WITHOUT a temp_layer", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    expect(r.queryByTestId("ps-mode")).toBeNull();
    fill(r, "19");
    expect(r.getByTestId("ps-amount-err").textContent).toContain("20");
    fill(r, "20");
    fireEvent.click(save(r));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBeUndefined();
    expect(h.loadParcelScans.mock.calls.every((c) => !(c[0] as { withTempLayer?: boolean } | undefined)?.withTempLayer)).toBe(true);
  });
});

describe("with access", () => {
  it("shows the switch (default Dry); switching asks first, naming NT$129; Cancel changes nothing", async () => {
    h.state = ACCESS();
    const r = view();
    const sw = await r.findByTestId("ps-mode");
    expect(sw.getAttribute("data-mode")).toBe("常溫");
    fireEvent.click(r.getByTestId("ps-mode-frozen"));
    expect(r.getByTestId("ps-mode-q").textContent).toBe("Switch to Frozen 冷凍? New parcels will be sent frozen, shipping NT$129.");
    fireEvent.click(r.getByTestId("ps-confirm-cancel"));
    expect(h.saveParcelMode).not.toHaveBeenCalled();
    expect(r.getByTestId("ps-mode").getAttribute("data-mode")).toBe("常溫");
  });

  it("confirming saves the mode and never rewrites saved parcels", async () => {
    h.state = ACCESS();
    h.rows = [mk({ id: "a", tempLayer: "常溫" }), mk({ id: "b", tempLayer: "冷凍" })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-row")).toHaveLength(2));
    fireEvent.click(r.getByTestId("ps-mode-frozen"));
    fireEvent.click(r.getByTestId("ps-confirm-mode"));
    await waitFor(() => expect(r.getByTestId("ps-mode").getAttribute("data-mode")).toBe("冷凍"));
    expect(h.saveParcelMode).toHaveBeenCalledWith("冷凍");
    expect(h.updateParcelScan).not.toHaveBeenCalled();
    expect(r.getAllByTestId("ps-frozen-badge")).toHaveLength(1); // still only the row that was frozen
  });

  it("a failed mode save keeps the old mode and shows an error", async () => {
    h.state = ACCESS();
    h.saveParcelMode.mockResolvedValue({ ok: false, error: "rls" });
    const r = view();
    fireEvent.click(await r.findByTestId("ps-mode-frozen"));
    fireEvent.click(r.getByTestId("ps-confirm-mode"));
    await waitFor(() => expect(r.getByTestId("ps-mode-err")).toBeTruthy());
    expect(r.getByTestId("ps-mode").getAttribute("data-mode")).toBe("常溫");
  });

  it("Frozen mode: amount 20 blocked showing the real minimum 21; 21 saves as 冷凍", async () => {
    h.state = ACCESS("冷凍");
    const r = view();
    await r.findByTestId("ps-mode");
    fireEvent.click(r.getByTestId("ps-manual"));
    expect(r.getByTestId("ps-form-frozen").textContent).toContain("NT$129");
    fill(r, "20");
    expect(save(r).disabled).toBe(true);
    expect(r.getByTestId("ps-amount-err").textContent).toContain("NT$21");
    fill(r, "21");
    expect(save(r).disabled).toBe(false);
    fireEvent.click(save(r));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBe("冷凍");
  });

  it("Dry mode with access: amount 20 still saves (today's rule) as 常溫", async () => {
    h.state = ACCESS("常溫");
    const r = view();
    await r.findByTestId("ps-mode");
    fireEvent.click(r.getByTestId("ps-manual"));
    fill(r, "20");
    expect(save(r).disabled).toBe(false);
    fireEvent.click(save(r));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBe("常溫");
  });

  it("the list is read with temp_layer; frozen rows get the badge; Export card counts them", async () => {
    h.state = ACCESS();
    h.rows = [mk({ id: "a" }), mk({ id: "b", tempLayer: "冷凍" }), mk({ id: "c", tempLayer: "冷凍" })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-frozen-badge")).toHaveLength(2));
    expect(h.loadParcelScans.mock.calls.some((c) => (c[0] as { withTempLayer?: boolean } | undefined)?.withTempLayer === true)).toBe(true);
    expect(r.getByTestId("ps-export-frozen").textContent).toContain("2 frozen");
  });

  it("editing a not-yet-exported parcel shows its layer and can change it", async () => {
    h.state = ACCESS();
    h.rows = [mk({ id: "b", tempLayer: "冷凍", amount: 500 })];
    const r = view();
    await waitFor(() => expect(r.getByTestId("ps-row-edit")).toBeTruthy());
    fireEvent.click(r.getByTestId("ps-row-edit"));
    expect(r.getByTestId("ps-edit-layer").getAttribute("data-layer")).toBe("冷凍");
    fireEvent.click(r.getByTestId("ps-edit-layer-dry"));
    fireEvent.click(save(r));
    await waitFor(() => expect(h.updateParcelScan).toHaveBeenCalled());
    expect(h.updateParcelScan.mock.calls[0][3]).toBe("常溫");
    await waitFor(() => expect(r.queryByTestId("ps-frozen-badge")).toBeNull());
  });
});

describe("Customer Details Import uses the current mode", () => {
  const openRow = async (r: ReturnType<typeof render>) => {
    fireEvent.click(await r.findByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-import-panel")).toBeTruthy());
  };
  it("frozen mode → saved as 冷凍 with the frozen minimum (20 blocked, 21 imports)", async () => {
    const r = render(<TProvider lang="en"><CustomerDetails cur="NT$" frozenState={ACCESS("冷凍")} /></TProvider>);
    await openRow(r);
    expect(r.getByTestId("cd-frozen").textContent).toContain("NT$129");
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "20" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toContain("NT$21"));
    expect(h.saveParcelScan).not.toHaveBeenCalled();
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "21" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBe("冷凍");
  });
  it("standalone without access → no temp_layer (today)", async () => {
    const r = render(<TProvider lang="en"><CustomerDetails cur="NT$" /></TProvider>);
    await openRow(r);
    expect(r.queryByTestId("cd-frozen")).toBeNull();
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "20" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBeUndefined();
  });
  it("standalone with access in Dry mode → saved as 常溫", async () => {
    h.state = ACCESS("常溫");
    const r = render(<TProvider lang="en"><CustomerDetails cur="NT$" /></TProvider>);
    await openRow(r);
    await waitFor(() => expect(r.queryByTestId("cd-frozen")).toBeNull());
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBe("常溫");
  });
});
