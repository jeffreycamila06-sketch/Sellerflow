// Phone Export — WHO can reach it + per-device isolation. Pins the gating as it has stood
// since 5bb8008 (merged bd79245, 2026-09-22), which REMOVED the admin-only gate: phone
// Export is available to EVERY account that can open Parcel Scan (parcelScanVisible =
// admin, or an ACTIVE PLUS/PRO/MASTER seller while parcel_manual_enabled is on), behind the
// per-device "Export on this phone" switch (DEFAULT OFF) + its confirm dialogs. Free/Basic
// never reach it: they get the locked tile and the screen never renders.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
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
import { parcelScanVisible, splitScansForExport, markScansExported } from "../../adapters/parcelScan";

const LS_KEY = "sfl_rd_parcel_export_phone";
const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past = new Date(Date.now() - 864e5).toISOString();
const gate = (plan: string, over: Record<string, unknown> = {}) =>
  parcelScanVisible({ role: "seller", plan, planStatus: "active", planExpiry: future, manualEnabled: true, ...over });

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

describe("WHO reaches phone Export = exactly who can open Parcel Scan (parcelScanVisible)", () => {
  it("active Plus / Pro / Master (flag on) → can open Parcel Scan", () => {
    for (const plan of ["plus", "pro", "master", "PRO"]) expect(gate(plan).visible).toBe(true);
  });
  it("Free / Basic → CANNOT open Parcel Scan (locked tile only) → never see phone Export", () => {
    for (const plan of ["free", "basic", ""]) {
      const g = gate(plan);
      expect(g.visible).toBe(false);
      expect(g.locked).toBe(true);   // upsell tile, never the screen
    }
  });
  it("expired Plus/Pro/Master, or the parcel_manual_enabled kill switch OFF → cannot open it", () => {
    expect(gate("pro", { planExpiry: past }).visible).toBe(false);
    expect(gate("master", { manualEnabled: false }).visible).toBe(false);
  });
  it("admins always can", () => {
    expect(parcelScanVisible({ role: "admin", plan: "free", planStatus: "expired", planExpiry: past, manualEnabled: false }).visible).toBe(true);
  });
  it("RedesignApp renders ParcelScan ONLY when parcelAllowed, and passes NO admin flag (no admin-only export gate)", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    const line = app.split("\n").find((l) => l.includes("<ParcelScan ")) || "";
    expect(line).toContain('screen === "parcelscan" && parcelAllowed');
    expect(line).not.toMatch(/isAdmin/);
    const scan = readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8");
    expect(scan).toContain("const exportHidden = onMobile && !phoneExport;"); // switch only — no isAdmin term
  });
});

describe("a PAYING NON-ADMIN seller (manualOnly) on a phone gets the switch — default OFF", () => {
  it("app shell + manualOnly → switch shown, OFF, Export card hidden", async () => {
    win.Capacitor = {};
    const r = render(<TProvider><ParcelScan cur="NT$" manualOnly /></TProvider>);
    expect(r.getByTestId("ps-export-switch")).toBeTruthy();
    expect(r.getByTestId("ps-export-switch-toggle").getAttribute("aria-pressed")).toBe("false");
    expect(r.queryByTestId("ps-export-card")).toBeNull();
  });
});

describe("per-DEVICE isolation (2c)", () => {
  // A real Map-backed localStorage per test = ONE device's browser storage (this runner has
  // no native localStorage). A fresh store = a different device.
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(),
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("the switch lives ONLY in this browser's localStorage — no DB/network write", async () => {
    win.Capacitor = {};
    const r = render(<TProvider><ParcelScan cur="NT$" manualOnly /></TProvider>);
    fireEvent.click(r.getByTestId("ps-export-switch-toggle"));
    fireEvent.click(r.getByTestId("ps-confirm-enablephone"));
    expect(localStorage.getItem(LS_KEY)).toBe("1");
    expect(markScansExported).not.toHaveBeenCalled();           // turning it on exports nothing
    expect(r.getByTestId("ps-export-card")).toBeTruthy();
  });
  it("another device (fresh storage) for the SAME account starts OFF", async () => {
    localStorage.setItem(LS_KEY, "1"); localStorage.clear();    // a different device = its own empty storage
    win.Capacitor = {};
    const r = render(<TProvider><ParcelScan cur="NT$" manualOnly /></TProvider>);
    expect(r.getByTestId("ps-export-switch-toggle").getAttribute("aria-pressed")).toBe("false");
    expect(r.queryByTestId("ps-export-card")).toBeNull();
  });
  it("the laptop is UNAFFECTED by the switch: with it ON or OFF, desktop always shows Export and never the switch", async () => {
    setNarrow(false);
    for (const stored of ["1", null]) {
      if (stored) localStorage.setItem(LS_KEY, stored); else localStorage.removeItem(LS_KEY);
      const r = render(<TProvider><ParcelScan cur="NT$" manualOnly /></TProvider>);
      expect(r.getByTestId("ps-export-card")).toBeTruthy();
      expect(r.queryByTestId("ps-export-switch")).toBeNull();
      r.unmount();
    }
  });
});

describe("export consistency — what IS guaranteed (2a, sequential use)", () => {
  const row = (id: string, status: string): ParcelScanRow => ({
    id, customerName: "王小明", phone: "0912345678", storeId: "123456", amount: 300, notes: "@buyer",
    status, storeCheckStatus: "valid", storeFullStatus: null, phoneCheckStatus: null, phoneRestrictedUntil: null,
  } as unknown as ParcelScanRow);
  it("a parcel marked exported (by ANY device) is excluded from the next export built from a fresh load", () => {
    const split = splitScansForExport([row("a", "confirmed"), row("b", "exported")], 38);
    expect(split.ready.map((r) => r.id)).toEqual(["a"]);
  });
});
