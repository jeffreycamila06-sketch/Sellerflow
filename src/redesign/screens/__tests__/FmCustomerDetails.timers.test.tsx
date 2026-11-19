// Customer Details (FamilyMart) — the "Parcel added" toast hides itself after 2.5 s, and its timer stops
// when the screen closes (the same fix as Pickup Status, CI run 1843).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { FmCustomer } from "../../adapters/fmCustomers";
import { expectNothingLate, tick, until } from "../../adapters/__tests__/pageGone";

const { saveFmScan, rows } = vi.hoisted(() => ({
  saveFmScan: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean }),
  rows: { current: [] as FmCustomer[] },
}));
vi.mock("../../adapters/fmCustomers", () => ({
  loadRecentFmCustomers: async () => ({ ok: true, rows: rows.current }),
  searchFmCustomers: async () => ({ ok: true, rows: [] }),
  updateFmCustomer: vi.fn(async () => ({ ok: true })),
  deleteFmCustomer: vi.fn(async () => ({ ok: true })),
  countFmCustomers: async () => ({ ok: true, count: 1 }),
}));
vi.mock("../../adapters/fmScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/fmScan")>();
  return { ...actual, loadFmGlobalFee: vi.fn(async () => 39), saveFmScan: (...a: unknown[]) => saveFmScan(...a) };
});

import FmCustomerDetails from "../FmCustomerDetails";

const CUSTOMER: FmCustomer = { id: "c1", phone: "0911222333", name: "黃志明", storeId: "022131", buyerUsername: "@jeff", contactPlatform: null, createdAt: "", updatedAt: "" };
const view = () => render(<TProvider lang="en"><FmCustomerDetails cur="NT$" /></TProvider>);
async function importOne(r: ReturnType<typeof view>) {
  await until(() => r.queryAllByTestId("fcd-row-main").length > 0);
  fireEvent.click(r.getAllByTestId("fcd-row-main")[0]);
  await until(() => r.queryByTestId("fcd-import-panel"));
  fireEvent.change(r.getByTestId("fcd-price"), { target: { value: "300" } });
  fireEvent.click(r.getByTestId("fcd-import"));
}

beforeEach(() => {
  vi.useFakeTimers();   // the clock moves only when a test moves it
  rows.current = [CUSTOMER];
  saveFmScan.mockReset(); saveFmScan.mockResolvedValue({ ok: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("FamilyMart Customer Details — the 'Parcel added' toast", () => {
  it("the screen is closed right after an import: no timer is left and nothing updates late", async () => {
    const r = view();
    await importOne(r);
    await until(() => r.queryByTestId("fcd-toast"));
    expect(saveFmScan).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);   // the toast's 2.5 s
    r.unmount();
    expectNothingLate();
  });
  it("the screen is closed while the import is still being saved: no timer is started afterwards", async () => {
    let done: ((v: { ok: boolean }) => void) | null = null;
    saveFmScan.mockImplementation(() => new Promise((res) => { done = res; }));
    const r = view();
    await importOne(r);
    await until(() => saveFmScan.mock.calls.length === 1);
    r.unmount();
    done!({ ok: true });
    await tick(0);
    expectNothingLate();
  });
  it("while the screen is open nothing changed: the toast stays 2.5 seconds", async () => {
    const r = view();
    await importOne(r);
    await until(() => r.queryByTestId("fcd-toast"));
    expect(r.getByTestId("fcd-toast").textContent).toBe("Parcel added");
    await tick(2499);
    expect(r.queryByTestId("fcd-toast")?.textContent).toBe("Parcel added");
    await tick(1);
    expect(r.queryByTestId("fcd-toast")).toBeNull();
  });
});
