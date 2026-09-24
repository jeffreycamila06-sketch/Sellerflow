// 2a — NO DOUBLE EXPORT across devices. Two screens (phone/laptop, any mix) of the
// SAME account both show the same ready parcels. Each export re-reads the list and
// CLAIMS rows atomically before building (markScansExported only takes rows still
// unexported at that instant), so every parcel lands in exactly ONE delivered file.
// The fake DB below models Postgres: each claim call is atomic, loads return a
// snapshot. Two mounted <ParcelScan> = two devices; clicks without an await between
// them = genuinely concurrent exports (both loads resolve before either claim).
// 2b — "Undo last export" is loaded on screen open from ANY device: the newest batch
// by exported_at (sql/49 — stamped by the DB clock, modelled here by DB.clock).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within, screen } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const DB = vi.hoisted(() => ({
  rows: [] as (ParcelScanRow & { batch?: string | null; exportedAt?: number | null })[],
  n: 0,
  clock: 0, // the DATABASE clock (now()) — sql/49's trigger stamps exported_at with it
  built: [] as string[][], // row ids of every file that was built
  narrow: false,
}));

const { deliverXlsm, deliverXlsmMobile, markScansExported, unmarkScansExported, loadLastExportBatch } = vi.hoisted(() => ({
  deliverXlsm: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  deliverXlsmMobile: vi.fn(async () => ({ ok: true, via: "webshare" }) as { ok: boolean; via: string; cancelled?: boolean }),
  // Atomic conditional claim (Postgres re-checks WHERE status <> 'exported' per locked row).
  markScansExported: vi.fn(async (ids: string[]) => {
    const batchId = `batch-${++DB.n}`;
    const now = ++DB.clock;
    const claimed: string[] = [];
    for (const r of DB.rows) {
      if (ids.includes(r.id) && r.status !== "exported") { r.status = "exported"; r.batch = batchId; r.exportedAt = now; claimed.push(r.id); }
    }
    return { ok: true, batchId, claimed };
  }),
  unmarkScansExported: vi.fn(async (batchId: string) => {
    for (const r of DB.rows) if (r.batch === batchId) { r.status = "confirmed"; r.batch = null; r.exportedAt = null; }
    return { ok: true };
  }),
  // Newest batch by exported_at, from any device; unstamped (pre-sql/49) rows never offered.
  loadLastExportBatch: vi.fn(async () => {
    const stamped = DB.rows.filter((r) => r.status === "exported" && r.batch && r.exportedAt != null);
    if (!stamped.length) return { ok: true, batch: null };
    const newest = stamped.reduce((a, b) => ((b.exportedAt as number) > (a.exportedAt as number) ? b : a));
    return { ok: true, batch: { id: newest.batch as string, ids: DB.rows.filter((r) => r.batch === newest.batch).map((r) => r.id) } };
  }),
}));

vi.mock("../../adapters/parcelScan", () => ({
  rowAwaitsVerdict: () => false, mergeExtensionVerdicts: (p: unknown) => p,
  MAX_PENDING_PARCELS: 40,
  fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: vi.fn(),
  loadParcelScans: vi.fn(async () => ({ ok: true, rows: DB.rows.map((r) => ({ ...r })) })),
  checkEmapStore: vi.fn(), saveStoreCheck: vi.fn(),
  formErrors: () => ({ name: false, phone: false, store: false, empty: false }),
  amountWarns: () => false,
  splitScansForExport: (rows: ParcelScanRow[]) => ({ ready: rows.filter((r) => r.status !== "exported"), attention: [] }),
  scanToXlsRow: (r: ParcelScanRow) => [r.id],
  markScansExported, unmarkScansExported, loadLastExportBatch,
  deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
  updateParcelScan: vi.fn(async () => ({ ok: true })),
  getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
}));
vi.mock("../../adapters/shippingExport", () => ({
  fetchShipTemplate: vi.fn(async () => new Uint8Array()),
  buildXlsmFromTemplate: vi.fn(async (_tpl: Uint8Array, xls: string[][]) => { DB.built.push(xls.map((x) => x[0])); return new Uint8Array([1]); }),
  deliverXlsm, deliverXlsmMobile,
  exportFilename: () => "sellerflow_711.xlsm",
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
// Phone vs laptop per mount: `narrow` is read once into state at mount, so each device keeps its own.
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => DB.narrow }));

import ParcelScan from "../ParcelScan";

const row = (id: string): ParcelScanRow & { batch?: string | null } => ({
  id, customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550, notes: "",
  status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z", batch: null,
} as ParcelScanRow & { batch?: string | null });

const mount = async (device: "phone" | "laptop", ready = 3) => {
  DB.narrow = device === "phone";
  const u = render(<TProvider><ParcelScan cur="NT$" /></TProvider>);
  const w = within(u.container);
  if (device === "phone") { // per-device "Export on this phone" switch → ON
    fireEvent.click(await w.findByTestId("ps-export-switch-toggle"));
    fireEvent.click(screen.getByTestId("ps-confirm-enablephone"));
  }
  await w.findByTestId("ps-export-btn");
  await waitFor(() => expect(w.getByTestId("ps-export-btn").textContent).toContain(String(ready))); // stale screens both show 3 ready
  return w;
};
// Laptop: Export → confirm (the dialog closes synchronously and runExport starts).
const laptopExport = (w: ReturnType<typeof within>) => {
  fireEvent.click(w.getByTestId("ps-export-btn"));
  fireEvent.click(screen.getByTestId("ps-confirm-export"));
};
const allExported = () => DB.built.flat();

beforeEach(() => {
  DB.rows = [row("r1"), row("r2"), row("r3")]; DB.n = 0; DB.clock = 0; DB.built = []; DB.narrow = false;
  deliverXlsm.mockClear(); deliverXlsmMobile.mockClear(); markScansExported.mockClear(); unmarkScansExported.mockClear();
  deliverXlsmMobile.mockResolvedValue({ ok: true, via: "webshare" });
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe("2a — concurrent export never double-exports a parcel", () => {
  it("laptop + laptop exporting at the SAME moment → each parcel in exactly one file", async () => {
    const a = await mount("laptop");
    const b = await mount("laptop");
    laptopExport(a); laptopExport(b); // no await between → both loads resolve before either claim
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    await b.findByTestId("ps-export-elsewhere");
    expect(allExported().sort()).toEqual(["r1", "r2", "r3"]); // no duplicate, none lost
    expect(b.getByTestId("ps-export-elsewhere").textContent).toContain("3");
  });

  it("phone + phone opening Export at the SAME moment → only one claims, the other exports nothing", async () => {
    const a = await mount("phone");
    const b = await mount("phone");
    fireEvent.click(a.getByTestId("ps-export-btn"));
    fireEvent.click(b.getByTestId("ps-export-btn"));
    await b.findByTestId("ps-export-elsewhere");               // loser: dialog closed, "3 on another device"
    const go = await screen.findByTestId("ps-confirm-export"); // the winner's dialog is the only one left
    await waitFor(() => expect(go).not.toBeDisabled());
    fireEvent.click(go);
    await a.findByTestId("ps-export-summary");
    expect(deliverXlsmMobile).toHaveBeenCalledTimes(1);
    expect(allExported().sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("phone holds the claim (dialog open) while a stale laptop exports → laptop file gets none", async () => {
    const phone = await mount("phone");
    const laptop = await mount("laptop");
    fireEvent.click(phone.getByTestId("ps-export-btn"));
    const go = await screen.findByTestId("ps-confirm-export");
    await waitFor(() => expect(go).not.toBeDisabled());       // phone claimed + built
    const phoneGo = go;
    // The laptop's confirm dialog would share the body with the phone's — export via the laptop directly.
    fireEvent.click(laptop.getByTestId("ps-export-btn"));
    const laptopGo = screen.getAllByTestId("ps-confirm-export").find((el) => el !== phoneGo)!;
    fireEvent.click(laptopGo);
    await laptop.findByTestId("ps-export-elsewhere");
    expect(deliverXlsm).not.toHaveBeenCalled();                // stale laptop built/delivered nothing
    fireEvent.click(phoneGo);
    await phone.findByTestId("ps-export-summary");
    expect(allExported().sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("phone cancels its dialog → claim released → the laptop then exports all of them", async () => {
    const phone = await mount("phone");
    const laptop = await mount("laptop");
    fireEvent.click(phone.getByTestId("ps-export-btn"));
    await waitFor(() => expect(screen.getByTestId("ps-confirm-export")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("ps-confirm-cancel"));
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledTimes(1));
    laptopExport(laptop);
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    expect(DB.built.at(-1)!.sort()).toEqual(["r1", "r2", "r3"]); // the laptop's file has all 3
    expect(deliverXlsmMobile).not.toHaveBeenCalled();
  });
});

describe("2b — Undo last export works from ANY device", () => {
  it("laptop exports → a phone opened afterwards offers Undo for that batch and reverts it", async () => {
    const laptop = await mount("laptop");
    laptopExport(laptop);
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    const phone = await mount("phone", 0);                     // fresh screen on another device, 0 ready
    fireEvent.click(await phone.findByTestId("ps-undo-btn"));   // the laptop's batch is offered here
    expect(screen.getByTestId("ps-confirm-msg").textContent).toContain("3");
    fireEvent.click(screen.getByTestId("ps-confirm-undo"));
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledWith("batch-1"));
    expect(DB.rows.every((r) => r.status === "confirmed")).toBe(true); // all 3 back to ready in the DB
    await waitFor(() => expect(phone.queryByTestId("ps-undo-btn")).toBeNull());
  });

  it("offers the NEWEST batch by exported_at when two devices exported", async () => {
    DB.rows = [row("r1"), row("r2"), row("r3"), row("r4")];
    const a = await mount("laptop", 4);
    laptopExport(a);                                            // batch-1 = r1..r4
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    await unmarkScansExported("batch-1");                       // back to ready…
    DB.rows[3].status = "exported"; DB.rows[3].batch = "old"; DB.rows[3].exportedAt = null; // …plus a pre-sql/49 batch
    const b = await mount("laptop", 3);
    laptopExport(b);                                            // batch-2 = r1..r3 (newest)
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(2));
    const c = await mount("phone", 0);
    fireEvent.click(await c.findByTestId("ps-undo-btn"));
    fireEvent.click(screen.getByTestId("ps-confirm-undo"));
    await waitFor(() => expect(unmarkScansExported).toHaveBeenLastCalledWith("batch-2"));
  });

  it("a cancelled (released) export is NOT offered for undo on another device", async () => {
    const phone = await mount("phone");
    fireEvent.click(phone.getByTestId("ps-export-btn"));
    await waitFor(() => expect(screen.getByTestId("ps-confirm-export")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("ps-confirm-cancel"));
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledTimes(1));
    const laptop = await mount("laptop");                        // all 3 ready again
    await waitFor(() => expect(loadLastExportBatch).toHaveBeenCalled());
    expect(laptop.queryByTestId("ps-undo-btn")).toBeNull();
  });
});
