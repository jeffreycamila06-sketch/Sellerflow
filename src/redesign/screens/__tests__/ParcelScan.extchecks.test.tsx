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
  loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), // 2b: no prior batch (inert)
  loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })), // sql/51: no orphans (inert)
  confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })), // sql/51: delivery recorded (inert)
  undoExportBatch: vi.fn(async () => ({ ok: true, result: "undone" })), // 2b undo (inert unless asserted)
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
  checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
  formErrors: () => ({ name: false, phone: false, store: false, amount: false, empty: false }),
  amountWarns: () => false,
  amountTooHigh: () => false,
  MIN_PARCEL_AMOUNT: 20, MAX_PARCEL_TOTAL: 20000, MAX_PENDING_PARCELS: 40,
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
  // live-badge poll helpers (screen calls rowAwaitsVerdict every render)
  rowAwaitsVerdict: (r: ParcelScanRow) => r.status !== "exported" && (r.storeFullStatus == null || r.phoneCheckStatus == null),
  mergeExtensionVerdicts: (prev: ParcelScanRow[]) => prev,
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
const view = () => render(<TProvider lang="en"><ParcelScan cur="NT$" /></TProvider>);
const viewOn = () => render(<TProvider lang="en"><ParcelScan cur="NT$" checkOn /></TProvider>);

beforeEach(() => {
  resetExtensionChecks.mockClear(); resetExtensionChecks.mockResolvedValue({ ok: true });
  updateParcelScan.mockClear(); updateParcelScan.mockResolvedValue({ ok: true });
  loadRows.current = [];
});

describe("Parcel Scan — verdict row highlight (border, FAIL-SAFE, no positive label)", () => {
  const flag = (el: HTMLElement) => el.getAttribute("data-flag");

  it("NULL verdicts → no border, no label, Full/Restricted tabs hidden", async () => {
    loadRows.current = [mk({ storeFullStatus: null, phoneCheckStatus: null })];
    const { findByTestId, queryByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("");     // clean — never flagged when unchecked
    expect(queryByTestId("ps-tab-full")).toBeNull();
    expect(queryByTestId("ps-tab-restricted")).toBeNull();
  });

  it("'unknown' → no border (can't-verify ≠ problem, ≠ clean-label)", async () => {
    loadRows.current = [mk({ storeFullStatus: "unknown", phoneCheckStatus: "unknown" })];
    const { findByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("");
  });

  it("store 'full' → ⚠️ Full badge + ORANGE border + Full tab + recheck button", async () => {
    loadRows.current = [mk({ storeFullStatus: "full" })];
    const { findByTestId, getByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("orange");
    expect(getByTestId("ps-ext-badge-full")).toBeTruthy();    // ⚠️ badge restored
    expect(getByTestId("ps-tab-full").textContent).toContain("1");
    expect(getByTestId("ps-ext-recheck")).toBeTruthy();       // action affordance kept
  });

  it("phone 'restricted' → 🚫 badge (+ until <date>) + RED border + Restricted tab", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "restricted", phoneRestrictedUntil: "2026-12-04" })];
    const { findByTestId, getByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("red");
    expect(getByTestId("ps-tab-restricted").textContent).toContain("1");
    const badge = getByTestId("ps-ext-badge-restricted");     // 🚫 badge restored
    expect(badge.textContent).toMatch(/Dec\s*4|12月|4 thg 12|4 Des|4 ธ/); // with the until-date
  });

  it("restricted with NO until-date → 🚫 badge (no date) + RED border (no crash)", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "restricted", phoneRestrictedUntil: null })];
    const { findByTestId, getByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("red");
    expect(getByTestId("ps-ext-badge-restricted")).toBeTruthy();
  });

  it("wrong store code (storeCheckStatus 'not_found') → RED border + the fix (recheck) affordance", async () => {
    loadRows.current = [mk({ storeCheckStatus: "not_found" })];
    const { findByTestId, getByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("red");
    expect(getByTestId("ps-store-badge")).toBeTruthy(); // wrong-code reason + recheck kept
  });

  it("BOTH full AND restricted → RED wins (more serious block)", async () => {
    loadRows.current = [mk({ storeFullStatus: "full", phoneCheckStatus: "restricted" })];
    const { findByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("red");
  });

  it("'open' + 'ok' → NO border (clean) but ✅ Buyer OK label present", async () => {
    loadRows.current = [mk({ storeFullStatus: "open", phoneCheckStatus: "ok" })];
    const { findByTestId, getByTestId } = view();
    expect(flag(await findByTestId("ps-row"))).toBe("");    // ok stays borderless
    expect(getByTestId("ps-ext-clear")).toBeTruthy();       // ✅ label restored
  });

  // ONE pending line until BOTH halves resolve (unless already red/orange).
  it("phone 'ok' but store still NULL → ONLY ⏳ Checking… (no green ✅, no 'store not checked', no border)", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "ok", storeFullStatus: null })];
    const { findByTestId, queryByTestId, getByTestId } = viewOn();
    expect(flag(await findByTestId("ps-row"))).toBe("");
    expect(queryByTestId("ps-ext-clear")).toBeNull();            // never reads as all-clear
    expect(getByTestId("ps-ext-checking")).toBeTruthy();         // the single pending line
    expect(queryByTestId("ps-ext-pending-store")).toBeNull();    // amber line dropped
    expect(queryByTestId("ps-ext-store-unchecked")).toBeNull();  // note dropped
  });

  it("phone 'ok' + store 'unknown' → still ⏳ Checking… (unknown ≠ resolved; the worker re-queues it)", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "ok", storeFullStatus: "unknown" })];
    const { findByTestId, queryByTestId, getByTestId } = viewOn();
    await findByTestId("ps-row");
    expect(queryByTestId("ps-ext-clear")).toBeNull();
    expect(getByTestId("ps-ext-checking")).toBeTruthy();
  });

  it("Checking… is a single animated line: the i18n ellipsis is stripped and the existing .sfl-anim-ellip loader (3 dots) is appended", async () => {
    loadRows.current = [mk({ phoneCheckStatus: null, storeFullStatus: null })];
    const { findByTestId } = viewOn();
    const el = await findByTestId("ps-ext-checking");
    expect(el.textContent).not.toMatch(/…/);                              // no static ellipsis
    expect(el.querySelectorAll(".sfl-anim-ellip > i").length).toBe(3);    // reused app loader, 3 dots
  });

  it("restricted while store still pending → red immediately, NO Checking… (red wins over pending)", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "restricted", storeFullStatus: null })];
    const { findByTestId, queryByTestId } = viewOn();
    expect(flag(await findByTestId("ps-row"))).toBe("red");
    expect(queryByTestId("ps-ext-checking")).toBeNull();
  });

  it("phone 'ok' + store 'full' → ⚠️ orange surfaces, NO green ✅ (not fully verified)", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "ok", storeFullStatus: "full" })];
    const { findByTestId, queryByTestId, getByTestId } = viewOn();
    expect(flag(await findByTestId("ps-row"))).toBe("orange");
    expect(getByTestId("ps-ext-badge-full")).toBeTruthy();
    expect(queryByTestId("ps-ext-clear")).toBeNull();
  });

  it("phone 'restricted' but store NULL → RED border surfaces (safety-critical half never blocked by the store)", async () => {
    loadRows.current = [mk({ phoneCheckStatus: "restricted", storeFullStatus: null })];
    const { findByTestId, queryByTestId } = viewOn();
    expect(flag(await findByTestId("ps-row"))).toBe("red");
    expect(queryByTestId("ps-ext-checking")).toBeNull();
  });

  it("'Checking…' tracks ONLY the phone half: phone NULL + store 'open' → Checking, no border", async () => {
    loadRows.current = [mk({ phoneCheckStatus: null, storeFullStatus: "open" })];
    const { findByTestId } = viewOn();
    expect(await findByTestId("ps-ext-checking")).toBeTruthy();
    expect(flag(await findByTestId("ps-row"))).toBe("");
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
