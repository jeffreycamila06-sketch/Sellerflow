// Pickup Status "Sync from 賣貨便" — the button/how-to card render + the upload flow
// (file pick → syncFromExport → result toast → reload). loadParcelTracking + the reader
// are mocked; this pins the screen wiring, not the parse (covered by parcelExportRead.test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { loadParcelTracking, syncFromExport } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(async () => ({ ok: true, rows: [] as unknown[] })),
  syncFromExport: vi.fn(async () => ({ ok: true, synced: 2, totalRows: 3, without: 1 })),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport }));

import ParcelTracking from "../ParcelTracking";

const view = () => render(<TProvider><ParcelTracking /></TProvider>);
const pickFile = (r: ReturnType<typeof view>) => {
  const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "賣貨便_訂單資訊.xlsx");
  fireEvent.change(r.getByTestId("pt-sync-file"), { target: { files: [file] } });
};

beforeEach(() => {
  loadParcelTracking.mockClear(); loadParcelTracking.mockResolvedValue({ ok: true, rows: [] });
  syncFromExport.mockClear();
});

describe("Pickup Status — Sync from 賣貨便", () => {
  it("renders the Sync button + hint card; the how-to steps toggle open", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    expect(r.getByTestId("pt-sync-card")).toBeTruthy();
    expect(r.queryByTestId("pt-sync-how")).toBeNull();        // collapsed by default
    fireEvent.click(r.getByTestId("pt-sync-how-toggle"));
    expect(r.getByTestId("pt-sync-how")).toBeTruthy();         // 4 steps now shown
  });

  it("picking a file → syncFromExport runs → success toast with counts + reloads", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    loadParcelTracking.mockClear();                            // ignore the mount load
    pickFile(r);
    await waitFor(() => expect(syncFromExport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toContain("2")); // "2 usernames synced · 3 rows · 1 without"
    expect(loadParcelTracking).toHaveBeenCalled();            // re-read so handles show
  });

  it("empty file → 'no 訂單匯入 rows' notice, no reload", async () => {
    syncFromExport.mockResolvedValueOnce({ ok: true, synced: 0, totalRows: 0, without: 0, empty: true });
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    loadParcelTracking.mockClear();
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-toast")).toBeTruthy());
    expect(loadParcelTracking).not.toHaveBeenCalled();
  });

  it("malformed file → error toast, no reload", async () => {
    syncFromExport.mockResolvedValueOnce({ ok: false, synced: 0, totalRows: 0, without: 0, error: "not_xlsx" });
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-sync")).toBeTruthy());
    loadParcelTracking.mockClear();
    pickFile(r);
    await waitFor(() => expect(r.getByTestId("pt-toast")).toBeTruthy());
    expect(loadParcelTracking).not.toHaveBeenCalled();
  });
});
