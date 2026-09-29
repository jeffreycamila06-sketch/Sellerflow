// Pickup Status Stage 2 — on-demand "Check now". Pure helpers + the check card:
// Last checked comes ONLY from last_completed_at; the button is ready / busy / locked;
// status is re-read (fast interval in tests) only while a job is active; refusals get
// plain words; the urgent link appears only when a parcel is due today/tomorrow; the
// Stale chip marks rows not checked for 24h+; Sync with new parcels says they're being checked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import {
  checkButtonState, isStale, urgentEligible, formatTaipei,
  type TrackingStatus, type ParcelTrackingRow,
} from "../../adapters/parcelTracking";

const { loadParcelTracking, loadTrackingStatus, requestCheck, syncFromExport } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(), loadTrackingStatus: vi.fn(), requestCheck: vi.fn(), syncFromExport: vi.fn(),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadTrackingStatus, requestCheck, CHECK_POLL_MS: 30 };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport }));

import ParcelTracking from "../ParcelTracking";

const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const row = (id: string, over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id, trackingNo: `F${id}`, cmOrderNo: null, buyerUsername: "maria", recipientName: null, storeId: "S", recStore: null,
  status: "in_transit", statusMessage: null, pickupDeadline: null, arrivedAt: null, shipType: "C2C", specialType: null,
  terminal: false, lastPolledAt: ago(2), ...over,
});
const st = (over: Partial<TrackingStatus> = {}): TrackingStatus => ({
  last_completed_at: null, next_available_at: null, used_today: false, urgent_used_today: false, active_job: null, last_job: null, ...over,
});
const withRows = (rows: ParcelTrackingRow[]) =>
  loadParcelTracking.mockResolvedValue({ ok: true, rows, totals: { all: rows.length, picked: 0, returned: 0, live: rows.length, waiting: 0, transit: rows.length } });
const view = () => render(<TProvider lang="en"><ParcelTracking /></TProvider>);

beforeEach(() => {
  loadParcelTracking.mockReset(); withRows([row("a")]);
  loadTrackingStatus.mockReset(); loadTrackingStatus.mockResolvedValue(st());
  requestCheck.mockReset(); requestCheck.mockResolvedValue({ ok: true, reason: "queued" });
  syncFromExport.mockReset();
});

describe("pure helpers", () => {
  it("checkButtonState: busy while a job is active, locked until next_available_at, else ready", () => {
    expect(checkButtonState(null, NOW)).toEqual({ kind: "ready" });
    expect(checkButtonState(st(), NOW)).toEqual({ kind: "ready" });
    expect(checkButtonState(st({ active_job: { id: "j", kind: "manual", status: "queued" } }), NOW)).toEqual({ kind: "busy" });
    const later = new Date(NOW + 3600_000).toISOString();
    expect(checkButtonState(st({ next_available_at: later }), NOW)).toEqual({ kind: "locked", nextAt: later });
    expect(checkButtonState(st({ next_available_at: ago(1) }), NOW)).toEqual({ kind: "ready" });
  });
  it("isStale: live rows last checked 24h+ ago only", () => {
    expect(isStale(row("a", { lastPolledAt: ago(30) }), NOW)).toBe(true);
    expect(isStale(row("a", { lastPolledAt: ago(2) }), NOW)).toBe(false);
    expect(isStale(row("a", { lastPolledAt: ago(30), terminal: true }), NOW)).toBe(false);
    expect(isStale(row("a", { lastPolledAt: null, status: "created" }), NOW)).toBe(false);
  });
  it("urgentEligible: an at-store live parcel due today/tomorrow (or overdue)", () => {
    const today = "2026-09-29";
    expect(urgentEligible([row("a", { status: "at_store", pickupDeadline: "2026-09-30" })], today)).toBe(true);
    expect(urgentEligible([row("a", { status: "at_store", pickupDeadline: "2026-09-28" })], today)).toBe(true);
    expect(urgentEligible([row("a", { status: "at_store", pickupDeadline: "2026-10-01" })], today)).toBe(false);
    expect(urgentEligible([row("a", { status: "in_transit", pickupDeadline: "2026-09-29" })], today)).toBe(false);
  });
  it("formatTaipei: MM/DD HH:mm in Taipei time", () => {
    expect(formatTaipei("2026-09-29T16:00:00Z")).toBe("09/30 00:00");
    expect(formatTaipei(null)).toBe("");
  });
});

describe("check card", () => {
  it("Last checked comes ONLY from last_completed_at (never a job's requested_at)", async () => {
    loadTrackingStatus.mockResolvedValue(st({ active_job: { id: "j", kind: "manual", status: "queued", requested_at: ago(0) } }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-last-checked").textContent).toBe("Not checked yet"));

    loadTrackingStatus.mockResolvedValue(st({ last_completed_at: "2026-09-29T02:05:00Z" }));
    const r2 = view();
    await waitFor(() => expect(r2.getAllByTestId("pt-last-checked")[1].textContent).toBe("Last checked 09/29 10:05"));
  });

  it("ready → press → requests a manual check → shows Checking… (disabled)", async () => {
    const r = view();
    const b = await r.findByTestId("pt-check-now");
    await waitFor(() => expect(b.getAttribute("data-state")).toBe("ready"));
    loadTrackingStatus.mockResolvedValue(st({ active_job: { id: "j", kind: "manual", status: "queued" } }));
    fireEvent.click(b);
    await waitFor(() => expect(r.getByTestId("pt-check-now").textContent).toBe("Checking…"));
    expect(requestCheck).toHaveBeenCalledWith("manual");
    expect((r.getByTestId("pt-check-now") as HTMLButtonElement).disabled).toBe(true);
  });

  it("locked → disabled with the next available time", async () => {
    loadTrackingStatus.mockResolvedValue(st({ used_today: true, next_available_at: "2099-09-29T16:00:00Z" }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-check-now").getAttribute("data-state")).toBe("locked"));
    expect((r.getByTestId("pt-check-now") as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByTestId("pt-check-sub").textContent).toBe("Next check available 09/30 00:00");
  });

  it("while busy, re-reads status; when the job ends it shows the real counts and re-reads parcels", async () => {
    loadTrackingStatus
      .mockResolvedValueOnce(st({ active_job: { id: "j", kind: "manual", status: "running" } }))
      .mockResolvedValue(st({ last_completed_at: ago(0), last_job: { id: "j", kind: "manual", status: "done", error: null, parcels_checked: 5, parcels_total: 6 } }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toBe("Updated 5 of 6 parcels"));
    expect(loadParcelTracking).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(r.getByTestId("pt-check-now").textContent).toBe("Check now"));
  });

  it("a partial job says the rest comes next time", async () => {
    loadTrackingStatus
      .mockResolvedValueOnce(st({ active_job: { id: "j", kind: "manual", status: "running" } }))
      .mockResolvedValue(st({ last_job: { id: "j", kind: "manual", status: "done", error: "partial", parcels_checked: 40, parcels_total: 300 } }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toBe("Updated 40 of 300 parcels — the rest on the next check"));
  });

  it("a job that had nothing to check says so (not \"Updated 0 of 0\") and the button is ready again", async () => {
    loadTrackingStatus
      .mockResolvedValueOnce(st({ active_job: { id: "j", kind: "manual", status: "running" } }))
      .mockResolvedValue(st({ last_job: { id: "j", kind: "manual", status: "done", error: null, parcels_checked: 0, parcels_total: 0 } }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toBe("Nothing to check yet — all parcels were checked recently"));
    await waitFor(() => expect(r.getByTestId("pt-check-now").getAttribute("data-state")).toBe("ready"));
  });

  it("no polling when nothing is running", async () => {
    view();
    await new Promise((res) => setTimeout(res, 120));
    expect(loadTrackingStatus).toHaveBeenCalledTimes(1);
  });

  it("refusals get plain words", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ok: false, reason: "too_soon", next_available_at: "2099-09-29T16:00:00Z" }, "Next check available 09/30 00:00"],
      [{ ok: false, reason: "already_queued" }, "A check is already running."],
      [{ ok: false, reason: "disabled" }, "Checking is paused right now. Please try again later."],
      [{ ok: false, reason: "error" }, "Couldn't start the check. Please try again."],
    ];
    for (const [res, text] of cases) {
      requestCheck.mockResolvedValueOnce(res);
      const r = view();
      const b = await r.findByTestId("pt-check-now");
      await waitFor(() => expect(b.getAttribute("data-state")).toBe("ready"));
      fireEvent.click(b);
      await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toBe(text));
      r.unmount();
    }
  });

  it("urgent link: only when a parcel is due today/tomorrow and it wasn't used today", async () => {
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(NOW + 86400_000));
    withRows([row("u", { status: "at_store", pickupDeadline: tomorrow })]);
    const r = view();
    fireEvent.click(await r.findByTestId("pt-urgent"));
    await waitFor(() => expect(requestCheck).toHaveBeenCalledWith("urgent"));
    r.unmount();

    loadTrackingStatus.mockResolvedValue(st({ urgent_used_today: true }));
    const r2 = view();
    await r2.findByTestId("pt-check-card");
    expect(r2.queryByTestId("pt-urgent")).toBeNull();
    r2.unmount();

    loadTrackingStatus.mockResolvedValue(st());
    withRows([row("x", { status: "at_store", pickupDeadline: "2099-01-01" })]);
    const r3 = view();
    await r3.findByTestId("pt-check-card");
    expect(r3.queryByTestId("pt-urgent")).toBeNull();
  });

  it("Stale chip on rows not checked for 24h+", async () => {
    withRows([row("old", { lastPolledAt: ago(30), buyerUsername: "old" }), row("new", { lastPolledAt: ago(1), buyerUsername: "new" })]);
    const r = view();
    fireEvent.click(await r.findByTestId("pt-tab-all"));
    await waitFor(() => expect(r.getAllByTestId("pt-stale")).toHaveLength(1));
    expect(r.getByTestId("pt-stale").textContent).toBe("Not checked 24h+");
  });

  it("Sync with new parcels says they're being checked and shows Checking…", async () => {
    syncFromExport.mockResolvedValue({ ok: true, total: 2, fresh: 2, updated: 0, same: 0, withoutHandle: 0 });
    const r = view();
    await r.findByTestId("pt-check-card");
    loadTrackingStatus.mockResolvedValue(st({ active_job: { id: "j", kind: "new_parcels", status: "queued" } }));
    fireEvent.change(r.getByTestId("pt-sync-file"), { target: { files: [new File([new Uint8Array([1])], "x.xlsx")] } });
    await waitFor(() => expect(r.getByTestId("pt-toast").textContent).toContain("New parcels are being checked now."));
    await waitFor(() => expect(r.getByTestId("pt-check-now").textContent).toBe("Checking…"));
  });

  it("the card wraps on a phone (375px-safe)", async () => {
    const r = view();
    const c = await r.findByTestId("pt-check-card");
    expect(c.style.flexWrap).toBe("wrap");
  });
});
