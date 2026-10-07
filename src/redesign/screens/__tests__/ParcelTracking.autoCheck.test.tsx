// Entering Pickup Status asks for an automatic check; a queued one re-reads the status.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { loadParcelTracking, loadTrackingStatus, requestAutoCheck } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(), loadTrackingStatus: vi.fn(), requestAutoCheck: vi.fn(),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadTrackingStatus, requestAutoCheck };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
import ParcelTracking from "../ParcelTracking";

const st = { last_completed_at: null, next_available_at: null, used_today: false, urgent_used_today: false, active_job: null, last_job: null };
beforeEach(() => {
  loadParcelTracking.mockReset().mockResolvedValue({ ok: true, rows: [], totals: { all: 0, picked: 0, returned: 0, live: 0, waiting: 0, transit: 0 } });
  loadTrackingStatus.mockReset().mockResolvedValue(st);
  requestAutoCheck.mockReset();
});
const view = (userId?: string) => render(<TProvider lang="en"><ParcelTracking userId={userId} /></TProvider>);

describe("Pickup Status: automatic check on entry", () => {
  it("asks with the signed-in user; 'queued' re-reads the status", async () => {
    requestAutoCheck.mockResolvedValue("queued");
    view("U1");
    await waitFor(() => expect(requestAutoCheck).toHaveBeenCalledWith("U1"));
    await waitFor(() => expect(loadTrackingStatus).toHaveBeenCalledTimes(2));
  });
  it("any other answer leaves the status alone", async () => {
    requestAutoCheck.mockResolvedValue("throttled");
    view("U1");
    await waitFor(() => expect(requestAutoCheck).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(loadTrackingStatus).toHaveBeenCalledTimes(1);
  });
  it("no user → no ask", async () => {
    view();
    await new Promise((r) => setTimeout(r, 0));
    expect(requestAutoCheck).not.toHaveBeenCalled();
  });
});
