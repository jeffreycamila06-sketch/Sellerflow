// Build 15 — Parcel Scan "needs attention" is impossible to miss (display only).
//   • the top bar is split: Batch (unchanged) | red "⚠ N need attention" or green "✓ All OK",
//     and the bar stays at the top while scrolling (one sticky block with the header);
//   • tapping the red half → the "Needs attention" filter + the first problem parcel ringed
//     and scrolled into view; the green half does nothing;
//   • a NEW problem (after a save's store check, or the checker's verdict) → one short red alert
//     at the top (problem words + the 6-digit store code; never a phone number or a name) and one
//     vibration where the phone has it; never twice for the same parcel;
//   • the old "N need attention · Got it" box (a duplicate that counted fewer problems) is gone.
// Problems = the rows' own red/orange flag: wrong store code, store full, phone restricted.
// The adapter is mocked (DB calls are spies); the pure helpers are the REAL ones.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider, buildT } from "../../i18n";
import type { ParcelScanRow } from "../../adapters/parcelScan";

const H = vi.hoisted(() => ({
  loads: [] as ParcelScanRow[][],      // successive loadParcelScans answers (last one repeats)
  calls: 0,
  storeCheck: "valid" as string,
}));

vi.mock("../../adapters/parcelScan", async () => {
  const real = await vi.importActual<typeof import("../../adapters/parcelScan")>("../../adapters/parcelScan");
  return {
    verdictPollMs: real.verdictPollMs, rowCheckUnresolved: real.rowCheckUnresolved,
    storeClear: real.storeClear, wrongStoreCode: real.wrongStoreCode,
    rowAwaitsVerdict: real.rowAwaitsVerdict, mergeExtensionVerdicts: real.mergeExtensionVerdicts,
    splitScansForExport: real.splitScansForExport,
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })),
    loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })),
    undoExportBatch: vi.fn(async () => ({ ok: true, result: "undone" })),
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
    loadParcelScans: vi.fn(async () => {
      const i = Math.min(H.calls, H.loads.length - 1);
      H.calls++;
      return { ok: true, rows: H.loads[i] ?? [] };
    }),
    checkEmapStore: vi.fn(async () => ({ status: H.storeCheck })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    formErrors: () => ({ name: false, phone: false, store: false, amount: false, empty: false }),
    amountWarns: () => false, amountTooHigh: () => false,
    MIN_PARCEL_AMOUNT: 20, MAX_PARCEL_TOTAL: 20000, MAX_PENDING_PARCELS: 40,
    scanToXlsRow: vi.fn(), markScansExported: vi.fn(), unmarkScansExported: vi.fn(),
    deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: vi.fn(async () => ({ ok: true })), resetExtensionChecks: vi.fn(async () => ({ ok: true })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const t = buildT("en");
const mk = (id: string, over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id, customerName: `Juan ${id}`, phone: "0912345678", storeId: "266402", amount: 550,
  notes: "@juan", status: "confirmed", storeCheckStatus: "valid",
  storeFullStatus: "open", phoneCheckStatus: "ok", phoneRestrictedUntil: null,
  createdAt: new Date().toISOString(), ...over,
});
const clean = (n: number) => Array.from({ length: n }, (_, i) => mk(`c${i + 1}`));
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function view(rows: ParcelScanRow[][], checkOn = true) {
  H.loads = rows; H.calls = 0;
  const r = render(<TProvider lang="en"><ParcelScan cur="NT$" checkOn={checkOn} manualOnly /></TProvider>);
  await flush();
  return r;
}

let vibrate: ReturnType<typeof vi.fn>;
let scrolled: Element[];
beforeEach(() => {
  H.storeCheck = "valid";
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
  scrolled = [];
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: Element) { scrolled.push(this); };
});
afterEach(() => { vi.useRealTimers(); });

describe("the top bar: Batch | attention", () => {
  it("no problems → green \"✓ All OK\" next to Batch; tapping it does nothing", async () => {
    const { getByTestId, queryAllByTestId } = await view([clean(3)]);
    const attn = getByTestId("ps-attn");
    expect(attn.getAttribute("data-state")).toBe("ok");
    expect(attn.textContent).toBe("✓ All OK");
    expect(attn.tagName).not.toBe("BUTTON");
    expect(getByTestId("ps-batch-n").textContent).toBe("3 / 40");     // Batch unchanged
    fireEvent.click(attn);
    await flush();
    expect(getByTestId("ps-tab-all").getAttribute("aria-pressed")).toBe("true");
    expect(queryAllByTestId("ps-row")).toHaveLength(3);
    expect(document.querySelector("[data-highlight='1']")).toBeNull();
  });

  it("problems → red \"⚠ N need attention\" counting wrong code + full + restricted", async () => {
    const { getByTestId, queryByTestId } = await view([[
      mk("a"), mk("full1", { storeFullStatus: "full" }), mk("b"),
      mk("wrong1", { storeCheckStatus: "not_found" }), mk("restr1", { phoneCheckStatus: "restricted" }),
    ]]);
    const attn = getByTestId("ps-attn");
    expect(attn.getAttribute("data-state")).toBe("problem");
    expect(attn.tagName).toBe("BUTTON");
    expect(attn.textContent).toBe("⚠ 3 need attention");
    expect(queryByTestId("ps-attention-banner")).toBeNull();          // the old "Got it" box is gone
    expect(queryByTestId("ps-attn-toast")).toBeNull();                // problems already there on open → no alert
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("the bar stays at the top: one sticky block = header + Batch | attention", async () => {
    const { getByTestId } = await view([[mk("full1", { storeFullStatus: "full" })]]);
    const top = getByTestId("ps-top");
    expect(top.style.position).toBe("sticky");
    expect(top.style.top).toBe("0px");
    expect(within(top).getByTestId("ps-batch")).toBeTruthy();
    expect(within(top).getByTestId("ps-attn")).toBeTruthy();
  });

  it("Tagalog: \"⚠ N may problema\" / \"✓ Lahat OK\"; all 8 languages filled", () => {
    expect(buildT("fil").rd_ps2_attn_bar).toBe("⚠ {n} may problema");
    expect(buildT("fil").rd_ps2_attn_ok_all).toBe("✓ Lahat OK");
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const T = buildT(l);
      for (const k of ["rd_ps2_attn_bar", "rd_ps2_attn_ok_all", "rd_ps2_attn_open", "rd_ps2_tab_attn"] as const) expect(T[k].length).toBeGreaterThan(0);
      expect(T.rd_ps2_attn_bar).toContain("{n}");
    }
  });
});

describe("tap the red half", () => {
  it("→ the \"Needs attention\" filter (only the problem parcels), the first one ringed + scrolled into view", async () => {
    const { getByTestId, queryAllByTestId } = await view([[
      mk("a"), mk("wrong1", { storeCheckStatus: "not_found" }), mk("b"), mk("full1", { storeFullStatus: "full" }),
    ]]);
    fireEvent.click(getByTestId("ps-attn"));
    await flush();
    const tab = getByTestId("ps-tab-attention");
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(tab.textContent).toBe(`⚠ ${t.rd_ps2_tab_attn} · 2`);
    const rows = queryAllByTestId("ps-row");
    expect(rows.map((r) => r.getAttribute("data-row-id"))).toEqual(["wrong1", "full1"]);
    expect(rows[0].getAttribute("data-highlight")).toBe("1");
    expect(rows[1].getAttribute("data-highlight")).toBeNull();
    expect(scrolled).toContain(rows[0]);
  });

  it("the ring fades after a few seconds", async () => {
    const { getByTestId } = await view([[mk("full1", { storeFullStatus: "full" })]]);
    vi.useFakeTimers();
    fireEvent.click(getByTestId("ps-attn"));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector("[data-highlight='1']")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(document.querySelector("[data-highlight='1']")).toBeNull();
  });

  it("no attention filter when nothing needs attention", async () => {
    const { queryByTestId } = await view([clean(2)]);
    expect(queryByTestId("ps-tab-attention")).toBeNull();
  });
});

describe("a NEW problem → one alert + one vibration, never twice for the same parcel", () => {
  // r2 awaits the checker (store not checked yet) → the screen re-reads every 3 s.
  const awaiting = () => [mk("r1"), mk("r2", { storeFullStatus: null, storeId: "123456" })];
  const nowFull = () => [mk("r1"), mk("r2", { storeFullStatus: "full", storeId: "123456" })];

  it("the checker says store full → bar goes up, one red alert with the store code, one vibration", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
    const { getByTestId, queryByTestId } = await view([awaiting(), nowFull()]);
    expect(getByTestId("ps-attn").getAttribute("data-state")).toBe("ok");
    await act(async () => { vi.advanceTimersByTime(3100); });
    await flush();
    expect(getByTestId("ps-attn").textContent).toBe("⚠ 1 need attention");
    const toast = getByTestId("ps-attn-toast");
    expect(toast.textContent).toBe(`⚠ ${t.rd_ps2_x_store_full} · 123456`);
    expect(toast.getAttribute("role")).toBe("alert");
    expect(toast.textContent).not.toContain("0912345678");             // never a phone number…
    expect(toast.textContent).not.toContain("Juan");                   // …or a name
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(200);
    // short: gone after ~4 s
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(queryByTestId("ps-attn-toast")).toBeNull();
  });

  it("the same parcel again (re-reads, or another problem on it) → no second alert, no second vibration", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
    // r3 keeps awaiting so the screen keeps re-reading (the poll stops once nothing awaits).
    const fullPlusWaiting = () => [...nowFull(), mk("r3", { storeFullStatus: null })];
    const alsoRestricted = () => [mk("r1"), mk("r2", { storeFullStatus: "full", phoneCheckStatus: "restricted", storeId: "123456" }), mk("r3", { storeFullStatus: null })];
    const { queryByTestId, getAllByTestId } = await view([[...awaiting(), mk("r3", { storeFullStatus: null })], fullPlusWaiting(), alsoRestricted()]);
    await act(async () => { vi.advanceTimersByTime(3100); });
    await flush();
    expect(vibrate).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(4100); });       // first alert gone
    for (let i = 0; i < 4; i++) { await act(async () => { vi.advanceTimersByTime(3100); }); await flush(); }
    expect(H.calls).toBeGreaterThanOrEqual(4);                         // the later reads really happened…
    expect(getAllByTestId("ps-ext-badge-restricted")).toHaveLength(1);  // …and r2 now also shows "restricted"
    expect(queryByTestId("ps-attn-toast")).toBeNull();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("after a store check (Re-check) finds a wrong code → the alert names it with the store code", async () => {
    H.storeCheck = "not_found";
    const { getByTestId } = await view([[mk("r1", { storeCheckStatus: "unknown", storeId: "654321" })]]);
    expect(getByTestId("ps-attn").getAttribute("data-state")).toBe("ok");
    fireEvent.click(getByTestId("ps-recheck"));
    await flush();
    expect(getByTestId("ps-attn").textContent).toBe("⚠ 1 need attention");
    expect(getByTestId("ps-attn-toast").textContent).toBe(`⚠ ${t.rd_ps2_x_wrong_store} · 654321`);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("a phone without vibration (iPhone) → the alert still shows, nothing breaks", async () => {
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true, writable: true });
    H.storeCheck = "not_found";
    const { getByTestId } = await view([[mk("r1", { storeCheckStatus: "unknown", storeId: "654321" })]]);
    fireEvent.click(getByTestId("ps-recheck"));
    await flush();
    expect(getByTestId("ps-attn-toast")).toBeTruthy();
  });

  it("no sound is added: the alert path calls only the vibration (the chime stays on the checker poll)", () => {
    const src = readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8");
    const alertEffect = src.slice(src.indexOf("const attnSeq ="), src.indexOf("// Tap the red half"));
    expect(alertEffect).toContain("triggerHaptic(ATTN_VIBRATE_MS)");
    expect(alertEffect).not.toMatch(/playChime|Audio/);
  });
});
