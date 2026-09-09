// Part 2 seller UI — Scan Credits balance display, the blocked-at-zero state
// (out-of-credits card + Telegram top-up anchor + disabled pick button), and the
// insufficient_credits (HTTP 402) path from a scan. Adapter fully mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { getCreditBalance, scanParcel, fileToScanBase64 } = vi.hoisted(() => ({
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 }) as { ok: boolean; balance: number }),
  scanParcel: vi.fn(),
  fileToScanBase64: vi.fn(async () => ({ base64: "aGk=", mediaType: "image/jpeg" })),
}));

vi.mock("../../adapters/parcelScan", () => ({
  fileToScanBase64,
  scanParcel,
  saveParcelScan: vi.fn(),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: [] })),
  checkEmapStore: vi.fn(),
  saveStoreCheck: vi.fn(),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  splitScansForExport: () => ({ ready: [], attention: [] }),
  scanToXlsRow: vi.fn(),
  markScansExported: vi.fn(),
  deleteParcelScan: vi.fn(),
  deleteExportedParcels: vi.fn(),
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance,
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadShippingSettings: async () => null }));

import ParcelScan from "../ParcelScan";

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

beforeEach(() => {
  getCreditBalance.mockResolvedValue({ ok: true, balance: 5 });
  scanParcel.mockReset();
});

describe("Scan Credits UI", () => {
  it("shows the balance and lets you pick when credits > 0", async () => {
    const { findByTestId, getByTestId, queryByTestId } = view();
    expect((await findByTestId("ps-credits-n")).textContent).toBe("5");
    expect(queryByTestId("ps-credits-out")).toBeNull();          // not blocked
    expect((getByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(false);
  });

  it("balance 0 → blocked: out-of-credits card, Telegram anchor, pick disabled", async () => {
    getCreditBalance.mockResolvedValue({ ok: true, balance: 0 });
    const { findByTestId, getByTestId } = view();
    await findByTestId("ps-credits-out");                        // blocked card shown
    const a = getByTestId("ps-credits-topup") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");                                 // a REAL anchor (iOS rule)
    expect(a.getAttribute("href")).toBe("https://t.me/SellerFlowLive");
    expect(a.getAttribute("target")).toBe("_blank");
    expect((getByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a scan returning insufficient_credits (402) → balance drops to 0, blocked state appears, no confirm card", async () => {
    getCreditBalance.mockResolvedValue({ ok: true, balance: 1 });
    scanParcel.mockResolvedValue({ ok: false, insufficient: true, error: "insufficient_credits", balance: 0 });
    const { findByTestId, getByTestId, queryByTestId } = view();
    await findByTestId("ps-credits-n");
    // trigger a scan via the hidden file input
    const file = new File(["x"], "slip.jpg", { type: "image/jpeg" });
    fireEvent.change(getByTestId("ps-file"), { target: { files: [file] } });
    await waitFor(() => expect(getByTestId("ps-credits-out")).toBeTruthy()); // now blocked
    expect(getByTestId("ps-credits-n").textContent).toBe("0");
    expect(queryByTestId("ps-confirm")).toBeNull();  // no confirm form — the scan didn't happen
  });

  it("a successful scan decrements the shown balance to the server's returned value", async () => {
    getCreditBalance.mockResolvedValue({ ok: true, balance: 5 });
    scanParcel.mockResolvedValue({ ok: true, fields: { name: "陳", phone: null, store_id: null, amount: null, notes: null }, confidence: {}, balance: 4 });
    const { findByTestId, getByTestId } = view();
    await findByTestId("ps-credits-n");
    const file = new File(["x"], "slip.jpg", { type: "image/jpeg" });
    fireEvent.change(getByTestId("ps-file"), { target: { files: [file] } });
    await waitFor(() => expect(getByTestId("ps-credits-n").textContent).toBe("4")); // decremented
  });
});
