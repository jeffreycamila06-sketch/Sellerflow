// Pickup Status "Sync from 賣貨便" — screen wiring for the upload flow (Stage 1b):
// every failure cause shows its own plain-words message (S4) and stays until ✕ / the
// next upload; a no-op re-upload says "already synced, 0 new" (S5); the empty state is
// a 3-step card with the Sync button right there (N2). loadParcelTracking + the reader
// are mocked; the parse/write rules are covered by parcelExportUpload.test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { SyncResult } from "../../adapters/parcelExportRead";

const ok = (over: Partial<SyncResult> = {}): SyncResult => ({ ok: true, total: 3, fresh: 2, updated: 1, same: 0, withoutHandle: 1, ...over });
const fail = (over: Partial<SyncResult>): SyncResult => ({ ok: false, total: 3, fresh: 0, updated: 0, same: 0, withoutHandle: 0, ...over });

const ONE_ROW = [{ id: "r1", trackingNo: "F1", cmOrderNo: null, buyerUsername: "maria", recipientName: null, storeId: "S", recStore: null, status: "at_store", statusMessage: null, pickupDeadline: "2026-09-30", arrivedAt: null, shipType: "C2C", specialType: null, terminal: false }];
const { loadParcelTracking, syncFromExport } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(),
  syncFromExport: vi.fn(),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport }));

import ParcelTracking from "../ParcelTracking";

const view = () => render(<TProvider lang="en"><ParcelTracking /></TProvider>);
const pickFile = (r: ReturnType<typeof view>) => {
  const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "賣貨便_訂單資訊.xlsx");
  fireEvent.change(r.getByTestId("pt-sync-file"), { target: { files: [file] } });
};
const withRows = () => loadParcelTracking.mockResolvedValue({ ok: true, rows: ONE_ROW, totals: { all: 1, picked: 0, returned: 0, live: 1, waiting: 1, transit: 0 } });
const empty = () => loadParcelTracking.mockResolvedValue({ ok: true, rows: [], totals: { all: 0, picked: 0, returned: 0, live: 0, waiting: 0, transit: 0 } });

beforeEach(() => {
  loadParcelTracking.mockReset(); withRows();
  syncFromExport.mockReset(); syncFromExport.mockResolvedValue(ok());
});

describe("Pickup Status — Sync from 賣貨便", () => {
  it("renders the Sync button + hint card; the how-to steps toggle open", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync-card")).toBeTruthy());
    expect(r.queryByTestId("pt-sync-how")).toBeNull();
    fireEvent.click(r.getByTestId("pt-sync-how-toggle"));
    expect(r.getByTestId("pt-sync-how").textContent).toContain("checked automatically");
  });

  it("success → toast with new / updated / already-synced counts + reload", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    loadParcelTracking.mockClear();
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toBe("2 new · 1 updated · 0 already synced New parcels are being checked now."));
    expect(loadParcelTracking).toHaveBeenCalled();
    expect(r.queryByTestId("pt-sync-error")).toBeNull();
  });

  it("S5: re-upload of the same file → 'N parcels already synced, 0 new', no reload", async () => {
    syncFromExport.mockResolvedValueOnce(ok({ fresh: 0, updated: 0, same: 3 }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    loadParcelTracking.mockClear();
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toBe("3 parcels already synced, 0 new"));
    expect(loadParcelTracking).not.toHaveBeenCalled();
  });

  const CASES: [string, SyncResult, string][] = [
    ["signed_out", fail({ error: "signed_out" }), "Sign in again, then retry."],
    ["permission", fail({ error: "permission" }), "Your plan doesn't include Pickup Status."],
    ["partial", fail({ error: "partial", saved: 500, attempted: 600 }), "Saved 500 of 600 parcels — retry to save the rest."],
    ["no_codes", fail({ error: "no_codes" }), "賣貨便 hasn't assigned tracking numbers yet — export again after the parcels are shipped."],
    ["not_export", fail({ error: "not_export" }), "This isn't the 賣貨便 匯出報表 file. Export it from 賣貨便 → 訂單管理 → 匯出報表."],
    ["foreign", fail({ error: "foreign", foreign: 4 }), "This file is from a different 賣貨便 shop (4 of its parcels belong to another seller). Upload the export from your own shop."],
    ["network", fail({ error: "network" }), "Couldn't save — check your connection and try again."],
  ];
  for (const [name, res, text] of CASES) {
    it(`S4 ${name} → its own plain-words message, shown as a persistent alert`, async () => {
      syncFromExport.mockResolvedValueOnce(res);
      const r = view();
      await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
      pickFile(r);
      await waitFor(() => expect(r.getByTestId("pt-sync-error").textContent).toContain(text));
      expect(r.getByTestId("pt-sync-error").getAttribute("role")).toBe("alert");
      expect(r.getByTestId("pt-sync-error").textContent).not.toMatch(/couldn.t read the file/i);
    });
  }

  it("the reader throwing (e.g. file unreadable by the browser) → the network message, not a parse error", async () => {
    syncFromExport.mockRejectedValueOnce(new Error("boom"));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-sync-error").textContent).toContain("Couldn't save"));
  });

  it("the alert stays until ✕, and a new upload clears it", async () => {
    syncFromExport.mockResolvedValueOnce(fail({ error: "not_export" }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-sync-error")).toBeTruthy());
    fireEvent.click(r.getByLabelText("Dismiss"));
    expect(r.queryByTestId("pt-sync-error")).toBeNull();
    syncFromExport.mockResolvedValueOnce(fail({ error: "no_codes" }));
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-sync-error").textContent).toContain("hasn't assigned"));
    pickFile(r); // default mock = success
    await waitFor(() => expect(r.queryByTestId("pt-sync-error")).toBeNull());
  });

  it("partial → reloads so the parcels that DID save show up", async () => {
    syncFromExport.mockResolvedValueOnce(fail({ error: "partial", saved: 1, attempted: 3 }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    loadParcelTracking.mockClear();
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-sync-error")).toBeTruthy());
    expect(loadParcelTracking).toHaveBeenCalled();
  });
});

describe("N2 — empty state: 3 steps + the Sync button right there", () => {
  it("0 parcels → the 3-step card with its own Sync button; the hint card is hidden", async () => {
    empty();
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-empty")).toBeTruthy());
    const steps = r.getByTestId("pt-empty-steps").querySelectorAll("li");
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toContain("匯出報表");
    expect(steps[1].textContent).toContain("Sync from 賣貨便");
    expect(steps[2].textContent).toContain("checked automatically");
    expect(r.queryByTestId("pt-sync-card")).toBeNull();
    expect(r.getByTestId("pt-empty-sync").textContent).toBe("Sync from 賣貨便");
  });

  it("the empty-state Sync button opens the same file picker", async () => {
    empty();
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-empty-sync")).toBeTruthy());
    const input = r.getByTestId("pt-sync-file") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(r.getByTestId("pt-empty-sync"));
    expect(click).toHaveBeenCalled();
  });

  it("with parcels → no empty card", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync-card")).toBeTruthy());
    expect(r.queryByTestId("pt-empty")).toBeNull();
  });
});

describe("i18n — Stage 1b strings filled in all 8 languages; replaced keys removed", () => {
  it("every new key is non-empty in every language, placeholders intact", async () => {
    const { buildT } = await import("../../i18n");
    const { LANGS } = await import("../../data");
    const keys = ["rd_pt_err_signed_out", "rd_pt_err_permission", "rd_pt_err_partial", "rd_pt_err_no_codes", "rd_pt_err_not_export",
      "rd_pt_err_foreign", "rd_pt_err_network", "rd_pt_sync_noop", "rd_pt_sync_done2", "rd_pt_load_more", "rd_pt_copy", "rd_pt_copy_code",
      "rd_pt_empty_title", "rd_pt_empty_s1", "rd_pt_empty_s2", "rd_pt_empty_s3", "rd_pt_dismiss"];
    const placeholders: Record<string, string[]> = {
      rd_pt_err_partial: ["{n}", "{m}"], rd_pt_err_foreign: ["{n}"], rd_pt_sync_noop: ["{n}"],
      rd_pt_sync_done2: ["{new}", "{updated}", "{same}"], rd_pt_load_more: ["{n}"],
    };
    expect(LANGS.length).toBe(8);
    for (const { code } of LANGS) {
      const t = buildT(code) as Record<string, string>;
      for (const k of keys) {
        expect((t[k] || "").trim().length, `${k}/${code}`).toBeGreaterThan(0);
        for (const ph of placeholders[k] ?? []) expect(t[k], `${k}/${code}`).toContain(ph);
      }
      for (const gone of ["rd_pt_sync_err", "rd_pt_sync_done", "rd_pt_empty"]) expect(t[gone], `${gone}/${code}`).toBeUndefined();
    }
  });
});
