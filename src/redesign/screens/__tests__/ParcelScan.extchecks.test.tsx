// Extension-written checks (sql/33) — the app DISPLAYS full-store / restricted-
// phone verdicts and never calls 賣貨便. FAIL-SAFE: NULL / 'unknown' show NO
// badge (unchecked must look unchecked, never clean); only explicit 'full' /
// 'restricted' badge + exclude, only explicit 'open'+'ok' show a subtle ✅.
// The new tabs surface ONLY when they have rows. Per-row ⟳ recheck just nulls
// the columns (confirmed via the portal); edit resets the matching verdict.
// Adapter mocked (DB calls are spies); the row builder includes the new fields.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";

const { loadRows, resetExtensionChecks, updateParcelScan } = vi.hoisted(() => ({
  loadRows: { current: [] as ParcelScanRow[] },
  resetExtensionChecks: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  updateParcelScan: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
}));

vi.mock("../../adapters/parcelScan", () => ({
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
  checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
  formErrors: () => ({ name: false, phone: false, store: false, amount: false, empty: false }),
  amountWarns: () => false,
  amountTooHigh: () => false,
  MIN_PARCEL_AMOUNT: 20, MAX_PARCEL_TOTAL: 20000, MAX_PENDING_PARCELS: 30,
  // REAL exclusion semantics so a screen row's export bucket matches production.
  splitScansForExport: (rows: ParcelScanRow[]) => {
    const ready: ParcelScanRow[] = []; const attention: { row: ParcelScanRow; reason: string }[] = [];
    for (const r of rows) {
      if (r.status === "exported") continue;
      if (r.storeCheckStatus === "not_found") attention.push({ row: r, reason: "wrong_store" });
      else if (r.storeFullStatus === "full") attention.push({ row: r, reason: "store_full" });
      else if (r.phoneCheckStatus === "restricted") attention.push({ row: r, reason: "restricted_number" });
      else ready.push(r);
    }
    return { ready, attention };
  },
  scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
  deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
  updateParcelScan, resetExtensionChecks,
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const mk = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550,
  notes: "", status: "confirmed", storeCheckStatus: "valid",
  storeFullStatus: null, phoneCheckStatus: null, phoneRestrictedUntil: null,
  createdAt: "2026-09-08T00:00:00Z", ...over,
});
const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  resetExtensionChecks.mockClear(); resetExtensionChecks.mockResolvedValue({ ok: true });
  updateParcelScan.mockClear(); updateParcelScan.mockResolvedValue({ ok: true });
  loadRows.current = [];
});

describe("Parcel Scan — extension check badges (FAIL-SAFE)", () => {
  it("NULL verdicts → NO badge, no ✅, and Full/Restricted tabs hidden", async () => {
    loadRows.current = [mk({ storeFullStatus: null, phoneCheckStatus: null })];
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-row");
    expect(queryByTestId("ps-ext-badge-full")).toBeNull();
    expect(queryByTestId("ps-ext-badge-restricted")).toBeNull();
    expect(queryByTestId("ps-ext-clear")).toBeNull();       // never clean when unchecked
    expect(queryByTestId("ps-tab-full")).toBeNull();
    expect(queryByTestId("ps-tab-restricted")).toBeNull();
  });

  it("'unknown' → NO badge and no tab (can't-verify ≠ problem, ≠ clean)", async () => {
    loadRows.current = [mk({ storeFullStatus: "unknown", phoneCheckStatus: "unknown" })];
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-row");
    expect(queryByTestId("ps-ext-badge-full")).toBeNull();
    expect(queryByTestId("ps-ext-badge-restricted")).toBeNull();
    expect(queryByTestId("ps-ext-clear")).toBeNull();
    expect(queryByTestId("ps-tab-full")).toBeNull();
    expect(queryByTestId("ps-tab-restricted")).toBeNull();
  });

  it("'full' → ⚠️ Full badge + Full tab (count) + a recheck button", async () => {
    loadRows.current = [mk({ storeFullStatus: "full" })];
    const { findByTestId, getByTestId } = view();
    expect(await findByTestId("ps-ext-badge-full")).toBeTruthy();
    expect(getByTestId("ps-tab-full").textContent).toContain("1");
    expect(getByTestId("ps-ext-recheck")).toBeTruthy();
  });

  it("'restricted' + until → 🚫 badge showing the date + Restricted tab", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "restricted", phoneRestrictedUntil: "2026-12-04" })];
    const { findByTestId, getByTestId } = view();
    const badge = await findByTestId("ps-ext-badge-restricted");
    expect(badge.textContent).toMatch(/Dec\s*4|12月|4 thg 12|4 Des|4 ธ/); // localized "Dec 4"-ish
    expect(getByTestId("ps-tab-restricted").textContent).toContain("1");
  });

  it("'open' + 'ok' → subtle ✅, no warning badges", async () => {
    loadRows.current = [mk({ storeFullStatus: "open", phoneCheckStatus: "ok" })];
    const { findByTestId, queryByTestId } = view();
    expect(await findByTestId("ps-ext-clear")).toBeTruthy();
    expect(queryByTestId("ps-ext-badge-full")).toBeNull();
    expect(queryByTestId("ps-ext-badge-restricted")).toBeNull();
  });
});

describe("Parcel Scan — per-row recheck (nulls the columns; app never calls 7-11)", () => {
  it("⟳ → confirm → resetExtensionChecks(id) and the badge clears", async () => {
    loadRows.current = [mk({ id: "rx", storeFullStatus: "full" })];
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-ext-recheck"));
    expect(getByTestId("ps-confirm-overlay")).toBeTruthy();
    expect(resetExtensionChecks).not.toHaveBeenCalled();     // not until confirmed
    fireEvent.click(getByTestId("ps-confirm-recheck"));
    await waitFor(() => expect(resetExtensionChecks).toHaveBeenCalledWith("rx"));
    await waitFor(() => expect(queryByTestId("ps-ext-badge-full")).toBeNull()); // verdict cleared locally
  });
});

describe("Parcel Scan — editing resets the matching verdict", () => {
  it("changing the store code → updateParcelScan called with storeFull reset", async () => {
    loadRows.current = [mk({ id: "r1", storeId: "266402", storeFullStatus: "full" })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.change(getByTestId("ps-store"), { target: { value: "199999" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    const [, , reset] = updateParcelScan.mock.calls[0] as [string, unknown, { storeFull?: boolean; phoneCheck?: boolean }];
    expect(reset.storeFull).toBe(true);
    expect(reset.phoneCheck).toBe(false); // phone unchanged
  });

  it("changing the phone → updateParcelScan called with phoneCheck reset", async () => {
    loadRows.current = [mk({ id: "r1", phone: "0912345678", phoneCheckStatus: "restricted" })];
    const { findByTestId, getByTestId } = view();
    fireEvent.click(await findByTestId("ps-row-edit"));
    fireEvent.change(getByTestId("ps-phone"), { target: { value: "0977777777" } });
    fireEvent.click(getByTestId("ps-save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    const [, , reset] = updateParcelScan.mock.calls[0] as [string, unknown, { storeFull?: boolean; phoneCheck?: boolean }];
    expect(reset.phoneCheck).toBe(true);
    expect(reset.storeFull).toBe(false); // store unchanged
  });
});
