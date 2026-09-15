// Customer Details screen — search → import → edit/delete. Uses the REAL Parcel
// Scan validators (importOriginal) so the min/max/batch gates run exactly as a
// fresh encode does; only the DB/network calls (parcelCustomers + saveParcelScan
// + fee) are mocked. Asserts the Import path never bypasses validation or the
// pending-parcel cap, and that edit/delete are own-scoped through the adapter.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelCustomer } from "../../adapters/parcelCustomers";

const { recent, search, saveParcelScan, updateParcelCustomer, deleteParcelCustomer, countPending } = vi.hoisted(() => ({
  recent: { current: { ok: true, rows: [] as ParcelCustomer[] } as { ok: boolean; rows: ParcelCustomer[]; error?: string } },
  search: { current: { ok: true, rows: [] as ParcelCustomer[] } as { ok: boolean; rows: ParcelCustomer[]; error?: string } },
  saveParcelScan: vi.fn(async () => ({ ok: true, id: "new-1" }) as { ok: boolean; id?: string; error?: string }),
  updateParcelCustomer: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  deleteParcelCustomer: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  countPending: vi.fn(async () => ({ ok: true, count: 0 }) as { ok: boolean; count: number; error?: string }),
}));

vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => recent.current,
  searchParcelCustomers: async () => search.current,
  updateParcelCustomer: (...a: unknown[]) => updateParcelCustomer(...(a as [])),
  deleteParcelCustomer: (...a: unknown[]) => deleteParcelCustomer(...(a as [])),
  countPendingParcels: () => countPending(),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return { ...actual, saveParcelScan: (...a: unknown[]) => saveParcelScan(...(a as [])) };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import CustomerDetails from "../CustomerDetails";

const mk = (over: Partial<ParcelCustomer> = {}): ParcelCustomer => ({
  id: "c1", phone: "0912345678", name: "Maria", storeId: "266402", notes: "@maria",
  createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", ...over,
});
const view = () => render(<TProvider><CustomerDetails cur="NT$" /></TProvider>);

beforeEach(() => {
  recent.current = { ok: true, rows: [] };
  search.current = { ok: true, rows: [] };
  saveParcelScan.mockClear(); saveParcelScan.mockResolvedValue({ ok: true, id: "new-1" });
  updateParcelCustomer.mockClear(); updateParcelCustomer.mockResolvedValue({ ok: true });
  deleteParcelCustomer.mockClear(); deleteParcelCustomer.mockResolvedValue({ ok: true });
  countPending.mockClear(); countPending.mockResolvedValue({ ok: true, count: 0 });
});

describe("recent list + empty", () => {
  it("renders recent customers on open", async () => {
    recent.current = { ok: true, rows: [mk(), mk({ id: "c2", name: "Pedro", phone: "0900000000" })] };
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("cd-row")).toHaveLength(2));
    expect(r.getAllByTestId("cd-row-name").map((e) => e.textContent)).toEqual(["Maria", "Pedro"]);
  });
  it("empty recent → encode-a-parcel empty state", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("cd-empty")).toBeTruthy());
    expect(r.getByTestId("cd-empty").textContent).toContain("Encode a parcel");
  });
});

describe("search", () => {
  it("typing a query searches and shows the match count + results", async () => {
    search.current = { ok: true, rows: [mk({ id: "s1", name: "Ana" })] };
    const r = view();
    await waitFor(() => expect(r.getByTestId("cd-heading")).toBeTruthy());
    fireEvent.change(r.getByTestId("cd-search"), { target: { value: "ana" } });
    await waitFor(() => expect(r.getByTestId("cd-heading").textContent).toContain("1 found"));
    expect(r.getByTestId("cd-row-name").textContent).toBe("Ana");
  });
  it("search with no matches → no-matches state", async () => {
    search.current = { ok: true, rows: [] };
    const r = view();
    fireEvent.change(r.getByTestId("cd-search"), { target: { value: "zzz" } });
    await waitFor(() => expect(r.getByTestId("cd-empty").textContent).toContain("No matches"));
  });
});

describe("import — no bypass of validation or the batch cap", () => {
  async function openRow() {
    recent.current = { ok: true, rows: [mk()] };
    const r = view();
    await waitFor(() => expect(r.getByTestId("cd-row-main")).toBeTruthy());
    fireEvent.click(r.getByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-import-panel")).toBeTruthy());
    return r;
  }

  it("valid price → saveParcelScan with the buyer's fields as a pending parcel", async () => {
    const r = await openRow();
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalled());
    expect(saveParcelScan.mock.calls[0][0]).toEqual({ name: "Maria", phone: "0912345678", store_id: "266402", amount: 100, notes: "@maria" });
    expect(saveParcelScan.mock.calls[0][1]).toBeNull(); // no raw_extraction on an import
    await waitFor(() => expect(r.getByTestId("cd-toast")).toBeTruthy());
  });

  it("below-minimum price → error, NO count, NO save", async () => {
    const r = await openRow();
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "10" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toContain("20"));
    expect(countPending).not.toHaveBeenCalled();
    expect(saveParcelScan).not.toHaveBeenCalled();
  });

  it("over-ceiling price → distinct max error, NO save", async () => {
    const r = await openRow();
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "99999" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toContain("20,000"));
    expect(saveParcelScan).not.toHaveBeenCalled();
  });

  it("batch full (count = MAX) → batch-full error, valid price, NO save", async () => {
    countPending.mockResolvedValue({ ok: true, count: 40 });
    const r = await openRow();
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toContain("Batch full"));
    expect(saveParcelScan).not.toHaveBeenCalled();
  });

  it("count read fails → generic error, NO save (never imports past the cap)", async () => {
    countPending.mockResolvedValue({ ok: false, count: 0, error: "down" });
    const r = await openRow();
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err")).toBeTruthy());
    expect(saveParcelScan).not.toHaveBeenCalled();
  });
});

describe("edit + delete", () => {
  it("edit → updateParcelCustomer with trimmed fields", async () => {
    recent.current = { ok: true, rows: [mk()] };
    const r = view();
    await waitFor(() => expect(r.getByTestId("cd-row-main")).toBeTruthy());
    fireEvent.click(r.getByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-edit")).toBeTruthy());
    fireEvent.click(r.getByTestId("cd-edit"));
    await waitFor(() => expect(r.getByTestId("cd-edit-name")).toBeTruthy());
    fireEvent.change(r.getByTestId("cd-edit-name"), { target: { value: "  Maria S  " } });
    fireEvent.click(r.getByTestId("cd-edit-save"));
    await waitFor(() => expect(updateParcelCustomer).toHaveBeenCalled());
    expect(updateParcelCustomer.mock.calls[0]).toEqual(["c1", { name: "Maria S", phone: "0912345678", store_id: "266402", notes: "@maria" }]);
  });

  it("delete → confirm → deleteParcelCustomer, row removed", async () => {
    recent.current = { ok: true, rows: [mk()] };
    const r = view();
    await waitFor(() => expect(r.getByTestId("cd-row-main")).toBeTruthy());
    fireEvent.click(r.getByTestId("cd-row-main"));
    await waitFor(() => expect(r.getByTestId("cd-delete")).toBeTruthy());
    fireEvent.click(r.getByTestId("cd-delete"));
    await waitFor(() => expect(r.getByTestId("cd-del-go")).toBeTruthy());
    fireEvent.click(r.getByTestId("cd-del-go"));
    await waitFor(() => expect(deleteParcelCustomer).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(r.queryByTestId("cd-row")).toBeNull());
  });
});
