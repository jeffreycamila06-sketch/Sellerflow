// Change 1 (tiles removed) + Change 2 (Parcel Scan monitoring view). The
// getParcelScanOverview RPC call is mocked; the money helpers are the REAL ones
// so the adjustable-cost recompute is exercised end-to-end.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanOverview } from "../../adapters/useAdmin";

const overview: ParcelScanOverview = {
  totalCredits: 12,
  scansThisMonth: 50,
  activeUsers: 3,
  technicalRefundsThisMonth: 2,
  creditsGrantedThisMonth: 100,
  successesThisMonth: 40,
  badPhotoThisMonth: 8,
  technicalThisMonth: 2,
  untrackedThisMonth: 0,
  monthly: [
    { month: "2026-09", scans: 50, badPhoto: 8, creditsGranted: 100 },
    { month: "2026-08", scans: 20, badPhoto: 3, creditsGranted: 40 },
  ],
  rows: [
    { email: "a@x.com", balance: 5, scansThisMonth: 30, badPhotoThisMonth: 6, lastScanAt: "2026-09-08T00:00:00Z" },
    { email: "b@x.com", balance: 0, scansThisMonth: 0, badPhotoThisMonth: 0, lastScanAt: null },
  ],
};

const getParcelScanOverview = vi.fn(async () => ({ ok: true, data: overview }));
// Keep the REAL money helpers + constants; stub only the RPC fetch.
vi.mock("../../adapters/useAdmin", async (importActual) => ({
  ...(await importActual<typeof import("../../adapters/useAdmin")>()),
  getParcelScanOverview: () => getParcelScanOverview(),
}));

import Admin, { AdminPanel } from "../Admin";

beforeEach(() => { getParcelScanOverview.mockClear(); getParcelScanOverview.mockResolvedValue({ ok: true, data: overview }); });

describe("Change 1 — dead Controls tiles removed", () => {
  it("Controls grid has Parcel Scan; the System tile and the User Base tile are gone", () => {
    const { getByText, queryByText, getAllByText } = render(
      <TProvider><Admin onOpenPanel={() => {}} cur="NT$" /></TProvider>,
    );
    expect(getByText("Parcel Scan")).toBeTruthy();      // new tile
    expect(queryByText("System")).toBeNull();           // system tile fully gone (no other "System" text)
    // The removed tile label was "User Base" (capital B); the top stat card is
    // "User base" (lowercase) — so exactly-"User Base" must be absent now.
    expect(queryByText("User Base")).toBeNull();
    expect(getAllByText("User base").length).toBe(1);   // only the top stat card remains
  });
});

describe("Change 2 — Parcel Scan monitoring view", () => {
  const view = () => render(<TProvider><AdminPanel panel="parcelmon" onClose={() => {}} cur="NT$" /></TProvider>);

  it("renders all three sections with the RPC data + client money math", async () => {
    const { findByTestId, getByTestId, getAllByTestId } = view();
    await findByTestId("pm-panel");
    // A) summary
    expect(getByTestId("pm-total-credits").textContent).toBe("12");
    expect(getByTestId("pm-scans-month").textContent).toBe("50");
    expect(getByTestId("pm-successes").textContent).toBe("40");
    expect(getByTestId("pm-tech-refunds").textContent).toBe("2");
    // revenue = 100 × 0.50 = 50; cost = 50 × 0.20 = 10; profit = 40
    expect(getByTestId("pm-revenue").textContent).toBe("NT$50.00");
    expect(getByTestId("pm-cost").textContent).toBe("NT$10.00");
    expect(getByTestId("pm-profit").textContent).toBe("NT$40.00");
    // B) monthly history — one row per month
    expect(getAllByTestId("pm-history-row").length).toBe(2);
    // C) per-seller list
    expect(getAllByTestId("pm-seller-row").length).toBe(2);
  });

  it("bad-photo is now a REAL count (not '—'), with the abuse/waste signal line", async () => {
    const { findByTestId, getByTestId } = view();
    await findByTestId("pm-panel");
    expect(getByTestId("pm-badphoto").textContent).toBe("8");           // real outcome count
    expect(getByTestId("pm-badphoto-note").textContent).toContain("8"); // "Bad-photo scans this month: 8 …"
    expect(getByTestId("pm-badphoto-note").textContent?.toLowerCase()).toContain("charged");
  });

  it("the adjustable API-cost lever recomputes cost & profit live", async () => {
    const { findByTestId, getByTestId } = view();
    await findByTestId("pm-panel");
    fireEvent.change(getByTestId("pm-scan-cost"), { target: { value: "0.05" } });
    await waitFor(() => expect(getByTestId("pm-cost").textContent).toBe("NT$2.50"));  // 50 × 0.05
    expect(getByTestId("pm-profit").textContent).toBe("NT$47.50");                    // 50 − 2.50
    expect(getByTestId("pm-revenue").textContent).toBe("NT$50.00");                   // revenue unchanged
  });

  it("pre-feature (null-outcome) scans surface as an 'untracked' note, not fabricated", async () => {
    getParcelScanOverview.mockResolvedValue({ ok: true, data: { ...overview, untrackedThisMonth: 12 } });
    const { findByTestId, getByTestId } = view();
    await findByTestId("pm-panel");
    expect(getByTestId("pm-untracked-note").textContent).toContain("12");
  });

  it("per-seller bad-photo count is shown for a waster", async () => {
    const { findByTestId, getAllByTestId } = view();
    await findByTestId("pm-panel");
    // seller a@x.com has 6 bad-photo this month → shown on their row
    const rows = getAllByTestId("pm-seller-row");
    expect(rows[0].textContent).toContain("6");
  });

  it("an RPC failure shows an honest error, no crash", async () => {
    getParcelScanOverview.mockResolvedValue({ ok: false, data: undefined } as unknown as { ok: true; data: ParcelScanOverview });
    const { findByTestId } = view();
    expect(await findByTestId("pm-error")).toBeTruthy();
  });
});
