// Customer Details (7-11) — the "Parcel added" toast hides itself after 2.5 s, and its timer stops when
// the screen closes (the same fix as Pickup Status, CI run 1843).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelCustomer } from "../../adapters/parcelCustomers";
import { expectNothingLate, tick, until } from "../../adapters/__tests__/pageGone";

const { recent, saveParcelScan } = vi.hoisted(() => ({
  recent: { current: { ok: true, rows: [] as ParcelCustomer[] } },
  saveParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-1" }) as { ok: boolean; id?: string }),
}));
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => recent.current,
  searchParcelCustomers: async () => ({ ok: true, rows: [] }),
  updateParcelCustomer: vi.fn(async () => ({ ok: true })),
  deleteParcelCustomer: vi.fn(async () => ({ ok: true })),
  countPendingParcels: async () => ({ ok: true, count: 0 }),
  countParcelCustomers: async () => ({ ok: true, count: 1 }),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return { ...actual, saveParcelScan: (...a: unknown[]) => saveParcelScan(...a) };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import CustomerDetails from "../CustomerDetails";

const CUSTOMER: ParcelCustomer = { id: "c1", phone: "0912345678", name: "Maria", storeId: "266402", notes: "@maria", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" };
const view = () => render(<TProvider lang="en"><CustomerDetails cur="NT$" /></TProvider>);
async function importOne(r: ReturnType<typeof view>) {
  await until(() => r.queryByTestId("cd-row-main"));
  fireEvent.click(r.getByTestId("cd-row-main"));
  await until(() => r.queryByTestId("cd-import-panel"));
  fireEvent.change(r.getByTestId("cd-price"), { target: { value: "100" } });
  fireEvent.click(r.getByTestId("cd-import"));
}

beforeEach(() => {
  vi.useFakeTimers();   // the clock moves only when a test moves it
  recent.current = { ok: true, rows: [CUSTOMER] };
  saveParcelScan.mockReset(); saveParcelScan.mockResolvedValue({ ok: true, id: "new-1" });
});
afterEach(() => { vi.useRealTimers(); });

describe("Customer Details — the 'Parcel added' toast", () => {
  it("the screen is closed right after an import: no timer is left and nothing updates late", async () => {
    const r = view();
    await importOne(r);
    await until(() => r.queryByTestId("cd-toast"));
    expect(vi.getTimerCount()).toBe(1);   // the toast's 2.5 s
    r.unmount();
    expectNothingLate();
  });
  it("the screen is closed while the import is still being saved: no timer is started afterwards", async () => {
    let done: ((v: { ok: boolean; id: string }) => void) | null = null;
    saveParcelScan.mockImplementation(() => new Promise((res) => { done = res; }));
    const r = view();
    await importOne(r);
    await until(() => saveParcelScan.mock.calls.length === 1);
    r.unmount();
    done!({ ok: true, id: "new-1" });
    await tick(0);
    expectNothingLate();
  });
  it("while the screen is open nothing changed: the toast stays 2.5 seconds", async () => {
    const r = view();
    await importOne(r);
    await until(() => r.queryByTestId("cd-toast"));
    expect(r.getByTestId("cd-toast").textContent).toBe("Parcel added");
    await tick(2499);
    expect(r.queryByTestId("cd-toast")?.textContent).toBe("Parcel added");
    await tick(1);
    expect(r.queryByTestId("cd-toast")).toBeNull();
  });
});
