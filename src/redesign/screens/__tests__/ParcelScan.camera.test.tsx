// In-app camera UI. Two worlds: (1) getUserMedia UNAVAILABLE (jsdom default) →
// the file-picker fallback (ps-pick/ps-file) renders — the safety net; (2)
// getUserMedia AVAILABLE → the live camera card (video + shutter) renders, and
// "use photo library" flips to the picker. The canvas shutter capture itself is
// DOM/toBlob-bound and covered by the camera adapter's pure helpers, not here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { getCreditBalance } = vi.hoisted(() => ({
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 }) as { ok: boolean; balance: number }),
}));

vi.mock("../../adapters/parcelScan", () => ({
  MAX_PENDING_PARCELS: 30, // batch-cap constant the screen reads on every render (inert here — no test loads >=30 pending)
  fileToScanBase64: vi.fn(async () => ({ base64: "aGk=", mediaType: "image/jpeg" })),
  scanParcel: vi.fn(),
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
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const nav = navigator as unknown as Record<string, unknown>;
let hadMedia = false;
let prevMedia: unknown;

const enableCamera = () => {
  hadMedia = "mediaDevices" in nav; prevMedia = nav.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    configurable: true,
  });
};

beforeEach(() => { hadMedia = false; getCreditBalance.mockResolvedValue({ ok: true, balance: 5 }); });
afterEach(() => {
  if (hadMedia) Object.defineProperty(navigator, "mediaDevices", { value: prevMedia, configurable: true });
  else { try { delete (navigator as Record<string, unknown>).mediaDevices; } catch { /* ignore */ } }
  hadMedia = false;
});

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);

describe("ParcelScan in-app camera", () => {
  it("no getUserMedia (jsdom) → the file-picker fallback renders (safety net)", async () => {
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-pick");                    // fallback button present
    expect(queryByTestId("ps-camera")).toBeNull();    // no camera card
    expect(queryByTestId("ps-file")).toBeTruthy();    // hidden input still there
  });

  it("getUserMedia available → the live camera card renders (video + shutter), no picker", async () => {
    enableCamera();
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-camera");
    expect(queryByTestId("ps-video")).toBeTruthy();
    expect(queryByTestId("ps-shutter")).toBeTruthy();
    expect(queryByTestId("ps-pick")).toBeNull();      // camera replaces the picker
  });

  it("'use photo library' flips to the picker, and back via 'use camera'", async () => {
    enableCamera();
    const { findByTestId, getByTestId, queryByTestId } = view();
    await findByTestId("ps-camera");
    fireEvent.click(getByTestId("ps-use-library"));
    await waitFor(() => expect(getByTestId("ps-pick")).toBeTruthy());
    expect(queryByTestId("ps-camera")).toBeNull();
    fireEvent.click(getByTestId("ps-use-camera"));
    await waitFor(() => expect(getByTestId("ps-camera")).toBeTruthy());
  });

  it("out of credits → camera hidden, blocked card + (disabled) picker button shown", async () => {
    enableCamera();
    getCreditBalance.mockResolvedValue({ ok: true, balance: 0 });
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-credits-out");
    expect(queryByTestId("ps-camera")).toBeNull();     // no camera when blocked
    expect((await findByTestId("ps-pick") as HTMLButtonElement).disabled).toBe(true);
  });
});
