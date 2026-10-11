// Pickup Status + 全家 (sql/119). Switch off → no 全家 button, no label, loads called without
// the fm flag (the select stays the pre-全家 one). Switch on → "Sync from 全家", a 7-11 / 全家
// label per row, wrong file → "This isn't a 全家 Order export".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const row = (id: string, carrier?: "711" | "fm") => ({ id, trackingNo: id, cmOrderNo: null, buyerUsername: "maria", recipientName: null, storeId: "S", recStore: null, status: "at_store", statusMessage: null, pickupDeadline: "2026-12-30", arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, ...(carrier ? { carrier } : {}) });
const { loadParcelTracking, uploadFmExport } = vi.hoisted(() => ({ loadParcelTracking: vi.fn(), uploadFmExport: vi.fn() }));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking };
});
vi.mock("../../adapters/fmPickup", () => ({ uploadFmExport }));

import ParcelTracking from "../ParcelTracking";

const totals = { all: 2, picked: 0, returned: 0, live: 2, waiting: 2, transit: 0 };
beforeEach(() => { loadParcelTracking.mockReset(); uploadFmExport.mockReset(); });

describe("Pickup Status — 全家", () => {
  it("switch off: no 全家 button, no carrier label, loads without the fm flag", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [row("F1")], totals });
    const r = render(<TProvider lang="en"><ParcelTracking /></TProvider>);
    await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBeGreaterThan(0));
    expect(r.queryByTestId("pt-fm-sync")).toBeNull();
    expect(r.queryByTestId("pt-fm-sync-file")).toBeNull();
    expect(r.queryByTestId("pt-carrier")).toBeNull();
    expect(loadParcelTracking).toHaveBeenCalledWith(); // same call as before 全家
  });

  it("switch on: button + one combined list with 7-11 / 全家 labels", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [row("F1", "711"), row("L26A", "fm")], totals });
    const r = render(<TProvider lang="en"><ParcelTracking fm /></TProvider>);
    await waitFor(() => expect(r.getAllByTestId("pt-carrier").length).toBeGreaterThan(0));
    expect(loadParcelTracking).toHaveBeenCalledWith(true);
    expect(r.getByTestId("pt-fm-sync").textContent).toBe("Sync from 全家");
    const labels = r.getAllByTestId("pt-carrier").map((e) => e.textContent);
    expect(labels).toContain("7-11");
    expect(labels).toContain("全家");
  });

  it("wrong file → 'This isn't a 全家 Order export'; success → toast + reload", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [row("F1", "711")], totals });
    const r = render(<TProvider lang="en"><ParcelTracking fm /></TProvider>);
    await waitFor(() => expect(r.getByTestId("pt-fm-sync")).toBeTruthy());
    const pick = () => fireEvent.change(r.getByTestId("pt-fm-sync-file"), { target: { files: [new File([new Uint8Array([1])], "x.xlsx")] } });
    uploadFmExport.mockResolvedValueOnce({ ok: false, error: "not_fm_export" });
    pick();
    await waitFor(() => expect(r.getByTestId("pt-sync-error").textContent).toContain("This isn't a 全家 Order export."));
    loadParcelTracking.mockClear();
    uploadFmExport.mockResolvedValueOnce({ ok: true, inserted: 3, updated: 1, hidden: 0 });
    pick();
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toBe("全家: 3 new, 1 updated."));
    expect(loadParcelTracking).toHaveBeenCalledWith(true);
  });
});
