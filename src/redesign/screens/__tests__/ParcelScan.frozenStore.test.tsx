// sql/142 FROZEN store check on screen (7-11 Parcel Scan): a 冷凍 row shows, per verdict,
//   no_frozen → red border + the red "can't receive frozen" line (wraps, never cut) + ⟳, and is
//              kept OUT of the export like a full store;
//   null / unknown → amber "Checking frozen…" instead of the green all-clear (never red);
//   ok → the normal green all-clear.
// Dry rows are byte-identical to today whatever frozen_store_status says (the column is never
// read for them). Recheck (⟳) clears the frozen verdict locally and in the adapter call.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { splitScansForExport, mergeExtensionVerdicts, rowAwaitsVerdict, rowCheckUnresolved, verdictPollMs } from "../../adapters/parcelScan";
import { problemOf, problemRows } from "../../adapters/parcelAttention";
import { FROZEN_OFF, TEMP_FROZEN, type FrozenState } from "../../adapters/parcelFrozen";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  state: null as unknown,
  resetExtensionChecks: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  loadParcelScans: vi.fn(async (..._a: unknown[]) => ({ ok: true, rows: [] as unknown[] })),
  loadFrozenState: vi.fn(),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(),
    saveParcelScan: vi.fn(async () => ({ ok: true, id: "new-1" })), updateParcelScan: (...a: unknown[]) => h.updateParcelScan(...a),
    loadParcelScans: (...a: unknown[]) => h.loadParcelScans(...a),
    resetExtensionChecks: (...a: unknown[]) => h.resetExtensionChecks(...a),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(async (ids: string[]) => ({ ok: true, batchId: "b1", claimed: ids })), unmarkScansExported: vi.fn(async () => ({ ok: true })),
    confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()), buildXlsmFromTemplate: vi.fn(async () => new Uint8Array()),
  deliverXlsm: vi.fn(async () => ({ ok: true })), deliverXlsmMobile: vi.fn(async () => ({ ok: true })), exportFilename: () => "x.xlsm",
}));
vi.mock("../../adapters/parcelFrozen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelFrozen")>();
  return { ...actual, loadFrozenState: () => h.loadFrozenState(), saveParcelMode: vi.fn(async () => ({ ok: true })) };
});
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => ({ ok: true, rows: [] }), searchParcelCustomers: async () => ({ ok: true, rows: [] }),
  updateParcelCustomer: vi.fn(), deleteParcelCustomer: vi.fn(),
  countPendingParcels: async () => ({ ok: true, count: 0 }), countParcelCustomers: async () => ({ ok: true, count: 0 }),
}));

import ParcelScan from "../ParcelScan";

const CFG = { fee: 129, minTotal: 150, feeColumnMax: null };
const ACCESS: FrozenState = { status: "ok", blocked: false, allowed: true, mode: "常溫", cfg: CFG };
const mk = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "新蓮盈買家", phone: "0944111222", storeId: "968551", amount: 650, notes: "@buyer",
  status: "confirmed", storeCheckStatus: "valid", storeFullStatus: "open", phoneCheckStatus: "ok", createdAt: new Date().toISOString(), ...over,
});
const frozen = (over: Partial<ParcelScanRow> = {}) => mk({ tempLayer: TEMP_FROZEN, ...over });
const view = (lang = "en", frozenCheckOn = true) => render(<TProvider lang={lang}><ParcelScan cur="NT$" checkOn frozenCheckOn={frozenCheckOn} /></TProvider>);
const rowEl = (r: ReturnType<typeof view>, id: string): HTMLElement => {
  const el = r.container.querySelector(`[data-testid="ps-row"][data-row-id="${id}"]`);
  if (!el) throw new Error(`row ${id} not rendered`); // waitFor retries on a throw, not on null
  return el as HTMLElement;
};

beforeEach(() => {
  h.rows = []; h.state = ACCESS;
  h.loadParcelScans.mockReset(); h.loadParcelScans.mockImplementation(async () => ({ ok: true, rows: h.rows }));
  h.loadFrozenState.mockReset(); h.loadFrozenState.mockImplementation(async () => h.state ?? FROZEN_OFF);
  h.resetExtensionChecks.mockClear(); h.updateParcelScan.mockClear();
});

describe("frozen rows — one state each", () => {
  it("no_frozen → red border, the exact red line (wraps, no ellipsis), ⟳ offered, no all-clear", async () => {
    h.rows = [frozen({ id: "f1", frozenStoreStatus: "no_frozen" })];
    const r = view();
    const row = await waitFor(() => rowEl(r, "f1"));
    expect(row.getAttribute("data-flag")).toBe("red");
    const line = row.querySelector('[data-testid="ps-frozen-no"]') as HTMLElement;
    expect(line.textContent).toBe("❄ This store can't receive frozen. Ask the buyer for another 7-11.");
    expect(line.style.overflowWrap).toBe("anywhere");
    expect(line.style.whiteSpace).toBe("normal");
    expect(line.style.textOverflow).toBe("");
    expect(row.querySelector('[data-testid="ps-ext-clear"]')).toBeNull();
    expect(row.querySelector('[data-testid="ps-frozen-unchecked"]')).toBeNull();
    expect(row.querySelector('[data-testid="ps-ext-recheck"]')).toBeTruthy();
  });
  it("null / unknown → amber 'Checking frozen…' instead of the all-clear; never red", async () => {
    h.rows = [frozen({ id: "f-null" }), frozen({ id: "f-unk", frozenStoreStatus: "unknown" })];
    const r = view();
    for (const id of ["f-null", "f-unk"]) {
      const row = await waitFor(() => rowEl(r, id));
      expect(row.getAttribute("data-flag")).toBe("");
      expect(row.querySelector('[data-testid="ps-frozen-unchecked"]')!.textContent).toBe("❄ Checking frozen…");
      expect(row.querySelector('[data-testid="ps-ext-clear"]')).toBeNull();
      expect(row.querySelector('[data-testid="ps-frozen-no"]')).toBeNull();
      expect(row.querySelector('[data-testid="ps-ext-recheck"]')).toBeNull();
    }
  });
  it("ok → the normal green all-clear, nothing frozen-specific", async () => {
    h.rows = [frozen({ id: "f-ok", frozenStoreStatus: "ok" })];
    const r = view();
    const row = await waitFor(() => rowEl(r, "f-ok"));
    expect(row.getAttribute("data-flag")).toBe("");
    expect(row.querySelector('[data-testid="ps-ext-clear"]')).toBeTruthy();
    expect(row.querySelector('[data-testid="ps-frozen-unchecked"]')).toBeNull();
    expect(row.querySelector('[data-testid="ps-frozen-no"]')).toBeNull();
  });
  it("while the normal halves are still pending, only the normal ⏳ line shows (no double pending line); a full store stays orange", async () => {
    h.rows = [frozen({ id: "f-p", phoneCheckStatus: null }), frozen({ id: "f-full", storeFullStatus: "full" })];
    const r = view();
    const p = await waitFor(() => rowEl(r, "f-p"));
    expect(p.querySelector('[data-testid="ps-ext-checking"]')).toBeTruthy();
    expect(p.querySelector('[data-testid="ps-frozen-unchecked"]')).toBeNull();
    const full = rowEl(r, "f-full");
    expect(full.getAttribute("data-flag")).toBe("orange");
    expect(full.querySelector('[data-testid="ps-frozen-unchecked"]')).toBeNull();
  });
  it("8 languages: the red line and the amber line are filled everywhere; zh-TW and fil are the approved words", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const t = buildT(lang) as unknown as Record<string, string>;
      expect(t.rd_ps2_frozen_no.startsWith("❄ "), lang).toBe(true);
      expect(t.rd_ps2_frozen_unchecked.startsWith("❄ "), lang).toBe(true);
      expect(t.rd_ps2_x_no_frozen.trim().length, lang).toBeGreaterThan(3);
    }
    expect((buildT("zh-TW") as unknown as Record<string, string>).rd_ps2_frozen_no).toBe("❄ 此門市無法收冷凍，請向買家詢問其他 7-11 門市。");
    expect((buildT("fil") as unknown as Record<string, string>).rd_ps2_frozen_unchecked).toBe("❄ Chine-check ang frozen…");
  });
});

describe("dry rows — byte-identical to today", () => {
  it("a dry row renders the same DOM whatever frozen_store_status it carries (the column is never read for it)", async () => {
    h.rows = [mk({ id: "d-none" }), mk({ id: "d-no", frozenStoreStatus: "no_frozen" }), mk({ id: "d-unk", frozenStoreStatus: "unknown" })];
    const r = view();
    const base = await waitFor(() => rowEl(r, "d-none"));
    const norm = (el: HTMLElement, id: string) => el.outerHTML.split(`data-row-id="${id}"`).join('data-row-id="X"');
    expect(norm(rowEl(r, "d-no"), "d-no")).toBe(norm(base, "d-none"));
    expect(norm(rowEl(r, "d-unk"), "d-unk")).toBe(norm(base, "d-none"));
    expect(r.container.querySelector('[data-testid="ps-frozen-no"], [data-testid="ps-frozen-unchecked"]')).toBeNull();
    expect(base.querySelector('[data-testid="ps-ext-clear"]')).toBeTruthy();
  });
});

describe("export", () => {
  it("splitScansForExport: a 冷凍 no_frozen row is excluded with reason 'no_frozen'; unknown / null / ok stay ready; a DRY row with no_frozen is still ready", () => {
    const rows = [
      frozen({ id: "a", frozenStoreStatus: "no_frozen" }), frozen({ id: "b", frozenStoreStatus: "unknown" }), frozen({ id: "c" }), frozen({ id: "d", frozenStoreStatus: "ok" }),
      mk({ id: "e", frozenStoreStatus: "no_frozen" }),
    ];
    const s = splitScansForExport(rows, 38, CFG, true);
    expect(s.attention.map((x) => `${x.row.id}:${x.reason}`)).toEqual(["a:no_frozen"]);
    expect(s.ready.map((x) => x.id)).toEqual(["b", "c", "d", "e"]);
    // 14. the existing reasons come first: wrong code, full, restricted, then no_frozen; and the missing frozen settings
    expect(splitScansForExport([frozen({ id: "w", frozenStoreStatus: "no_frozen", storeCheckStatus: "not_found" })], 38, CFG, true).attention[0].reason).toBe("wrong_store");
    expect(splitScansForExport([frozen({ id: "f", frozenStoreStatus: "no_frozen", storeFullStatus: "full" })], 38, CFG, true).attention[0].reason).toBe("store_full");
    expect(splitScansForExport([frozen({ id: "r", frozenStoreStatus: "no_frozen", phoneCheckStatus: "restricted" })], 38, CFG, true).attention[0].reason).toBe("restricted_number");
    expect(splitScansForExport([frozen({ id: "s", frozenStoreStatus: "no_frozen" })], 38, null, true).attention[0].reason).toBe("frozen_settings");
    // 8. switch off → no_frozen never excludes (today's split, byte-for-byte: the 4th arg defaults to false)
    expect(splitScansForExport([frozen({ id: "a", frozenStoreStatus: "no_frozen" })], 38, CFG).attention).toEqual([]);
    expect(splitScansForExport([frozen({ id: "a", frozenStoreStatus: "no_frozen" })], 38, CFG, false).ready.map((x) => x.id)).toEqual(["a"]);
  });
  it("the export leaves the no_frozen row out and lists it under attention with the seller-level reason", async () => {
    h.rows = [frozen({ id: "f1", frozenStoreStatus: "no_frozen" }), frozen({ id: "f2", frozenStoreStatus: "ok" })];
    const r = view();
    await waitFor(() => rowEl(r, "f1"));
    await waitFor(() => expect((r.getByTestId("ps-export-btn") as HTMLButtonElement).disabled).toBe(false)); // wait for the loaded state (the CI race lesson)
    fireEvent.click(r.getByTestId("ps-export-btn"));
    fireEvent.click(await r.findByTestId("ps-confirm-export"));
    const attn = await r.findAllByTestId("ps-export-attn-row");
    expect(attn).toHaveLength(1);
    expect(attn[0].textContent).toContain("Store can't receive frozen");
    expect(r.getByTestId("ps-export-summary").textContent).toMatch(/1/);
  });
});

describe("Recheck", () => {
  it("⟳ on a no_frozen row → the adapter reset is called and the red line disappears (back to 'Checking frozen…')", async () => {
    h.rows = [frozen({ id: "f1", frozenStoreStatus: "no_frozen" })];
    const r = view();
    const row = await waitFor(() => rowEl(r, "f1"));
    fireEvent.click(row.querySelector('[data-testid="ps-ext-recheck"]')!);
    fireEvent.click(await r.findByTestId("ps-confirm-recheck"));
    await waitFor(() => expect(h.resetExtensionChecks).toHaveBeenCalledWith("f1", true));
    await waitFor(() => expect(rowEl(r, "f1").querySelector('[data-testid="ps-frozen-no"]')).toBeNull());
    expect(rowEl(r, "f1").getAttribute("data-flag")).toBe("");
  });
});

describe("8. switch OFF → a 冷凍 row looks exactly like main", () => {
  it("no red / amber line, the green all-clear, no ⟳, no export exclusion, the top bar says All OK", async () => {
    h.rows = [frozen({ id: "f-no", frozenStoreStatus: "no_frozen" }), frozen({ id: "f-unk", frozenStoreStatus: "unknown" }), frozen({ id: "f-null" })];
    const r = view("en", false);
    for (const id of ["f-no", "f-unk", "f-null"]) {
      const row = await waitFor(() => rowEl(r, id));
      expect(row.getAttribute("data-flag"), id).toBe("");
      expect(row.querySelector('[data-testid="ps-frozen-no"], [data-testid="ps-frozen-unchecked"], [data-testid="ps-ext-recheck"]'), id).toBeNull();
      expect(row.querySelector('[data-testid="ps-ext-clear"]'), id).toBeTruthy();
    }
    expect(r.getByTestId("ps-attn").getAttribute("data-state")).toBe("ok");
    // identical DOM to a dry row with the same checks (the ❄ 冷凍 chip aside)
    const base = rowEl(r, "f-no").outerHTML.replace(/<span[^>]*data-testid="ps-frozen-badge"[^>]*>[^<]*<\/span>/, "").replace('data-row-id="f-no"', 'data-row-id="X"');
    h.rows = [mk({ id: "d-no", frozenStoreStatus: "no_frozen" })];
    const r2 = view("en", false);
    const dry = (await waitFor(() => rowEl(r2, "d-no"))).outerHTML.replace('data-row-id="d-no"', 'data-row-id="X"');
    expect(base).toBe(dry);
  });
});

describe("9. exported 冷凍 rows keep ✅", () => {
  it("an exported row with no_frozen / null is neither red nor amber and shows the all-clear", async () => {
    h.rows = [frozen({ id: "x-no", status: "exported", frozenStoreStatus: "no_frozen" }), frozen({ id: "x-null", status: "exported" })];
    const r = view();
    for (const id of ["x-no", "x-null"]) {
      const row = await waitFor(() => rowEl(r, id));
      expect(row.getAttribute("data-flag"), id).toBe("");
      expect(row.querySelector('[data-testid="ps-frozen-no"], [data-testid="ps-frozen-unchecked"]'), id).toBeNull();
      expect(row.querySelector('[data-testid="ps-ext-clear"]'), id).toBeTruthy();
    }
  });
});

describe("10. editing the store code of a red no_frozen row", () => {
  it("clears the frozen verdict on screen AND sends frozen: true in the update (冷凍 row); a dry row's update carries no frozen key", async () => {
    h.rows = [frozen({ id: "f1", frozenStoreStatus: "no_frozen" }), mk({ id: "d1", storeId: "133712" })];
    const r = view();
    const row = await waitFor(() => rowEl(r, "f1"));
    fireEvent.click(row.querySelector('[data-testid="ps-row-edit"]')!);
    fireEvent.change(await r.findByTestId("ps-store"), { target: { value: "151003" } });
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(h.updateParcelScan).toHaveBeenCalledTimes(1));
    expect(h.updateParcelScan.mock.calls[0][2]).toEqual({ storeFull: true, phoneCheck: false, frozen: true });
    await waitFor(() => expect(rowEl(r, "f1").getAttribute("data-flag")).toBe(""));
    expect(rowEl(r, "f1").querySelector('[data-testid="ps-frozen-no"]')).toBeNull();
    // the dry row
    fireEvent.click(rowEl(r, "d1").querySelector('[data-testid="ps-row-edit"]')!);
    fireEvent.change(await r.findByTestId("ps-store"), { target: { value: "266402" } });
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(h.updateParcelScan).toHaveBeenCalledTimes(2));
    expect(h.updateParcelScan.mock.calls[1][2]).toEqual({ storeFull: true, phoneCheck: false }); // 13. byte-identical dry payload
  });
});

describe("11. verdict merge + awaiting", () => {
  it("mergeExtensionVerdicts carries the frozen verdict (a no_frozen shows without reopening); rowAwaitsVerdict counts a null/unknown 冷凍 row only while the switch is on", () => {
    const prev = [frozen({ id: "f1" }), frozen({ id: "f2", frozenStoreStatus: "ok" }), mk({ id: "d1" })];
    const fresh = [frozen({ id: "f1", frozenStoreStatus: "no_frozen" }), frozen({ id: "f2", frozenStoreStatus: "ok" }), mk({ id: "d1" })];
    const out = mergeExtensionVerdicts(prev, fresh);
    expect(out[0].frozenStoreStatus).toBe("no_frozen");
    expect(out[1]).toBe(prev[1]); // untouched by reference
    expect(out[2]).toBe(prev[2]);
    expect(rowAwaitsVerdict(frozen({ id: "a" }), true)).toBe(true);
    expect(rowAwaitsVerdict(frozen({ id: "a", frozenStoreStatus: "unknown" }), true)).toBe(true);
    expect(rowAwaitsVerdict(frozen({ id: "a", frozenStoreStatus: "ok" }), true)).toBe(false);
    expect(rowAwaitsVerdict(frozen({ id: "a", frozenStoreStatus: "no_frozen" }), true)).toBe(false);
    expect(rowAwaitsVerdict(frozen({ id: "a" }), false)).toBe(false);   // switch off = today's rule
    expect(rowAwaitsVerdict(frozen({ id: "a" }))).toBe(false);
    expect(rowAwaitsVerdict(mk({ id: "d" }), true)).toBe(false);          // dry row: the frozen column is never read
    expect(rowCheckUnresolved(frozen({ id: "a", frozenStoreStatus: "unknown" }), true)).toBe(true);
    const now = Date.now();
    expect(verdictPollMs([frozen({ id: "a", createdAt: new Date(now).toISOString() })], now, 180_000, true)).toBe(3000);
    expect(verdictPollMs([frozen({ id: "a", createdAt: new Date(now).toISOString() })], now, 180_000, false)).toBeNull();
  });
});

describe("12. attention bar", () => {
  it("problemOf: no_frozen is a problem kind for 冷凍 rows while the switch is on, after the existing kinds; the bar shows the problem and the alert names it", async () => {
    expect(problemOf(frozen({ id: "a", frozenStoreStatus: "no_frozen" }), true)).toBe("no_frozen");
    expect(problemOf(frozen({ id: "a", frozenStoreStatus: "no_frozen" }))).toBeNull();
    expect(problemOf(mk({ id: "d", frozenStoreStatus: "no_frozen" }), true)).toBeNull();
    expect(problemOf(frozen({ id: "a", frozenStoreStatus: "no_frozen", phoneCheckStatus: "restricted" }), true)).toBe("restricted");
    expect(problemRows([frozen({ id: "a", frozenStoreStatus: "no_frozen" }), frozen({ id: "b" })], true).map((r) => r.id)).toEqual(["a"]);
    h.rows = [frozen({ id: "f1", frozenStoreStatus: "no_frozen" })];
    const r = view();
    await waitFor(() => rowEl(r, "f1"));
    expect(r.getByTestId("ps-attn").getAttribute("data-state")).toBe("problem");
    expect(r.getByTestId("ps-attn").textContent).toMatch(/1/);
  });
  it("a no_frozen verdict arriving while the screen is open fires the new-problem alert with the frozen reason", async () => {
    const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
    try {
      h.rows = [frozen({ id: "f1", createdAt: new Date().toISOString() })];
      const r = view();
      await flush(); await flush();
      expect(rowEl(r, "f1")).toBeTruthy();
      expect(r.getByTestId("ps-attn").getAttribute("data-state")).toBe("ok");
      h.rows = [frozen({ id: "f1", frozenStoreStatus: "no_frozen", createdAt: new Date().toISOString() })]; // the next 3 s re-read brings the verdict
      await act(async () => { vi.advanceTimersByTime(3100); });
      await flush();
      expect(r.getByTestId("ps-attn").getAttribute("data-state")).toBe("problem");
      expect(r.getByTestId("ps-attn-toast").textContent).toContain("Store can't receive frozen");
      expect(rowEl(r, "f1").getAttribute("data-flag")).toBe("red");
    } finally { vi.useRealTimers(); }
  });
});

describe("13. Recheck payload", () => {
  it("⟳ passes frozenRow=true for a 冷凍 row and false for a dry row (dry payload byte-identical)", async () => {
    h.rows = [frozen({ id: "f1", frozenStoreStatus: "no_frozen" }), mk({ id: "d1", storeFullStatus: "full" })];
    const r = view();
    const row = await waitFor(() => rowEl(r, "f1"));
    fireEvent.click(row.querySelector('[data-testid="ps-ext-recheck"]')!);
    fireEvent.click(await r.findByTestId("ps-confirm-recheck"));
    await waitFor(() => expect(h.resetExtensionChecks).toHaveBeenCalledWith("f1", true));
    await waitFor(() => expect(r.queryByTestId("ps-confirm-recheck")).toBeNull());
    fireEvent.click(rowEl(r, "d1").querySelector('[data-testid="ps-ext-recheck"]')!);
    fireEvent.click(await r.findByTestId("ps-confirm-recheck"));
    await waitFor(() => expect(h.resetExtensionChecks).toHaveBeenCalledWith("d1")); // one argument = today's exact call
    expect(h.resetExtensionChecks.mock.calls[1]).toEqual(["d1"]);
  });
});
