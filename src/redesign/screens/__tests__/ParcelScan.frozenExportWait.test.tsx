// Frozen (冷凍) parcel at EXPORT (sql/157, Nov 13 2026) — the two real cases and the rules around them:
//   A) a fresh 冷凍 parcel whose frozen answer is still on its way HOLDS the export ("Checking if this
//      store accepts frozen…"); the export goes on BY ITSELF when the answer lands; "can't receive
//      frozen" → the usual warning, nothing exported; no answer in 30 s → Wait / Export anyway with
//      the visible "Frozen not checked" note (never a block);
//   B) the answer that arrives AFTER the export is shown on the exported parcel (red warning, top
//      bar, alert);
//   C) a dry parcel, a 冷凍 parcel with an answer, the switch off: no hold, no delay.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider, buildT } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { verdictPollMs, rowAwaitsVerdict, splitScansForExport, VERDICT_POLL_FAST_MS, VERDICT_POLL_SLOW_MS } from "../../adapters/parcelScan";
import {
  frozenHoldRows, frozenHoldState, frozenUnchecked, exportedFrozenRefused, exportedFrozenUnchecked, lateFrozenWatch,
  _clearFrozenEdits, FROZEN_HOLD_MS, FROZEN_HOLD_FRESH_MS, FROZEN_LATE_WATCH_MS, FROZEN_NOTE_MAX_AGE_MS,
} from "../../adapters/parcelFrozenExport";
import { FROZEN_OFF, TEMP_FROZEN, type FrozenState } from "../../adapters/parcelFrozen";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  state: null as unknown,
  resetExtensionChecks: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  loadParcelScans: vi.fn(async (..._a: unknown[]) => ({ ok: true, rows: [] as unknown[] })),
  loadFrozenState: vi.fn(),
  markScansExported: vi.fn(async (...a: unknown[]) => ({ ok: true, batchId: "b1", claimed: a[0] as string[] })),
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
    markScansExported: (...a: unknown[]) => h.markScansExported(...a), unmarkScansExported: vi.fn(async () => ({ ok: true })),
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
beforeEach(() => {
  h.rows = []; h.state = ACCESS;
  h.loadParcelScans.mockReset(); h.loadParcelScans.mockImplementation(async () => ({ ok: true, rows: h.rows }));
  h.loadFrozenState.mockReset(); h.loadFrozenState.mockImplementation(async () => h.state ?? FROZEN_OFF);
  h.resetExtensionChecks.mockClear(); h.updateParcelScan.mockClear(); h.markScansExported.mockClear();
  _clearFrozenEdits();
});


// A daytime instant in Taipei (14:00) — the checker's 01:00–05:00 rest never interferes unless a test asks.
const DAY = Date.parse("2026-11-13T06:00:00Z");
const at = (ms: number) => new Date(ms).toISOString();
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
// The clock moves in half-second steps, each in its own act(): the screen re-renders between a
// read (every 3 s) and the hold's next look (every 0.5 s), as it does in a real browser.
const advance = async (ms: number) => {
  for (let left = ms; left > 0; left -= 500) { await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(500, left)); }); await flush(); }
};
const q = (r: ReturnType<typeof render>, id: string) => document.querySelector(`[data-testid="${id}"]`) ?? r.container.querySelector(`[data-testid="${id}"]`);
const open = async (frozenCheckOn = true, checkOn = true) => {
  const r = render(<TProvider lang="en"><ParcelScan cur="NT$" checkOn={checkOn} frozenCheckOn={frozenCheckOn} /></TProvider>);
  await flush(); await flush();
  return r;
};
const tapExport = (r: ReturnType<typeof render>) => {
  const b = r.getByTestId("ps-export-btn") as HTMLButtonElement;
  expect(b.disabled).toBe(false);
  fireEvent.click(b);
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "clearInterval", "clearTimeout", "Date"] }); vi.setSystemTime(DAY); });
afterEach(() => { vi.useRealTimers(); });

describe("the two real timelines of Nov 13 2026", () => {
  it("store 980045 — export tapped 20 s after saving, the answer 'ok' lands a moment later: the export WAITS, then goes on by itself", async () => {
    h.rows = [frozen({ id: "p1", storeId: "980045", createdAt: at(DAY) })];
    const r = await open();
    await advance(20_000);                                   // dry checks are in; the frozen answer is not
    tapExport(r);
    expect(q(r, "ps-frozen-wait")?.textContent).toContain("Checking if this store accepts frozen");
    expect(q(r, "ps-frozen-wait-sub")?.textContent).toBe("Usually under 15 seconds. The export continues by itself.");
    expect(q(r, "ps-confirm-export")).toBeNull();            // no export step yet
    expect(q(r, "ps-frozen-export-anyway")).toBeNull();      // and no way around the wait
    expect(q(r, "ps-confirm-export-anyway")).toBeNull();
    expect(h.markScansExported).not.toHaveBeenCalled();      // nothing is marked exported while waiting
    h.rows = [frozen({ id: "p1", storeId: "980045", createdAt: at(DAY), frozenStoreStatus: "ok" })]; // the checker answers
    await advance(4_000);                                    // the next 3 s read + the half-second look
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-confirm-export")).toBeTruthy();          // went on BY ITSELF to the normal export step
    expect(q(r, "ps-frozen-ask")).toBeNull();
    fireEvent.click(q(r, "ps-confirm-export") as HTMLElement);
    await flush(); await flush();
    expect(h.markScansExported).toHaveBeenCalledTimes(1);
    expect(h.markScansExported.mock.calls[0][0]).toEqual(["p1"]);
  });

  it("store 217237 — the answer 'no_frozen' lands 8 s after the tap: NOTHING is exported, the usual warning is shown", async () => {
    h.rows = [frozen({ id: "p2", storeId: "217237", createdAt: at(DAY) })];
    const r = await open();
    await advance(20_000);
    tapExport(r);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();
    await advance(6_000);                                    // still waiting, still nothing exported
    expect(q(r, "ps-frozen-wait")).toBeTruthy();
    expect(h.markScansExported).not.toHaveBeenCalled();
    h.rows = [frozen({ id: "p2", storeId: "217237", createdAt: at(DAY), frozenStoreStatus: "no_frozen" })];
    await advance(4_000);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-frozen-no-q")?.textContent).toBe("❄ 1 parcel(s) not exported: the store can't receive frozen. Ask the buyer for another 7-11.");
    expect(q(r, "ps-confirm-export")).toBeNull();
    expect(q(r, "ps-frozen-export-rest")).toBeNull();        // it was the only parcel
    expect(q(r, "ps-confirm-cancel")?.textContent).toBe("OK");
    const row = r.container.querySelector('[data-row-id="p2"]') as HTMLElement;
    expect(row.getAttribute("data-flag")).toBe("red");       // the usual red line on the parcel
    expect(row.querySelector('[data-testid="ps-frozen-no"]')).toBeTruthy();
    fireEvent.click(q(r, "ps-confirm-cancel") as HTMLElement);
    await advance(10_000);
    expect(h.markScansExported).not.toHaveBeenCalled();      // never exported
  });
});

describe("A) the hold", () => {
  it("no answer within 30 s → the frozen question (Wait / Export anyway); before that there is no way to skip", async () => {
    h.rows = [frozen({ id: "p1", createdAt: at(DAY) })];
    const r = await open();
    tapExport(r);
    await advance(FROZEN_HOLD_MS - 1_000);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();
    expect(q(r, "ps-frozen-export-anyway")).toBeNull();
    await advance(1_600);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-frozen-ask")?.textContent).toContain("no answer yet on whether the store accepts frozen");
    expect(q(r, "ps-frozen-ask")?.textContent).toContain("“Frozen not checked”");
    expect(q(r, "ps-confirm-cancel")?.textContent).toBe("Wait");
    expect(h.markScansExported).not.toHaveBeenCalled();
    fireEvent.click(q(r, "ps-frozen-export-anyway") as HTMLElement);   // the seller decides: never blocked forever
    await flush();
    fireEvent.click(q(r, "ps-confirm-export") as HTMLElement);
    await flush(); await flush();
    expect(h.markScansExported).toHaveBeenCalledTimes(1);
    const row = r.container.querySelector('[data-row-id="p1"]') as HTMLElement;
    expect(row.querySelector('[data-testid="ps-exported-tag"]')).toBeTruthy();
    expect(row.querySelector('[data-testid="ps-frozen-not-checked"]')?.textContent).toBe("❄ Frozen not checked"); // the visible note
    expect(row.querySelector('[data-testid="ps-ext-clear"]')).toBeNull();                                          // never the all-clear
  });
  it("'Wait' on the frozen question closes it and exports nothing; the hold can be started again", async () => {
    h.rows = [frozen({ id: "p1", createdAt: at(DAY) })];
    const r = await open();
    tapExport(r);
    await advance(FROZEN_HOLD_MS + 600);
    fireEvent.click(q(r, "ps-confirm-cancel") as HTMLElement);
    expect(q(r, "ps-frozen-ask")).toBeNull();
    expect(h.markScansExported).not.toHaveBeenCalled();
    tapExport(r);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();
  });
  it("Cancel during the hold closes it; a later answer opens nothing and exports nothing", async () => {
    h.rows = [frozen({ id: "p1", createdAt: at(DAY) })];
    const r = await open();
    tapExport(r);
    fireEvent.click(q(r, "ps-confirm-cancel") as HTMLElement);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    h.rows = [frozen({ id: "p1", createdAt: at(DAY), frozenStoreStatus: "ok" })];
    await advance(8_000);
    expect(q(r, "ps-confirm-export")).toBeNull();
    expect(h.markScansExported).not.toHaveBeenCalled();
  });
  it("two frozen parcels: waits for BOTH; one refused + one ok → the warning offers to export the other one only", async () => {
    h.rows = [frozen({ id: "a", storeId: "111111", createdAt: at(DAY) }), frozen({ id: "b", storeId: "222222", createdAt: at(DAY) })];
    const r = await open();
    tapExport(r);
    expect(q(r, "ps-frozen-wait")?.textContent).toContain("(2 parcels)");
    h.rows = [frozen({ id: "a", storeId: "111111", createdAt: at(DAY), frozenStoreStatus: "ok" }), frozen({ id: "b", storeId: "222222", createdAt: at(DAY) })];
    await advance(4_000);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();             // one answer is not enough
    h.rows = [frozen({ id: "a", storeId: "111111", createdAt: at(DAY), frozenStoreStatus: "ok" }), frozen({ id: "b", storeId: "222222", createdAt: at(DAY), frozenStoreStatus: "no_frozen" })];
    await advance(4_000);
    expect(q(r, "ps-frozen-no-q")?.textContent).toContain("1 parcel(s) not exported");
    expect(q(r, "ps-frozen-export-rest")?.textContent).toBe("Export the other 1");
    fireEvent.click(q(r, "ps-frozen-export-rest") as HTMLElement);
    await flush();
    fireEvent.click(q(r, "ps-confirm-export") as HTMLElement);
    await flush(); await flush();
    expect(h.markScansExported.mock.calls[0][0]).toEqual(["a"]); // the refused parcel is not in the export
  });
  it("the checker answers 'unknown' (gave up) during the hold → the frozen question at once, not a silent export", async () => {
    h.rows = [frozen({ id: "p1", createdAt: at(DAY) })];
    const r = await open();
    tapExport(r);
    h.rows = [frozen({ id: "p1", createdAt: at(DAY), frozenStoreStatus: "unknown" })];
    await advance(4_000);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-frozen-ask")).toBeTruthy();
    expect(q(r, "ps-confirm-export")).toBeNull();
  });
  it("after 30 s the question counts EVERY frozen parcel that would leave unchecked, not only the held ones", async () => {
    h.rows = [
      frozen({ id: "fresh", storeId: "111111", createdAt: at(DAY) }),                                   // held
      frozen({ id: "old", storeId: "222222", createdAt: at(DAY - FROZEN_HOLD_FRESH_MS - 60_000) }),      // too old to hold, still unchecked
      frozen({ id: "unk", storeId: "333333", createdAt: at(DAY), frozenStoreStatus: "unknown" }),        // the checker gave up
      frozen({ id: "fine", storeId: "444444", createdAt: at(DAY), frozenStoreStatus: "ok" }),            // answered: not counted
      mk({ id: "dry", storeId: "555555", createdAt: at(DAY) }),                                          // dry: not counted
    ];
    const r = await open();
    tapExport(r);
    expect(q(r, "ps-frozen-wait")?.textContent).toContain("Checking if this store accepts frozen");
    await advance(FROZEN_HOLD_MS + 600);
    expect(q(r, "ps-frozen-ask")?.textContent).toContain("❄ 3 frozen parcel(s)");                     // fresh + old + unknown
  });
  it("a frozen parcel saved long ago but whose STORE # was just edited waits for its new answer (counted from the edit)", async () => {
    const old = at(DAY - 30 * 60_000);
    h.rows = [frozen({ id: "e1", storeId: "968551", createdAt: old, frozenStoreStatus: "ok" })];
    const r = await open();
    fireEvent.click((r.container.querySelector('[data-row-id="e1"]') as HTMLElement).querySelector('[data-testid="ps-row-edit"]')!);
    fireEvent.change(r.getByTestId("ps-store"), { target: { value: "151003" } });
    fireEvent.click(r.getByTestId("ps-save"));
    await flush(); await flush();
    expect(h.updateParcelScan.mock.calls[0][2]).toEqual({ storeFull: true, phoneCheck: false, frozen: true });
    h.rows = [frozen({ id: "e1", storeId: "151003", createdAt: old })];                                  // the DB row: verdict reset by the edit
    await advance(1_000);
    tapExport(r);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();                                                        // waits (before: the question at once)
    expect(q(r, "ps-frozen-ask")).toBeNull();
    h.rows = [frozen({ id: "e1", storeId: "151003", createdAt: old, frozenStoreStatus: "no_frozen" })];
    await advance(4_000);                                                                               // read every 3 s: the edit counts as fresh
    expect(q(r, "ps-frozen-no-q")).toBeTruthy();
    expect(h.markScansExported).not.toHaveBeenCalled();
  });
  it("a dry parcel saved long ago and just switched to Frozen also waits; 2 min after the edit it no longer does", async () => {
    const old = at(DAY - 30 * 60_000);
    h.rows = [mk({ id: "e2", createdAt: old })];
    const r = await open();
    fireEvent.click((r.container.querySelector('[data-row-id="e2"]') as HTMLElement).querySelector('[data-testid="ps-row-edit"]')!);
    fireEvent.click(r.getByTestId("ps-edit-layer-frozen"));
    fireEvent.click(r.getByTestId("ps-save"));
    await flush(); await flush();
    h.rows = [frozen({ id: "e2", createdAt: old })];
    await advance(1_000);
    tapExport(r);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();
    fireEvent.click(q(r, "ps-confirm-cancel") as HTMLElement);
    await advance(FROZEN_HOLD_FRESH_MS);
    tapExport(r);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-frozen-ask")).toBeTruthy();
  });
  it("an edit that does not touch the store # or the layer (name only) does NOT restart the wait", async () => {
    const old = at(DAY - 30 * 60_000);
    h.rows = [frozen({ id: "e3", createdAt: old })];
    const r = await open();
    fireEvent.click((r.container.querySelector('[data-row-id="e3"]') as HTMLElement).querySelector('[data-testid="ps-row-edit"]')!);
    fireEvent.change(r.getByTestId("ps-name"), { target: { value: "王小美" } });
    fireEvent.click(r.getByTestId("ps-save"));
    await flush(); await flush();
    expect(h.updateParcelScan).toHaveBeenCalledTimes(1);
    expect(h.updateParcelScan.mock.calls[0][2]).toEqual({ storeFull: false, phoneCheck: false });          // no frozen reset
    tapExport(r);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-frozen-ask")).toBeTruthy();
  });
  it("nothing to wait for → no 30 s hold, the frozen question at once: an old parcel, an 'unknown' one", async () => {
    for (const [name, rows, now] of [
      ["older than 2 min", [frozen({ id: "p1", createdAt: at(DAY - FROZEN_HOLD_FRESH_MS - 1000) })], DAY],
      ["unknown", [frozen({ id: "p1", createdAt: at(DAY), frozenStoreStatus: "unknown" })], DAY],
    ] as const) {
      vi.setSystemTime(now);
      h.rows = rows as unknown as ParcelScanRow[];
      const r = await open();
      tapExport(r);
      expect(q(r, "ps-frozen-wait"), name).toBeNull();
      expect(q(r, "ps-frozen-ask"), name).toBeTruthy();
      expect(q(r, "ps-pending-msg"), name).toBeNull();        // the frozen wording, not the general one
      r.unmount();
    }
  });
});

describe("A2) at night (01:00–05:00 Taipei) — extension 1.18.2 answers at night too", () => {
  const NIGHT = Date.parse("2026-11-13T18:00:00Z");                       // 02:00 Taipei
  it("a fresh frozen parcel at 02:00 HOLDS the export like by day, and goes on by itself when the answer lands", async () => {
    vi.setSystemTime(NIGHT);
    h.rows = [frozen({ id: "n1", createdAt: at(NIGHT) })];
    const r = await open();
    tapExport(r);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();                           // waits (before: the question at once)
    expect(q(r, "ps-frozen-ask")).toBeNull();
    h.rows = [frozen({ id: "n1", createdAt: at(NIGHT), frozenStoreStatus: "ok" })];
    await advance(4_000);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-confirm-export")).toBeTruthy();
  });
  it("no answer at 02:00 → the same 30 s wait, then Wait / Export anyway (never a block)", async () => {
    vi.setSystemTime(NIGHT);
    h.rows = [frozen({ id: "n1", createdAt: at(NIGHT) })];
    const r = await open();
    tapExport(r);
    await advance(FROZEN_HOLD_MS - 1_000);
    expect(q(r, "ps-frozen-wait")).toBeTruthy();
    await advance(1_600);
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-frozen-ask")).toBeTruthy();
  });
  it("at night with the frozen switch off, or parcel checks off → no wait at all (unchanged)", async () => {
    vi.setSystemTime(NIGHT);
    for (const [fz, chk] of [[false, true], [true, false]] as const) {
      h.rows = [frozen({ id: "n1", createdAt: at(NIGHT) })];
      const r = await open(fz, chk);
      tapExport(r);
      expect(q(r, "ps-frozen-wait")).toBeNull();
      expect(q(r, "ps-confirm-export")).toBeTruthy();
      r.unmount();
    }
  });
});

describe("B) the answer that arrives after the export", () => {
  it("exported without an answer, then 'no_frozen' lands → red warning on the exported parcel + top bar + alert, without reopening", async () => {
    h.rows = [frozen({ id: "p2", storeId: "217237", status: "exported", createdAt: at(DAY - 20_000) })];
    const r = await open();
    const row = () => r.container.querySelector('[data-row-id="p2"]') as HTMLElement;
    expect(row().querySelector('[data-testid="ps-frozen-not-checked"]')).toBeTruthy();
    expect(r.getByTestId("ps-attn").getAttribute("data-state")).toBe("ok");
    h.rows = [frozen({ id: "p2", storeId: "217237", status: "exported", createdAt: at(DAY - 20_000), frozenStoreStatus: "no_frozen" })]; // sql/157 wrote it
    await advance(3_100);                                    // the screen is still reading for the late answer
    expect(row().getAttribute("data-flag")).toBe("red");
    expect(row().querySelector('[data-testid="ps-frozen-no-exported"]')?.textContent).toContain("Already exported, but this store can't receive frozen");
    expect(row().querySelector('[data-testid="ps-frozen-not-checked"]')).toBeNull();
    expect(r.getByTestId("ps-attn").getAttribute("data-state")).toBe("problem");
    expect(r.getByTestId("ps-attn-toast").textContent).toContain("Exported parcel: the store can't receive frozen");
    expect(r.getByTestId("ps-attn-toast").textContent).toContain("217237");
  });
  it("a late 'ok' simply removes the note (the all-clear), no alert", async () => {
    h.rows = [frozen({ id: "p1", status: "exported", createdAt: at(DAY - 20_000) })];
    const r = await open();
    h.rows = [frozen({ id: "p1", status: "exported", createdAt: at(DAY - 20_000), frozenStoreStatus: "ok" })];
    await advance(3_100);
    const row = r.container.querySelector('[data-row-id="p1"]') as HTMLElement;
    expect(row.querySelector('[data-testid="ps-frozen-not-checked"]')).toBeNull();
    expect(row.querySelector('[data-testid="ps-ext-clear"]')).toBeTruthy();
    expect(q(r, "ps-attn-toast")).toBeNull();
  });
  it("the screen open with one exported frozen parcel and no answer: reading STOPS after the 10-minute watch (audit: it went on every 3 s forever)", async () => {
    h.rows = [frozen({ id: "x1", status: "exported", createdAt: at(DAY - 20_000) })];
    const r = await open();
    const big = async (ms: number) => { for (let left = ms; left > 0; left -= 3_000) { await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(3_000, left)); }); await flush(); } };
    await big(60_000);
    const early = h.loadParcelScans.mock.calls.length;
    expect(early).toBeGreaterThan(5);                                                                   // the watch does read (every 3 s, then 30 s)
    await big(11 * 60_000);
    const at11 = h.loadParcelScans.mock.calls.length;
    await big(5 * 60_000);
    expect(h.loadParcelScans.mock.calls.length).toBe(at11);                                             // no new read after the watch ended
    await big(20 * 60_000);
    expect(h.loadParcelScans.mock.calls.length).toBe(at11);
    expect(r.container.querySelector('[data-row-id="x1"] [data-testid="ps-frozen-not-checked"]')).toBeTruthy(); // the note stays
  });
  it("the late watch is short: 10 min after the parcel was saved the screen stops reading for it", () => {
    const row = frozen({ id: "p", status: "exported", createdAt: at(DAY) });
    expect(verdictPollMs([row], DAY + 60_000, 180_000, true)).toBe(VERDICT_POLL_FAST_MS);
    expect(verdictPollMs([row], DAY + 5 * 60_000, 180_000, true)).toBe(VERDICT_POLL_SLOW_MS);
    expect(verdictPollMs([row], DAY + FROZEN_LATE_WATCH_MS + 1, 180_000, true)).toBeNull();
    expect(verdictPollMs([row], DAY + 60_000, 180_000, false)).toBeNull();                                  // switch off = today: an exported row is never read for
    expect(verdictPollMs([frozen({ id: "p", status: "exported", createdAt: at(DAY), frozenStoreStatus: "ok" })], DAY + 60_000, 180_000, true)).toBeNull();
    expect(verdictPollMs([mk({ id: "d", status: "exported", createdAt: at(DAY) })], DAY + 60_000, 180_000, true)).toBeNull(); // dry
    expect(rowAwaitsVerdict(row, true)).toBe(false);                                                        // the export questions never count an exported row
  });
});

describe("C) no change, no delay", () => {
  it("a dry parcel, a frozen parcel with 'ok' (cached or live), the switch off, checks off → the export step opens in the same tap", async () => {
    for (const [name, rows, fz, chk] of [
      ["dry", [mk({ id: "d1", createdAt: at(DAY) })], true, true],
      ["frozen ok", [frozen({ id: "f1", createdAt: at(DAY), frozenStoreStatus: "ok" })], true, true],
      ["dry + frozen ok", [mk({ id: "d1", createdAt: at(DAY) }), frozen({ id: "f1", createdAt: at(DAY), frozenStoreStatus: "ok" })], true, true],
      ["switch off, frozen no answer", [frozen({ id: "f1", createdAt: at(DAY) })], false, true],
      ["checks off, frozen no answer", [frozen({ id: "f1", createdAt: at(DAY) })], true, false],
    ] as const) {
      h.rows = rows as unknown as ParcelScanRow[];
      const r = await open(fz, chk);
      tapExport(r);
      expect(q(r, "ps-frozen-wait"), name).toBeNull();
      expect(q(r, "ps-frozen-ask"), name).toBeNull();
      expect(q(r, "ps-pending-msg"), name).toBeNull();
      expect(q(r, "ps-confirm-export"), name).toBeTruthy();    // straight to the export step, as before
      r.unmount();
    }
  });
  it("the phone / store 'still being checked' question is unchanged for a dry parcel", async () => {
    h.rows = [mk({ id: "d1", createdAt: at(DAY), phoneCheckStatus: null as unknown as string })];
    const r = await open();
    tapExport(r);
    expect(q(r, "ps-pending-msg")?.textContent).toContain("1 parcel(s) are still being checked");
    expect(q(r, "ps-frozen-wait")).toBeNull();
    expect(q(r, "ps-confirm-export-anyway")).toBeTruthy();
  });
  it("a no_frozen parcel is still left out of the export, exactly as before (no hold for it)", () => {
    const rows = [frozen({ id: "a", frozenStoreStatus: "no_frozen" }), frozen({ id: "b", frozenStoreStatus: "ok" })];
    expect(splitScansForExport(rows, 38, CFG, true).ready.map((x) => x.id)).toEqual(["b"]);
    expect(frozenHoldRows(rows, DAY, true)).toEqual([]);
  });
});

describe("pure rules", () => {
  const f = (over: Partial<ParcelScanRow> = {}) => frozen({ createdAt: at(DAY), ...over });
  it("frozenHoldRows: only fresh 冷凍 rows with NO answer, switch on — day and night (1.18.2)", () => {
    expect(frozenHoldRows([f({ id: "a" })], DAY, true).map((r) => r.id)).toEqual(["a"]);
    expect(frozenHoldRows([f({ id: "a" })], DAY, false)).toEqual([]);                                        // switch off
    expect(frozenHoldRows([f({ id: "a", frozenStoreStatus: "ok" }), f({ id: "b", frozenStoreStatus: "no_frozen" }), f({ id: "c", frozenStoreStatus: "unknown" })], DAY, true)).toEqual([]);
    expect(frozenHoldRows([mk({ id: "d", createdAt: at(DAY) })], DAY, true)).toEqual([]);                    // dry
    expect(frozenHoldRows([f({ id: "a", status: "exported" })], DAY, true)).toEqual([]);
    expect(frozenHoldRows([f({ id: "a" })], DAY + FROZEN_HOLD_FRESH_MS - 1, true)).toHaveLength(1);
    expect(frozenHoldRows([f({ id: "a" })], DAY + FROZEN_HOLD_FRESH_MS, true)).toEqual([]);                  // too old to wait for
    const night = Date.parse("2026-11-13T18:30:00Z");                                                        // 02:30 Taipei
    expect(frozenHoldRows([f({ id: "a", createdAt: at(night) })], night, true).map((r) => r.id)).toEqual(["a"]); // waits at night too
    expect(frozenHoldRows([f({ id: "a", createdAt: at(night) })], night, false)).toEqual([]);
  });
  it("edit time: a reset frozen answer counts from the edit for the hold, the late watch and the read speed; never for a dry row", () => {
    const old = f({ id: "a", createdAt: at(DAY - 60 * 60_000) });
    const edits = new Map([["a", DAY - 10_000]]);
    expect(frozenHoldRows([old], DAY, true)).toEqual([]);
    expect(frozenHoldRows([old], DAY, true, edits).map((r) => r.id)).toEqual(["a"]);
    expect(frozenHoldRows([old], DAY - 10_000 + FROZEN_HOLD_FRESH_MS, true, edits)).toEqual([]);
    const ex = f({ id: "a", status: "exported", createdAt: at(DAY - 60 * 60_000) });
    expect([lateFrozenWatch(ex, DAY, true), lateFrozenWatch(ex, DAY, true, edits)]).toEqual([false, true]);
    expect(verdictPollMs([old], DAY, 180_000, true)).toBe(VERDICT_POLL_SLOW_MS);
    expect(verdictPollMs([old], DAY, 180_000, true, edits)).toBe(VERDICT_POLL_FAST_MS);
    const dry = mk({ id: "a", createdAt: at(DAY - 60 * 60_000), phoneCheckStatus: null as unknown as string });
    expect(verdictPollMs([dry], DAY, 180_000, true, edits)).toBe(verdictPollMs([dry], DAY, 180_000, true));   // a dry row ignores the edit map
    expect(frozenHoldRows([mk({ id: "a", createdAt: at(DAY) })], DAY, true, edits)).toEqual([]);
  });
  it("frozenHoldState: counts who still waits and who was refused; gone / exported / dry / answered rows no longer wait", () => {
    const rows = [f({ id: "a" }), f({ id: "b", frozenStoreStatus: "no_frozen" }), f({ id: "c", frozenStoreStatus: "ok" }), f({ id: "d", frozenStoreStatus: "unknown" }), f({ id: "e", status: "exported" }), mk({ id: "g" }), f({ id: "z" })];
    expect(frozenHoldState(rows, ["a", "b", "c", "d", "e", "g", "gone"])).toEqual({ waiting: 1, refused: 1 });
    expect(frozenHoldState(rows, ["c", "d", "e", "g", "gone"])).toEqual({ waiting: 0, refused: 0 });
  });
  it("the exported-parcel rules: refused (switch on only), not-checked note for 24 h, late watch for 10 min; never for a dry row", () => {
    expect(exportedFrozenRefused(f({ status: "exported", frozenStoreStatus: "no_frozen" }), true)).toBe(true);
    expect(exportedFrozenRefused(f({ status: "exported", frozenStoreStatus: "no_frozen" }), false)).toBe(false);
    expect(exportedFrozenRefused(f({ frozenStoreStatus: "no_frozen" }), true)).toBe(false);                   // not exported = the normal no_frozen rule
    expect(exportedFrozenRefused(mk({ status: "exported", frozenStoreStatus: "no_frozen" }), true)).toBe(false);
    const x = f({ status: "exported" });
    expect([exportedFrozenUnchecked(x, DAY + 1000, true), exportedFrozenUnchecked(x, DAY + FROZEN_NOTE_MAX_AGE_MS, true), exportedFrozenUnchecked(x, DAY + 1000, false)]).toEqual([true, false, false]);
    expect(exportedFrozenUnchecked(f({ status: "exported", frozenStoreStatus: "ok" }), DAY, true)).toBe(false);
    expect([lateFrozenWatch(x, DAY + 1000, true), lateFrozenWatch(x, DAY + FROZEN_LATE_WATCH_MS, true), lateFrozenWatch(f({ status: "exported", frozenStoreStatus: "unknown" }), DAY, true)]).toEqual([true, false, false]);
    expect(frozenUnchecked(f({ frozenStoreStatus: "unknown" })) && frozenUnchecked(f()) && !frozenUnchecked(f({ frozenStoreStatus: "ok" })) && !frozenUnchecked(mk())).toBe(true);
  });
  it("every new line is filled in all 8 languages, with its placeholders", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const k of ["rd_ps2_frozen_wait", "rd_ps2_frozen_wait_sub", "rd_ps2_frozen_ok_btn", "rd_ps2_frozen_not_checked", "rd_ps2_frozen_no_exported", "rd_ps2_x_no_frozen_exported"]) expect((t[k] || "").trim().length, `${lang} ${k}`).toBeGreaterThan(0);
      for (const k of ["rd_ps2_frozen_wait_n", "rd_ps2_frozen_ask_q", "rd_ps2_frozen_no_q", "rd_ps2_frozen_no_rest"]) expect(t[k], `${lang} ${k}`).toContain("{n}");
    }
  });
});

describe("source", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("the hold has no skip button, and the export is only reached through askExport's order (hold → frozen question → normal question)", () => {
    const src = strip(readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8"));
    expect(src).toMatch(/confirm\.kind === "frozenwait"\s*\? null/);                       // no action button while waiting
    const ask = src.slice(src.indexOf("const askExport = () => {"), src.indexOf("const holdTickRef"));
    expect(ask.indexOf("frozenHoldRows(")).toBeGreaterThan(0);
    expect(ask.indexOf("frozenHoldRows(")).toBeLessThan(ask.indexOf("exportAfterFrozen(false)"));
    expect(src.match(/onClick=\{askExport\}/g)?.length).toBe(1);                           // the one Export button
  });
  it("the helpers live outside adapters/parcelScan's exports and import it as a type only (no cycle)", () => {
    const mod = readFileSync("src/redesign/adapters/parcelFrozenExport.ts", "utf8");
    expect(mod).toContain('import type { ParcelScanRow } from "./parcelScan";');
    expect(strip(mod)).not.toMatch(/import \{[^}]*\} from "\.\/parcelScan"/);
  });
});
