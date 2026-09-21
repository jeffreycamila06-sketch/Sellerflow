// 賣貨便 export on the PHONE is gated behind a per-device switch (DEFAULT OFF). On the
// app shell (Capacitor/?apk) OR a narrow mobile-browser viewport the Export card is
// hidden until the seller turns the switch ON — and turning it ON requires confirming
// a dialog first ("Export from this phone?"). Cancel leaves it OFF. Desktop is
// unchanged (card always shown, no switch). (A phone export marks rows exported →
// they drop from the laptop export, hence off-by-default.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);
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

describe("Parcel Scan — phone export switch (default OFF)", () => {
  it("desktop (no shell, wide viewport) → Export card shown, NO switch (web unchanged)", async () => {
    setNarrow(false);
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-export-card");
    expect(queryByTestId("ps-export-switch")).toBeNull();
    expect(queryByTestId("ps-export-btn")).toBeTruthy();
  });

  it("app shell + default OFF → switch shown, Export card HIDDEN", async () => {
    win.Capacitor = {};
    const { findByTestId, queryByTestId } = view();
    const toggle = await findByTestId("ps-export-switch-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(queryByTestId("ps-export-card")).toBeNull();
    expect(queryByTestId("ps-export-btn")).toBeNull();
  });

  it("narrow mobile viewport + default OFF → switch shown, Export card HIDDEN", async () => {
    setNarrow(true);
    const { findByTestId, queryByTestId } = view();
    await findByTestId("ps-export-switch-toggle");
    expect(queryByTestId("ps-export-card")).toBeNull();
  });

  it("turning ON needs the dialog + Yes → Export card appears", async () => {
    win.Capacitor = {};
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-switch-toggle"));
    // dialog first — NOT on yet
    await findByTestId("ps-enablephone-body");
    expect(queryByTestId("ps-export-card")).toBeNull();
    // Yes → switch ON, Export card shows
    fireEvent.click(getByTestId("ps-confirm-enablephone"));
    await findByTestId("ps-export-card");
    expect((getByTestId("ps-export-switch-toggle")).getAttribute("aria-pressed")).toBe("true");
  });

  it("Cancel in the dialog keeps it OFF (no Export card)", async () => {
    win.Capacitor = {};
    const { findByTestId, getByTestId, queryByTestId } = view();
    fireEvent.click(await findByTestId("ps-export-switch-toggle"));
    await findByTestId("ps-enablephone-body");
    fireEvent.click(getByTestId("ps-confirm-cancel"));
    expect(queryByTestId("ps-export-card")).toBeNull();
    expect(getByTestId("ps-export-switch-toggle").getAttribute("aria-pressed")).toBe("false");
  });
});
