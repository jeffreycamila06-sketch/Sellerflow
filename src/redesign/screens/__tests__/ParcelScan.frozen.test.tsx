// Parcel Scan Dry / Frozen on screen (sql/79): no access (or a read error without the hint) = no
// control and saves without temp_layer; access = the switch, confirmation before switching
// (never touching saved rows), new parcels use the mode, frozen min total, the ❄ 冷凍 badge, the
// edit layer, the Export-card frozen count, Customer Details Import using the current mode; a
// failed read for a frozen account BLOCKS save / import / export until Retry; a 冷凍 row is never
// exported as 常溫; a save waits for the frozen state instead of defaulting to Dry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { FROZEN_OFF, type FrozenState } from "../../adapters/parcelFrozen";

const h = vi.hoisted(() => ({
  state: null as unknown,
  rows: [] as unknown[],
  saveParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-1" })),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  saveParcelMode: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string }),
  loadParcelScans: vi.fn(async (..._a: unknown[]) => ({ ok: true, rows: [] as unknown[] })),
  loadFrozenState: vi.fn(),
  build: vi.fn(async (..._a: unknown[]) => new Uint8Array()),
  deliverXlsm: vi.fn(async () => ({ ok: true })),
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
    markScansExported: vi.fn(async (ids: string[]) => ({ ok: true, batchId: "batch-1", claimed: ids })), unmarkScansExported: vi.fn(async () => ({ ok: true })),
    confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()),
  buildXlsmFromTemplate: (...a: unknown[]) => h.build(...a),
  deliverXlsm: () => h.deliverXlsm(),
  deliverXlsmMobile: vi.fn(async () => ({ ok: true })),
  exportFilename: () => "x.xlsm",
}));
vi.mock("../../adapters/parcelFrozen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelFrozen")>();
  return { ...actual, loadFrozenState: () => h.loadFrozenState(), saveParcelMode: (...a: unknown[]) => h.saveParcelMode(...a) };
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
const ACCESS = (mode: "常溫" | "冷凍" = "常溫"): FrozenState => ({ status: "ok", blocked: false, allowed: true, mode, cfg: CFG });
const BLOCKED: FrozenState = { status: "error", blocked: true, allowed: false, mode: "常溫", cfg: null };
const ERROR_NO_HINT: FrozenState = { status: "error", blocked: false, allowed: false, mode: "常溫", cfg: null };
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
  h.loadFrozenState.mockReset(); h.loadFrozenState.mockImplementation(async () => h.state ?? FROZEN_OFF);
  h.build.mockClear(); h.deliverXlsm.mockClear();
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
  });
  it("a failed read WITHOUT the hint → identical to today (no notice, Save works, no temp_layer)", async () => {
    h.state = ERROR_NO_HINT;
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    expect(r.queryByTestId("ps-frozen-blocked")).toBeNull();
    expect(r.queryByTestId("ps-mode")).toBeNull();
    fill(r, "20");
    fireEvent.click(save(r));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBeUndefined();
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

  it("frozen rows get the badge; Export card counts them", async () => {
    h.state = ACCESS();
    h.rows = [mk({ id: "a" }), mk({ id: "b", tempLayer: "冷凍" }), mk({ id: "c", tempLayer: "冷凍" })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-frozen-badge")).toHaveLength(2));
    expect(r.getByTestId("ps-export-frozen").textContent).toContain("2 frozen");
  });

  it("a mixed export: each row carries its own layer and fee", async () => {
    h.state = ACCESS();
    h.rows = [mk({ id: "a", customerName: "Dry" }), mk({ id: "b", customerName: "Cold", tempLayer: "冷凍", amount: 300 })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-frozen-badge")).toHaveLength(1));
    fireEvent.click(r.getByTestId("ps-export-btn"));
    fireEvent.click(r.getByTestId("ps-confirm-export"));
    await waitFor(() => expect(h.build).toHaveBeenCalled());
    const out = h.build.mock.calls[0][1] as string[][];
    expect(out.map((x) => [x[0], x[3], x[5], x[6]])).toEqual([["Dry", "常溫", "500", "38"], ["Cold", "冷凍", "300", "129"]]);
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

describe("safety: unknown is never Dry, a frozen row is never exported as 常溫", () => {
  it("failed access read + frozen rows: rows still show ❄ and are EXCLUDED from export (never as 常溫)", async () => {
    h.state = ERROR_NO_HINT; // cfg null — the frozen settings could not be read
    h.rows = [mk({ id: "a", customerName: "Dry" }), mk({ id: "b", customerName: "Cold", tempLayer: "冷凍" })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-frozen-badge")).toHaveLength(1));
    expect(r.getByTestId("ps-export-btn").textContent).toContain("1"); // only the dry row is ready
    fireEvent.click(r.getByTestId("ps-export-btn"));
    fireEvent.click(r.getByTestId("ps-confirm-export"));
    await waitFor(() => expect(h.build).toHaveBeenCalled());
    const out = h.build.mock.calls[0][1] as string[][];
    expect(out.map((x) => x[0])).toEqual(["Dry"]);
    expect(out.every((x) => x[0] !== "Cold")).toBe(true);
    await waitFor(() => expect(r.getByTestId("ps-export-summary")).toBeTruthy());
    expect(r.getAllByTestId("ps-export-attn-row").map((e) => e.textContent).join(" ")).toContain("Frozen settings could not be loaded — reopen Parcel Scan");
  });

  it("hint set + failed read → notice; Save and Export disabled; Retry recovers", async () => {
    h.loadFrozenState.mockImplementationOnce(async () => BLOCKED).mockImplementation(async () => ACCESS("冷凍"));
    h.rows = [mk({ id: "a" })];
    const r = view();
    await r.findByTestId("ps-frozen-blocked");
    expect((r.getByTestId("ps-export-btn") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("ps-manual"));
    fill(r, "200");
    expect(save(r).disabled).toBe(true);
    expect(r.queryByTestId("ps-mode")).toBeNull();
    fireEvent.click(r.getByTestId("ps-frozen-retry"));
    await waitFor(() => expect(r.queryByTestId("ps-frozen-blocked")).toBeNull());
    expect(r.getByTestId("ps-mode").getAttribute("data-mode")).toBe("冷凍");
    expect((r.getByTestId("ps-export-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(save(r).disabled).toBe(false);
    fireEvent.click(save(r));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBe("冷凍");
  });

  it("a Save tapped before the frozen state loads WAITS for it (never saved as Dry by default)", async () => {
    let release: (s: FrozenState) => void = () => {};
    h.loadFrozenState.mockImplementation(() => new Promise<FrozenState>((res) => { release = res; }));
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fill(r, "200");
    fireEvent.click(save(r));
    await new Promise((res) => setTimeout(res, 30));
    expect(h.saveParcelScan).not.toHaveBeenCalled();
    release(ACCESS("冷凍"));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBe("冷凍");
  });

  it("a Save tapped while loading that then comes back BLOCKED is refused", async () => {
    let release: (s: FrozenState) => void = () => {};
    h.loadFrozenState.mockImplementation(() => new Promise<FrozenState>((res) => { release = res; }));
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fill(r, "200");
    fireEvent.click(save(r));
    release(BLOCKED);
    await r.findByTestId("ps-frozen-blocked");
    await new Promise((res) => setTimeout(res, 30));
    expect(h.saveParcelScan).not.toHaveBeenCalled();
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
  it("embedded in a blocked Parcel Scan → notice, Import disabled, nothing saved", async () => {
    const r = render(<TProvider lang="en"><CustomerDetails cur="NT$" frozenState={BLOCKED} waitFrozen={async () => BLOCKED} /></TProvider>);
    await openRow(r);
    expect(r.getByTestId("cd-frozen-blocked")).toBeTruthy();
    expect(r.queryByTestId("cd-frozen-retry")).toBeNull(); // Parcel Scan owns the Retry
    expect((r.getByTestId("cd-import") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    expect(h.saveParcelScan).not.toHaveBeenCalled();
  });
  it("standalone + hint + failed read → blocked; Retry recovers and imports with the mode", async () => {
    h.loadFrozenState.mockImplementationOnce(async () => BLOCKED).mockImplementation(async () => ACCESS("冷凍"));
    const r = render(<TProvider lang="en"><CustomerDetails cur="NT$" /></TProvider>);
    await openRow(r);
    await r.findByTestId("cd-frozen-blocked");
    expect((r.getByTestId("cd-import") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("cd-frozen-retry"));
    await waitFor(() => expect(r.queryByTestId("cd-frozen-blocked")).toBeNull());
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(h.saveParcelScan).toHaveBeenCalled());
    expect(h.saveParcelScan.mock.calls[0][2]).toBe("冷凍");
  });
});

describe("frozen rows: store verdict is not a frozen check (display only)", () => {
  const ok = { phoneCheckStatus: "ok", storeFullStatus: "open" } as const;
  it("frozen + phone ok + store open → amber frozen note + muted Buyer OK, never the green all-clear", async () => {
    h.rows = [mk({ id: "f", tempLayer: "冷凍", ...ok }), mk({ id: "d", ...ok })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-row")).toHaveLength(2));
    const [frozenRow, dryRow] = r.getAllByTestId("ps-row");
    expect(frozenRow.querySelector('[data-testid="ps-ext-clear"]')).toBeNull();
    expect(frozenRow.querySelector('[data-testid="ps-frozen-store-note"]')?.textContent).toBe("❄ Store not checked for frozen — 賣貨便 confirms on upload");
    expect(frozenRow.querySelector('[data-testid="ps-frozen-phone-ok"]')?.textContent).toContain("Buyer OK");
    expect(frozenRow.getAttribute("data-flag")).toBe("");
    // the dry row is exactly today's: green all-clear, no frozen note
    expect(dryRow.querySelector('[data-testid="ps-ext-clear"]')?.textContent).toBe("✅ Buyer OK");
    expect(dryRow.querySelector('[data-testid="ps-frozen-store-note"]')).toBeNull();
    expect(dryRow.querySelector('[data-testid="ps-frozen-phone-ok"]')).toBeNull();
  });
  it("frozen + company (also a clear store verdict) → the frozen note, no green", async () => {
    h.rows = [mk({ id: "f", tempLayer: "冷凍", phoneCheckStatus: "ok", storeFullStatus: "company" })];
    const r = view();
    await r.findByTestId("ps-frozen-store-note");
    expect(r.queryByTestId("ps-ext-clear")).toBeNull();
  });
  it("frozen + restricted buyer → red as today (no frozen note)", async () => {
    h.rows = [mk({ id: "f", tempLayer: "冷凍", phoneCheckStatus: "restricted", storeFullStatus: "open", phoneRestrictedUntil: "2026-12-04" })];
    const r = view();
    await waitFor(() => expect(r.getByTestId("ps-row").getAttribute("data-flag")).toBe("red"));
    expect(r.getByTestId("ps-ext-badge-restricted")).toBeTruthy();
    expect(r.queryByTestId("ps-frozen-store-note")).toBeNull();
    expect(r.queryByTestId("ps-ext-clear")).toBeNull();
  });
  it("frozen + wrong store code → red badge and excluded from export as today", async () => {
    h.state = ACCESS();
    h.rows = [mk({ id: "f", tempLayer: "冷凍", phoneCheckStatus: "ok", storeFullStatus: "not_found" }), mk({ id: "d" })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-row")[0].getAttribute("data-flag")).toBe("red"));
    expect(r.getAllByTestId("ps-store-badge")[0].getAttribute("data-status")).toBe("not_found");
    expect(r.queryByTestId("ps-frozen-store-note")).toBeNull();
    expect(r.getByTestId("ps-export-btn").textContent).toContain("1"); // only the dry row is ready
  });
  it("frozen + store full → orange as today (no frozen note); export still includes clean frozen rows", async () => {
    h.state = ACCESS();
    h.rows = [mk({ id: "full", tempLayer: "冷凍", phoneCheckStatus: "ok", storeFullStatus: "full" }), mk({ id: "f", customerName: "Cold", tempLayer: "冷凍", ...ok })];
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("ps-row")[0].getAttribute("data-flag")).toBe("orange"));
    expect(r.getAllByTestId("ps-frozen-store-note")).toHaveLength(1);
    fireEvent.click(r.getByTestId("ps-export-btn"));
    fireEvent.click(r.getByTestId("ps-confirm-export"));
    await waitFor(() => expect(h.build).toHaveBeenCalled());
    expect((h.build.mock.calls[0][1] as string[][]).map((x) => [x[0], x[3]])).toEqual([["Cold", "冷凍"]]);
  });
});
