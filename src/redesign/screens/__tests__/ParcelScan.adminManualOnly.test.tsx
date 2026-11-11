// Nov 11 2026 — admins get the SAME manual-only Parcel Scan as paying sellers.
// The REAL gate (parcelScanVisible, PARCEL_SCAN_CAMERA_FOR_ADMIN = false) decides manualOnly, and the
// screen is rendered with exactly what RedesignApp passes. With a working camera on the device:
//   • no <video>, getUserMedia never called (the camera never turns on),
//   • no "Take photo" / "Use photo library instead" / file picker, no AI-scan credits fetch,
//   • the admin screen is the same as the seller screen.
// A control case renders the full surface (manualOnly=false) and DOES call getUserMedia, so the
// assertions above are not vacuous.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";

const { getCreditBalance } = vi.hoisted(() => ({
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 }) as { ok: boolean; balance: number }),
}));

vi.mock("../../adapters/parcelScan", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/parcelScan")>("../../adapters/parcelScan");
  return {
    ...actual, // the REAL parcelScanVisible + PARCEL_SCAN_CAMERA_FOR_ADMIN + pure helpers
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })),
    loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })),
    undoExportBatch: vi.fn(async () => ({ ok: true, result: "undone" })),
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: [] })),
    checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
    scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: vi.fn(async () => ({ ok: true })),
    getCreditBalance,
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";
import { parcelScanVisible, PARCEL_SCAN_CAMERA_FOR_ADMIN } from "../../adapters/parcelScan";

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();
const gate = (role: string, plan: string) =>
  parcelScanVisible({ role, plan, planStatus: "active", planExpiry: FUTURE, manualEnabled: true });

const nav = navigator as unknown as Record<string, unknown>;
let hadMedia = false; let prevMedia: unknown;
let getUserMedia: ReturnType<typeof vi.fn>;
const enableCamera = () => {
  hadMedia = "mediaDevices" in nav; prevMedia = nav.mediaDevices;
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }] }));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
};
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const screen = (manualOnly: boolean) => render(<TProvider lang="en"><ParcelScan cur="NT$" manualOnly={manualOnly} /></TProvider>);

beforeEach(() => { getCreditBalance.mockClear(); enableCamera(); });
afterEach(() => {
  if (hadMedia) Object.defineProperty(navigator, "mediaDevices", { value: prevMedia, configurable: true });
  else { try { delete nav.mediaDevices; } catch { /* ignore */ } }
});

describe("admin Parcel Scan = the seller's manual-only screen", () => {
  it("the gate: admin is manual-only (camera switch off), still can open it, never locked", () => {
    expect(PARCEL_SCAN_CAMERA_FOR_ADMIN).toBe(false);
    expect(gate("admin", "master")).toEqual({ visible: true, manualOnly: true, locked: false });
    expect(gate("seller", "pro")).toEqual({ visible: true, manualOnly: true, locked: false }); // seller unchanged
  });

  it("admin with a working camera: no <video>, getUserMedia never called, no photo buttons, no credits fetch", async () => {
    const { container, findByTestId, queryByTestId } = screen(gate("admin", "master").manualOnly);
    await findByTestId("ps-manual");
    await settle();
    expect(container.querySelector("video")).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    for (const id of ["ps-camera", "ps-video", "ps-shutter", "ps-use-library", "ps-pick", "ps-file", "ps-preview",
      "ps-credits", "ps-scancount", "ps-credits-out"]) expect(queryByTestId(id), id).toBeNull();
    expect(getCreditBalance).not.toHaveBeenCalled();
    expect(queryByTestId("ps-manual")?.textContent).toBe("✏️ Manual add parcel"); // same name as FamilyMart
    expect(queryByTestId("ps-ai-soon")).toBeTruthy();  // same small note sellers see
    expect(queryByTestId("ps-batch")).toBeTruthy();    // the pending-cap pill stays
  });

  it("the admin screen is the same as the seller screen", async () => {
    const a = screen(gate("admin", "master").manualOnly);
    await a.findByTestId("ps-manual"); await settle();
    const adminHtml = a.container.innerHTML; a.unmount();
    const s = screen(gate("seller", "pro").manualOnly);
    await s.findByTestId("ps-manual"); await settle();
    expect(s.container.innerHTML).toBe(adminHtml);
  });

  it("control: the full surface (manualOnly=false, kept for later) DOES start the camera and fetch credits", async () => {
    const { container } = screen(false);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(getCreditBalance).toHaveBeenCalled());
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("RedesignApp passes the gate's manualOnly straight to ParcelScan (no other admin override)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toMatch(/manualOnly: parcelManualOnly[^}]*\} = parcelScanVisible\(/);
    const uses = [...src.matchAll(/<ParcelScan\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toContain("manualOnly={parcelManualOnly}");
  });
});

describe("the button name: \"✏️ Manual add parcel\" on 7-11 and FamilyMart, in every language", () => {
  it("both keys carry the same text in all app languages — filled, no parentheses, the old wording gone", async () => {
    const { buildT, REDESIGN_STRINGS } = await import("../../i18n");
    const langs = Object.keys(REDESIGN_STRINGS);
    expect(langs.sort()).toEqual(["bg", "en", "fil", "id", "th", "vi", "zh", "zh-TW"].sort());
    for (const lang of langs) {
      const t = REDESIGN_STRINGS[lang as keyof typeof REDESIGN_STRINGS];
      expect(t.rd_ps2_manual, lang).toBeTruthy();
      expect(t.rd_fms_add, lang).toBe(t.rd_ps2_manual);
      expect(t.rd_ps2_manual, lang).not.toMatch(/[()（）]/);
    }
    const en = buildT("en") as Record<string, string>;
    expect(en.rd_ps2_manual).toBe("Manual add parcel");
    const src = readFileSync("src/redesign/i18n/index.tsx", "utf8");
    expect(src).not.toContain("Manual encode (no camera)");
  });
  it("same look and place as before: the ✏️ underlined text button above the list on both pages", () => {
    const ps = readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8");
    const fm = readFileSync("src/redesign/screens/FmParcelScan.tsx", "utf8");
    expect(ps).toMatch(/data-testid="ps-manual">✏️ \{t\.rd_ps2_manual\}<\/button>/);
    expect(fm).toMatch(/data-testid="fms-manual">✏️ \{t\.rd_fms_add\}<\/button>/);
  });
});
