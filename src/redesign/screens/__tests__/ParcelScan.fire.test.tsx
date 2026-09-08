// FIRE-FIX wiring proof (no browser needed): render the screen, and prove the
// fire-and-forget store check actually reaches checkEmapStore with the right
// storeId. Uses the Re-check button (runStoreCheck → checkEmapStore) — the same
// runStoreCheck the save handler calls once `if (r.id)` passes (proven in
// parcelScanSaveFire.test.ts). Together the two suites cover both halves of the
// wiring that produced zero POSTs in prod.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { checkEmapStore, saveStoreCheck, loadParcelScans } = vi.hoisted(() => ({
  checkEmapStore: vi.fn(async () => ({ status: "valid" as const })),
  saveStoreCheck: vi.fn(async () => ({ ok: true })),
  loadParcelScans: vi.fn(async () => ({
    ok: true,
    rows: [
      // A flagged row (unknown + 6-digit store + real id) → Re-check button renders.
      { id: "row-1", customerName: "A", phone: "0912345678", storeId: "982063", amount: 550, notes: "", status: "confirmed", storeCheckStatus: "unknown", createdAt: "2026-09-08T00:00:00Z" },
    ],
  })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  fileToScanBase64: vi.fn(),
  scanParcel: vi.fn(),
  saveParcelScan: vi.fn(),
  loadParcelScans,
  checkEmapStore,
  saveStoreCheck,
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
}));

import ParcelScan from "../ParcelScan";

beforeEach(() => { checkEmapStore.mockClear(); saveStoreCheck.mockClear(); });

describe("ParcelScan store-check wiring", () => {
  it("Re-check on a flagged row calls checkEmapStore exactly once with the storeId (runStoreCheck fires)", async () => {
    const { findByTestId } = render(
      <TProvider><ParcelScan cur="NT$" /></TProvider>,
    );
    const btn = await findByTestId("ps-recheck"); // renders only when the wiring's guard allows
    fireEvent.click(btn);
    await waitFor(() => expect(checkEmapStore).toHaveBeenCalledTimes(1));
    expect(checkEmapStore).toHaveBeenCalledWith("982063");
    // verdict is persisted too (best-effort)
    await waitFor(() => expect(saveStoreCheck).toHaveBeenCalledWith("row-1", "valid"));
  });
});
