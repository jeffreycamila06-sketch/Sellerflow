// Admin → Parcel Scan monitoring: "Exports per seller" block (sql/69 RPC
// admin_parcel_export_monitor). One RPC on open + manual Refresh; quiet on failure —
// the rest of the panel always renders.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanOverview } from "../../adapters/useAdmin";

const M = vi.hoisted(() => ({ narrow: false, rows: [] as unknown[], error: null as unknown, throwOn: false }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../../supabase", () => ({ supabase: { rpc: (name: string) => rpc(name) }, isSupabaseConfigured: true }));
vi.mock("../../adapters/appShell", async (importActual) => ({
  ...(await importActual<object>()),
  isAppShell: () => false,
  isNarrowViewport: () => M.narrow,
}));
const overview: ParcelScanOverview = {
  totalCredits: 0, scansThisMonth: 0, activeUsers: 0, technicalRefundsThisMonth: 0, creditsGrantedThisMonth: 0,
  successesThisMonth: 0, badPhotoThisMonth: 0, technicalThisMonth: 0, untrackedThisMonth: 0, monthly: [], rows: [],
};
vi.mock("../../adapters/useAdmin", async (importActual) => ({
  ...(await importActual<typeof import("../../adapters/useAdmin")>()),
  getParcelScanOverview: async () => ({ ok: true, data: overview }),
}));

import { AdminPanel } from "../Admin";

const ROWS = [
  { seller_id: "u1", seller_email: "big@x.com", seller_store: "Big Ukay", seller_plan: "pro", seller_plan_status: "active",
    this_month: 1234, last_month: 5678, last_7d: 321, today: 12, total: 9000, last_export_day: "2026-10-02", pickup_status: true, has_shop_link: true },
  { seller_id: "u2", seller_email: "small@x.com", seller_store: "Small Shop", seller_plan: "basic", seller_plan_status: "active",
    this_month: 7, last_month: 0, last_7d: 0, today: 0, total: 40, last_export_day: null, pickup_status: false, has_shop_link: false },
];
beforeEach(() => {
  M.narrow = false; rpc.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === "admin_parcel_export_monitor") {
      if (M.throwOn) throw new Error("boom");
      return M.error ? { data: null, error: M.error } : { data: M.rows, error: null };
    }
    return { data: null, error: { message: "not mocked" } }; // e.g. the check-queue block stays quiet
  });
  M.rows = ROWS; M.error = null; M.throwOn = false;
});
const view = () => render(<TProvider lang="en"><AdminPanel panel="parcelmon" onClose={() => {}} cur="NT$" /></TProvider>);
const exportCalls = () => rpc.mock.calls.filter(([n]) => n === "admin_parcel_export_monitor").length;

describe("Exports per seller — web", () => {
  it("sits in pm-panel right under the check-queue slot; summary + rows with thousands separators", async () => {
    const r = view();
    const block = await r.findByTestId("pm-exports");
    expect(r.getByTestId("pm-panel").contains(block)).toBe(true);
    await waitFor(() => expect(r.getByTestId("pm-exports-summary").textContent).toBe("This month 1,241 · Last month 5,678 · 2 sellers"));
    const rows = r.getAllByTestId("pm-exports-row");
    expect(rows).toHaveLength(2);
    const big = within(rows[0]);
    expect(big.getByText("Big Ukay")).toBeTruthy();
    expect(big.getByText("big@x.com")).toBeTruthy();
    expect(big.getByText("pro")).toBeTruthy();
    expect(big.getByText("1,234")).toBeTruthy();
    expect(big.getByText("5,678")).toBeTruthy();
    expect(big.getByText("321")).toBeTruthy();
    expect(big.getByText("10/02")).toBeTruthy();
    expect(big.getByText("✓")).toBeTruthy();
    expect(big.queryByText("no shop link")).toBeNull();
  });
  it("null last export → '—'; pickup off → '—'; no shop link → the muted tag", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pm-exports-row")).toHaveLength(2));
    const small = r.getAllByTestId("pm-exports-row")[1];
    const cells = small.querySelectorAll("td");
    expect(cells[5].textContent).toBe("—"); // last export
    expect(cells[6].textContent).toBe("—"); // pickup
    expect(within(small).getByText("no shop link")).toBeTruthy();
  });
  it("Refresh re-calls the RPC", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pm-exports-row")).toHaveLength(2));
    expect(exportCalls()).toBe(1);
    fireEvent.click(r.getByTestId("pm-exports-refresh"));
    await waitFor(() => expect(exportCalls()).toBe(2));
    await waitFor(() => expect(r.getAllByTestId("pm-exports-row")).toHaveLength(2));
  });
});

describe("Exports per seller — states", () => {
  it("loading → 'Loading…'", async () => {
    rpc.mockImplementation(async () => new Promise(() => {}));
    const r = view();
    const block = await r.findByTestId("pm-exports");
    expect(block.textContent).toContain("Loading…");
  });
  it("RPC error (and a throw) → 'Couldn't load exports'; the rest of pm-panel still renders", async () => {
    M.error = { message: "not_admin" };
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-exports").textContent).toContain("Couldn't load exports"));
    expect(r.getByTestId("pm-scan-cost")).toBeTruthy();       // the panel's own content is still there
    expect(r.getByTestId("pm-total-credits")).toBeTruthy();
    r.unmount();
    M.error = null; M.throwOn = true;
    const r2 = view();
    await waitFor(() => expect(r2.getByTestId("pm-exports").textContent).toContain("Couldn't load exports"));
    expect(r2.getByTestId("pm-total-credits")).toBeTruthy();
  });
  it("empty → 'No exports yet'", async () => {
    M.rows = [];
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-exports").textContent).toContain("No exports yet"));
    expect(r.queryByTestId("pm-exports-row")).toBeNull();
  });
});

describe("Exports per seller — phone width", () => {
  it("compact rows: store + this month (bold) on line 1; plan · last month · 7d · last · Pickup on line 2", async () => {
    M.narrow = true;
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("pm-exports-row")).toHaveLength(2));
    expect(r.queryByRole("table", { name: /exports/i })).toBeNull();
    const [big, small] = r.getAllByTestId("pm-exports-row");
    expect(big.textContent).toContain("Big Ukay");
    expect(big.textContent).toContain("1,234");
    expect(big.textContent).toContain("pro · last month 5,678 · 7d 321 · last 10/02 · Pickup ✓");
    expect(small.textContent).toContain("basic · last month 0 · 7d 0 · last — · Pickup —");
    expect(within(small).getByText("no shop link")).toBeTruthy();
    expect(big.querySelector("td")).toBeNull(); // not the table layout
  });
});
