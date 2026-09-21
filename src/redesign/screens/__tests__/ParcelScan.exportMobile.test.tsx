// 賣貨便 export is LAPTOP-ONLY. On the app shell (Capacitor/?apk) OR a narrow
// mobile-browser viewport the whole Export card is hidden — no toggle, no way in —
// replaced by a "Export from your computer" one-liner. Desktop is unchanged.
// (A phone mis-tap marks rows exported → they vanish from the laptop file.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";

vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: [] as ParcelScanRow[] })),
    checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: vi.fn(async () => ({ ok: true })), resetExtensionChecks: vi.fn(async () => ({ ok: true })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const view = (isAdmin = false) => render(<TProvider><ParcelScan cur="NT$" isAdmin={isAdmin} /></TProvider>);
const win = window as unknown as { Capacitor?: unknown; matchMedia?: unknown };
let hadMM = false; let prevMM: unknown;
const setNarrow = (matches: boolean) => {
  hadMM = "matchMedia" in window; prevMM = win.matchMedia;
  win.matchMedia = (q: string) => ({ matches, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
};

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => {
  try { delete win.Capacitor; } catch { /* ignore */ }
  if (hadMM) win.matchMedia = prevMM; else { try { delete win.matchMedia; } catch { /* ignore */ } }
  hadMM = false;
});

describe("Parcel Scan — export is laptop-only", () => {
  it("desktop (no shell, wide viewport) → Export card shown, no mobile note", async () => {
    setNarrow(false);
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-export-card");
    expect(queryByTestId("ps-export-mobile")).toBeNull();
    expect(queryByTestId("ps-export-btn")).toBeTruthy();
  });

  it("app shell (window.Capacitor) → Export card HIDDEN, 'from your computer' note shown", async () => {
    win.Capacitor = {};
    const { findByTestId, queryByTestId } = view();
    const note = await findByTestId("ps-export-mobile");
    expect(note.textContent).toContain("computer");        // en fallback text
    expect(queryByTestId("ps-export-card")).toBeNull();
    expect(queryByTestId("ps-export-btn")).toBeNull();
  });

  it("narrow mobile-browser viewport → Export card HIDDEN, note shown (no Capacitor)", async () => {
    setNarrow(true);
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-export-mobile");
    expect(queryByTestId("ps-export-card")).toBeNull();
    expect(queryByTestId("ps-export-btn")).toBeNull();
  });

  // Re-enabled on the phone for ADMIN first (owner testing the real download).
  it("app shell + ADMIN → Export card SHOWN on the phone", async () => {
    win.Capacitor = {};
    const { findByTestId, queryByTestId } = view(true);
    await findByTestId("ps-export-card");
    expect(queryByTestId("ps-export-mobile")).toBeNull();
    expect(queryByTestId("ps-export-btn")).toBeTruthy();
  });

  it("narrow viewport + ADMIN → Export card SHOWN on the phone", async () => {
    setNarrow(true);
    const { findByTestId, queryByTestId } = view(true);
    await findByTestId("ps-export-card");
    expect(queryByTestId("ps-export-mobile")).toBeNull();
  });

  it("desktop + ADMIN → Export card SHOWN (web unchanged)", async () => {
    setNarrow(false);
    const { findByTestId, queryByTestId } = view(true);
    await findByTestId("ps-export-card");
    expect(queryByTestId("ps-export-mobile")).toBeNull();
  });
});
