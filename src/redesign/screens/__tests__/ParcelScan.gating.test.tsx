// manualOnly gating (2026-09-10) — a PAYING seller sees ONLY manual encode; the
// camera / AI-scan / credits surface is admin-only. A seller must never reach the
// file picker either (it routes to scanParcel → the credit path). The "AI photo
// scanning — coming soon" line shows for the seller and NOT for the admin.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { getCreditBalance } = vi.hoisted(() => ({
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 }) as { ok: boolean; balance: number }),
}));

vi.mock("../../adapters/parcelScan", () => ({
  MAX_PENDING_PARCELS: 30, // batch-cap constant the screen reads on every render (inert here — no test loads >=30 pending)
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: [] })),
  checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  splitScansForExport: () => ({ ready: [], attention: [] }),
  scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
  deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance,
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const nav = navigator as unknown as Record<string, unknown>;
let hadMedia = false; let prevMedia: unknown;
const enableCamera = () => {
  hadMedia = "mediaDevices" in nav; prevMedia = nav.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }] })) },
    configurable: true,
  });
};

beforeEach(() => { hadMedia = false; getCreditBalance.mockClear(); });
afterEach(() => {
  if (hadMedia) Object.defineProperty(navigator, "mediaDevices", { value: prevMedia, configurable: true });
  else { try { delete (navigator as Record<string, unknown>).mediaDevices; } catch { /* ignore */ } }
  hadMedia = false;
});

describe("ParcelScan — paying seller (manualOnly)", () => {
  const seller = () => render(<TProvider><ParcelScan cur="NT$" manualOnly /></TProvider>);

  it("shows manual encode + the 'AI coming soon' line", async () => {
    const { findByTestId, getByTestId } = seller();
    await findByTestId("ps-manual");
    expect(getByTestId("ps-ai-soon")).toBeTruthy();
  });

  it("hides the camera, file picker, and all credit/scan UI", async () => {
    const { findByTestId, queryByTestId } = seller();
    await findByTestId("ps-manual");
    expect(queryByTestId("ps-camera")).toBeNull();
    expect(queryByTestId("ps-shutter")).toBeNull();
    expect(queryByTestId("ps-use-library")).toBeNull();
    expect(queryByTestId("ps-preview")).toBeNull();
    expect(queryByTestId("ps-file")).toBeNull();   // MUST NOT reach the scan/credit path
    expect(queryByTestId("ps-pick")).toBeNull();
    // The credit/scan pills stay hidden for a seller, but the BATCH pill is
    // shown to everyone (the seller must see the 30-pending cap) — so the
    // stats row exists, carrying only the batch pill.
    expect(queryByTestId("ps-credits")).toBeNull();
    expect(queryByTestId("ps-scancount")).toBeNull();
    expect(queryByTestId("ps-credits-out")).toBeNull();
    expect(queryByTestId("ps-batch")).toBeTruthy();
  });

  it("even with a working camera present, a seller never sees it (manualOnly wins)", async () => {
    enableCamera();
    const { findByTestId, queryByTestId } = seller();
    await findByTestId("ps-manual");
    expect(queryByTestId("ps-camera")).toBeNull();
    expect(queryByTestId("ps-file")).toBeNull();
  });

  it("never fetches the credit balance on mount", async () => {
    const { findByTestId } = seller();
    await findByTestId("ps-manual");
    await new Promise((r) => setTimeout(r, 0));
    expect(getCreditBalance).not.toHaveBeenCalled();
  });

  it("keeps manual encode functional (export card + tabs still present)", async () => {
    const { findByTestId, getByTestId } = seller();
    await findByTestId("ps-manual");
    expect(getByTestId("ps-export-card")).toBeTruthy();
    expect(getByTestId("ps-tabs")).toBeTruthy();
  });
});

describe("ParcelScan — admin (full scan surface)", () => {
  const admin = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>); // manualOnly defaults false

  it("with a camera available, shows the camera card and NO 'coming soon' line", async () => {
    enableCamera();
    const { findByTestId, queryByTestId } = admin();
    await findByTestId("ps-camera");
    expect(queryByTestId("ps-ai-soon")).toBeNull();
  });

  it("fetches the credit balance on mount (admin sees credits)", async () => {
    const { findByTestId } = admin();
    await findByTestId("ps-manual");
    await waitFor(() => expect(getCreditBalance).toHaveBeenCalled());
  });
});
