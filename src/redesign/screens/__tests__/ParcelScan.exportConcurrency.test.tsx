// 2a — NO DOUBLE EXPORT across devices. Two screens (phone/laptop, any mix) of the
// SAME account both show the same ready parcels. Each export re-reads the list and
// CLAIMS rows atomically before building (markScansExported only takes rows still
// unexported at that instant), so every parcel lands in exactly ONE delivered file.
// The fake DB below models Postgres: each claim call is atomic, loads return a
// snapshot. Two mounted <ParcelScan> = two devices; clicks without an await between
// them = genuinely concurrent exports (both loads resolve before either claim).
// 2b — "Undo last export" is loaded on screen open from ANY device: the newest batch
// by exported_at (sql/49 — stamped by the DB clock, modelled here by DB.clock).
// LATEST-ONLY (sql/50): an undone batch keeps its batch id + stamp as a tombstone, so
// it stays the newest export event and nothing older is ever offered; a RELEASED
// claim (cancelled export) clears both and is not an export event.
// sql/51 — CLAIMED vs DELIVERED: a claim is undelivered until the device confirms the
// file went out. undo_export_batch decides in the DB at tap time: stale Undo → not_latest;
// claimed < WINDOW → in_progress; claimed ≥ WINDOW (orphan) → released even if newer
// exports exist. DB.clock counts MINUTES here so the 15-min window can be crossed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within, screen } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

type Row = ParcelScanRow & { batch?: string | null; exportedAt?: number | null; delivered?: boolean };
const DB = vi.hoisted(() => ({
  rows: [] as (import("../../adapters/parcelScan").ParcelScanRow & { batch?: string | null; exportedAt?: number | null; delivered?: boolean })[],
  n: 0,
  clock: 0, // the DATABASE clock (now()), in minutes
  WINDOW: 15, // sql/51 c_window
  built: [] as string[][], // row ids of every file that was built
  narrow: false,
  failRelease: false, // offline: the release never reaches the DB
}));

const { deliverXlsm, deliverXlsmMobile, markScansExported, unmarkScansExported, undoExportBatch, loadLastExportBatch, confirmExportDelivered, loadUndeliveredExports, deleteExportedParcels } = vi.hoisted(() => ({
  deliverXlsm: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  deliverXlsmMobile: vi.fn(async () => ({ ok: true, via: "webshare" }) as { ok: boolean; via: string; cancelled?: boolean }),
  // Atomic conditional claim (Postgres re-checks WHERE status <> 'exported' per locked row);
  // the sql/51 trigger stamps exported_at and marks the claim NOT delivered.
  markScansExported: vi.fn(async (ids: string[]) => {
    const batchId = `batch-${++DB.n}`;
    const now = ++DB.clock;
    const claimed: string[] = [];
    for (const r of DB.rows) {
      if (ids.includes(r.id) && r.status !== "exported") { r.status = "exported"; r.batch = batchId; r.exportedAt = now; r.delivered = false; claimed.push(r.id); }
    }
    return { ok: true, batchId, claimed };
  }),
  // RELEASE (claim never delivered): batch id cleared → trigger clears exported_at.
  unmarkScansExported: vi.fn(async (batchId: string) => {
    if (DB.failRelease) return { ok: false, error: "offline" };
    for (const r of DB.rows) if (r.batch === batchId) { r.status = "confirmed"; r.batch = null; r.exportedAt = null; }
    return { ok: true };
  }),
  confirmExportDelivered: vi.fn(async (batchId: string) => {
    let n = 0;
    for (const r of DB.rows) if (r.batch === batchId && r.status === "exported") { r.delivered = true; n++; }
    return { ok: true, n };
  }),
  // Mirrors sql/51 undo_export_batch exactly.
  undoExportBatch: vi.fn(async (batchId: string, orphanOnly = false) => {
    const mine = DB.rows.filter((r) => r.batch === batchId && r.status === "exported");
    if (!mine.length) return { ok: true, result: "nothing" };
    const undelivered = mine.some((r) => r.delivered === false);
    if (orphanOnly && !undelivered) return { ok: true, result: "delivered" };
    if (undelivered) {
      const claimedAt = Math.max(...mine.map((r) => r.exportedAt ?? 0));
      if (claimedAt > DB.clock - DB.WINDOW) return { ok: true, result: "in_progress" };
      for (const r of mine) { r.status = "confirmed"; r.batch = null; r.exportedAt = null; }
      return { ok: true, result: "released" };
    }
    const stamped = DB.rows.filter((r) => r.batch && r.exportedAt != null);
    const newest = stamped.reduce((a, b) => ((b.exportedAt as number) > (a.exportedAt as number) ? b : a));
    if (newest.batch !== batchId || newest.status !== "exported") return { ok: true, result: "not_latest" };
    for (const r of mine) r.status = "confirmed"; // tombstone: batch + stamp kept
    return { ok: true, result: "undone" };
  }),
  // Newest export EVENT by exported_at (any status); offered only if still exported AND delivered.
  loadLastExportBatch: vi.fn(async () => {
    const stamped = DB.rows.filter((r) => r.batch && r.exportedAt != null);
    if (!stamped.length) return { ok: true, batch: null };
    const newest = stamped.reduce((a, b) => ((b.exportedAt as number) > (a.exportedAt as number) ? b : a));
    if (newest.status !== "exported" || newest.delivered === false) return { ok: true, batch: null };
    return { ok: true, batch: { id: newest.batch as string, ids: DB.rows.filter((r) => r.batch === newest.batch && r.status === "exported").map((r) => r.id) } };
  }),
  loadUndeliveredExports: vi.fn(async () => {
    const by = new Map<string, { batchId: string; ids: string[]; claimedAt: string }>();
    for (const r of DB.rows) {
      if (r.status !== "exported" || r.delivered !== false || !r.batch) continue;
      const e = by.get(r.batch) ?? { batchId: r.batch, ids: [], claimedAt: "2026-09-24T10:00:00Z" };
      e.ids.push(r.id); by.set(r.batch, e);
    }
    return { ok: true, batches: [...by.values()] };
  }),
  // sql/51: "Clear exported" deletes DELIVERED rows only.
  deleteExportedParcels: vi.fn(async () => {
    DB.rows = DB.rows.filter((r) => !(r.status === "exported" && r.delivered !== false));
    return { ok: true };
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
  markScansExported, unmarkScansExported, undoExportBatch, loadLastExportBatch, confirmExportDelivered, loadUndeliveredExports,
  deleteParcelScan: vi.fn(), deleteExportedParcels,
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

const row = (id: string): Row => ({
  id, customerName: "Juan", phone: "0912345678", storeId: "266402", amount: 550, notes: "",
  status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z", batch: null, delivered: true,
} as Row);

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
  DB.rows = [row("r1"), row("r2"), row("r3")]; DB.n = 0; DB.clock = 0; DB.built = []; DB.narrow = false; DB.failRelease = false;
  for (const f of [deliverXlsm, deliverXlsmMobile, markScansExported, unmarkScansExported, undoExportBatch, loadLastExportBatch, confirmExportDelivered, loadUndeliveredExports, deleteExportedParcels]) f.mockClear();
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
    await waitFor(() => expect(undoExportBatch).toHaveBeenCalledWith("batch-1"));
    expect(DB.rows.every((r) => r.status === "confirmed")).toBe(true); // all 3 back to ready in the DB
    await waitFor(() => expect(phone.queryByTestId("ps-undo-btn")).toBeNull());
  });

  it("offers the NEWEST batch by exported_at when two devices exported", async () => {
    DB.rows = [row("r1"), row("r2"), row("r3"), row("r4")];
    const a = await mount("laptop", 4);
    laptopExport(a);                                            // batch-1 = r1..r4
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    await unmarkScansExported("batch-1");                       // back to ready…
    DB.rows[3].status = "exported"; DB.rows[3].batch = "old"; DB.rows[3].exportedAt = null; DB.rows[3].delivered = true; // …plus a pre-sql/49 batch
    const b = await mount("laptop", 3);
    laptopExport(b);                                            // batch-2 = r1..r3 (newest)
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(2));
    const c = await mount("phone", 0);
    fireEvent.click(await c.findByTestId("ps-undo-btn"));
    fireEvent.click(screen.getByTestId("ps-confirm-undo"));
    await waitFor(() => expect(undoExportBatch).toHaveBeenLastCalledWith("batch-2"));
  });

  it("LATEST-ONLY: after the latest batch is undone, the batch before it is NOT offered (no cascade)", async () => {
    DB.rows = [row("r1"), row("r2"), row("r3"), row("r4")];
    DB.rows[3].status = "exported"; DB.rows[3].batch = "batch-older"; DB.rows[3].exportedAt = ++DB.clock; DB.rows[3].delivered = true; // an earlier export (r4)
    const laptop = await mount("laptop");                        // r1..r3 ready
    laptopExport(laptop);                                         // batch-1 = r1..r3 (the latest)
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    const phone = await mount("phone", 0);
    fireEvent.click(await phone.findByTestId("ps-undo-btn"));
    fireEvent.click(screen.getByTestId("ps-confirm-undo"));
    await waitFor(() => expect(undoExportBatch).toHaveBeenCalledWith("batch-1"));
    await waitFor(() => expect(phone.queryByTestId("ps-undo-btn")).toBeNull());
    // Every screen opened afterwards (any device) offers NOTHING — batch-older stays exported.
    const again = await mount("phone", 3);
    await waitFor(() => expect(loadLastExportBatch).toHaveBeenCalledTimes(3));
    expect(again.queryByTestId("ps-undo-btn")).toBeNull();
    expect(undoExportBatch).toHaveBeenCalledTimes(1);
    expect(DB.rows[3].status).toBe("exported");
  });

  it("a fresh export AFTER an undo becomes the latest and is offered again", async () => {
    const laptop = await mount("laptop");
    laptopExport(laptop);                                          // batch-1
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    await undoExportBatch("batch-1");                              // undone (tombstone)
    const b = await mount("laptop", 3);
    laptopExport(b);                                               // batch-2 re-exports r1..r3
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(2));
    const phone = await mount("phone", 0);
    fireEvent.click(await phone.findByTestId("ps-undo-btn"));
    expect(screen.getByTestId("ps-confirm-msg").textContent).toContain("3");
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

describe("sql/51 — authoritative Undo, visible orphans, no undo of an in-flight export", () => {
  it("STALE Undo refused: a laptop's old Undo button can't revert batch A after a phone exported B", async () => {
    const laptop = await mount("laptop");
    laptopExport(laptop);                                          // batch-1 = r1..r3, delivered
    await laptop.findByTestId("ps-undo-btn");                      // laptop now shows Undo for batch-1
    DB.rows.push(row("r4"));
    const phone = await mount("phone", 1);
    fireEvent.click(phone.getByTestId("ps-export-btn"));
    const go = await screen.findByTestId("ps-confirm-export");
    await waitFor(() => expect(go).not.toBeDisabled());
    fireEvent.click(go);                                           // batch-2 = r4, delivered (the latest)
    await phone.findByTestId("ps-undo-btn");
    fireEvent.click(laptop.getByTestId("ps-undo-btn"));            // the laptop's STALE button
    fireEvent.click(screen.getByTestId("ps-confirm-undo"));
    await laptop.findByTestId("ps-undo-refused");
    expect(undoExportBatch).toHaveBeenLastCalledWith("batch-1");
    expect(DB.rows.filter((r) => ["r1", "r2", "r3"].includes(r.id)).every((r) => r.status === "exported")).toBe(true); // A untouched
  });

  it("KILLED mid-export → orphan card on reopen → Put back works even after a NEWER export", async () => {
    await markScansExported(["r1", "r2", "r3"]);                   // phone claimed at dialog open… then the app died
    DB.rows.push(row("r4"));
    const laptop = await mount("laptop", 1);
    laptopExport(laptop);                                          // a newer, delivered export (r4)
    await waitFor(() => expect(deliverXlsm).toHaveBeenCalledTimes(1));
    DB.clock += DB.WINDOW + 1;                                      // time passes
    const reopened = await mount("phone", 0);
    const card = await reopened.findByTestId("ps-orphan-card");     // NOT passed off as a delivered export
    expect(card.textContent).toContain("3");
    fireEvent.click(within(card).getByTestId("ps-orphan-putback"));
    await waitFor(() => expect(undoExportBatch).toHaveBeenCalledWith("batch-1", true));
    await waitFor(() => expect(reopened.queryByTestId("ps-orphan-card")).toBeNull());
    expect(DB.rows.filter((r) => ["r1", "r2", "r3"].includes(r.id)).every((r) => r.status === "confirmed")).toBe(true);
    expect(DB.rows.find((r) => r.id === "r4")!.status).toBe("exported"); // the newer export untouched
  });

  it("IN-PROGRESS refused: Put back on a batch another device claimed minutes ago does nothing", async () => {
    await markScansExported(["r1", "r2", "r3"]);                   // another device is sharing right now
    const laptop = await mount("laptop", 0);
    const card = await laptop.findByTestId("ps-orphan-card");
    fireEvent.click(within(card).getByTestId("ps-orphan-putback"));
    await laptop.findByTestId("ps-orphan-msg");
    expect(DB.rows.every((r) => r.status === "exported" && r.delivered === false)).toBe(true);
    expect(laptop.queryByTestId("ps-undo-btn")).toBeNull();        // never offered as a normal Undo either
  });

  it("LONG-OPEN dialog: put back elsewhere after the window → the phone's share shows the red do-NOT-upload warning", async () => {
    const phone = await mount("phone");
    fireEvent.click(phone.getByTestId("ps-export-btn"));
    const go = await screen.findByTestId("ps-confirm-export");
    await waitFor(() => expect(go).not.toBeDisabled());            // claimed, dialog left open…
    DB.clock += DB.WINDOW + 1;
    const laptop = await mount("laptop", 0);
    fireEvent.click(within(await laptop.findByTestId("ps-orphan-card")).getByTestId("ps-orphan-putback"));
    await waitFor(() => expect(DB.rows.every((r) => r.status === "confirmed")).toBe(true));
    fireEvent.click(go);                                           // the phone finally shares its (stale) file
    await phone.findByTestId("ps-put-back-warn");
    expect(phone.queryByTestId("ps-undo-btn")).toBeNull();
  });

  it("CLEAR EXPORTED spares orphans: only delivered rows are deleted", async () => {
    DB.rows[0].status = "exported"; DB.rows[0].batch = "old"; DB.rows[0].exportedAt = ++DB.clock; DB.rows[0].delivered = true;
    await markScansExported(["r2", "r3"]);                         // an orphan-to-be
    DB.clock += DB.WINDOW + 1;
    const laptop = await mount("laptop", 0);
    await laptop.findByTestId("ps-orphan-card");
    fireEvent.click(laptop.getByTestId("ps-clear-exported"));
    fireEvent.click(screen.getByTestId("ps-confirm-delete"));
    await waitFor(() => expect(deleteExportedParcels).toHaveBeenCalledTimes(1));
    expect(DB.rows.map((r) => r.id).sort()).toEqual(["r2", "r3"]); // the orphan rows survive
    expect(laptop.getByTestId("ps-orphan-card").textContent).toContain("2");
  });

  it("OFFLINE release (cancel with no signal) → the claim becomes a visible, recoverable orphan", async () => {
    const phone = await mount("phone");
    fireEvent.click(phone.getByTestId("ps-export-btn"));
    await waitFor(() => expect(screen.getByTestId("ps-confirm-export")).not.toBeDisabled());
    DB.failRelease = true;
    fireEvent.click(screen.getByTestId("ps-confirm-cancel"));      // release never reaches the DB
    await waitFor(() => expect(unmarkScansExported).toHaveBeenCalledTimes(1));
    expect(DB.rows.every((r) => r.status === "exported")).toBe(true);
    DB.failRelease = false; DB.clock += DB.WINDOW + 1;
    const laptop = await mount("laptop", 0);
    fireEvent.click(within(await laptop.findByTestId("ps-orphan-card")).getByTestId("ps-orphan-putback"));
    await waitFor(() => expect(DB.rows.every((r) => r.status === "confirmed")).toBe(true));
  });

  it("delivery can't be recorded (offline after the download) → 'not confirmed' note + orphan card, no Undo", async () => {
    confirmExportDelivered.mockResolvedValueOnce({ ok: false, n: 0 });
    const laptop = await mount("laptop");
    laptopExport(laptop);
    await laptop.findByTestId("ps-unconfirmed");
    expect(laptop.getByTestId("ps-orphan-card").textContent).toContain("3");
    expect(laptop.queryByTestId("ps-undo-btn")).toBeNull();
    fireEvent.click(within(laptop.getByTestId("ps-orphan-card")).getByTestId("ps-orphan-sent")); // "It went out" (back online)
    await waitFor(() => expect(laptop.queryByTestId("ps-orphan-card")).toBeNull());
    await laptop.findByTestId("ps-undo-btn");                      // now a normal, delivered latest export
  });
});
