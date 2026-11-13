// Parcel Scan FamilyMart — store # check (sql/155): the 7-11 wrong-store-code flow on the
// FamilyMart screen, plus Fix Round 1 (the checks never stop silently; only real answers are kept)
// and Fix Round 2 (Export is never disabled by a check; a stop sets everything aside; off = forgotten).
// The switch-off proof with the REAL fmScan adapter is in FmParcelScan.storeCheckOff.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TProvider } from "../../i18n";

const m = vi.hoisted(() => ({
  saveFmScan: vi.fn(), loadFmScans: vi.fn(), deliverFmFiles: vi.fn(), markFmExported: vi.fn(), loadFmGlobalFee: vi.fn(), haptic: vi.fn(),
}));
vi.mock("../../../supabase", async () => (await import("./fmFakeSupabase")).fakeSupabaseModule);
vi.mock("../../adapters/fmScan", async (orig) => {
  const actual = await orig<typeof import("../../adapters/fmScan")>();
  return { ...actual, saveFmScan: m.saveFmScan, loadFmScans: m.loadFmScans, deliverFmFiles: m.deliverFmFiles, markFmExported: m.markFmExported, loadFmGlobalFee: m.loadFmGlobalFee };
});
vi.mock("../../adapters/camera", async (orig) => ({ ...(await orig<typeof import("../../adapters/camera")>()), triggerHaptic: m.haptic }));
vi.mock("../../adapters/fmCustomers", () => ({
  loadRecentFmCustomers: async () => ({ ok: true, rows: [] }), searchFmCustomers: async () => ({ ok: true, rows: [] }),
  countFmCustomers: async () => ({ ok: true, count: 0 }), updateFmCustomer: async () => ({ ok: true }), deleteFmCustomer: async () => ({ ok: true }),
}));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-11" }));

import FmParcelScan from "../FmParcelScan";
import { fake } from "./fmFakeSupabase";
import type { FmScanRow } from "../../adapters/fmScan";
import { askFmStore, fmStoreCheckVisible, useFmStoreChecks, FM_STORE_CHECK_GIVE_UP_MS, FM_STORE_CHECK_BACKLOG_MAX } from "../../adapters/fmStoreCheck";

const row = (id: string, extra = {}): FmScanRow => ({ id, recipientName: `Buyer ${id}`, phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-10-11", buyerUsername: "@x", createdAt: "2026-10-11T03:00:00Z", exportedAt: null, exportBatchId: null, ...extra });
const answer = (status: string) => ({ ok: true, json: async () => ({ success: true, status }) });
const fetchMock = vi.fn();
const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body);
const screen = (on: boolean) => render(<TProvider lang="en"><FmParcelScan storeCheckOn={on} /></TProvider>);
type R = ReturnType<typeof render>;
const rowEl = (r: R, id: string) => r.container.querySelector(`[data-row-id="${id}"]`)!;
const badgeOf = (r: R, id: string) => rowEl(r, id)?.querySelector('[data-testid="fms-store-badge"]');
const recheckOf = (r: R, id: string) => rowEl(r, id).querySelector('[data-testid="fms-recheck"]') as HTMLElement;
const exportBtn = (r: R) => r.getByTestId("fms-export-btn") as HTMLButtonElement;
const checkWrites = () => fake.writes().filter((w) => "store_check_status" in w);
// every row is on screen and none is waiting for / in a check
const settled = (r: R) => waitFor(() => { expect(r.container.querySelector("[data-row-id]")).not.toBeNull(); expect(r.container.textContent).not.toContain("Checking store…"); });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  fetchMock.mockReset();
  fake.reset();
  vi.stubGlobal("fetch", fetchMock);
  m.loadFmGlobalFee.mockResolvedValue(39);
  m.deliverFmFiles.mockResolvedValue({ ok: true });
  m.markFmExported.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("gate", () => {
  it("on = the switch OR the login key; neither = off", () => {
    expect(fmStoreCheckVisible({ switchOn: false, previewKey: false })).toBe(false);
    expect(fmStoreCheckVisible({ switchOn: true, previewKey: false })).toBe(true);
    expect(fmStoreCheckVisible({ switchOn: false, previewKey: true })).toBe(true);
  });
});

describe("switch off and not listed = the screen as before", () => {
  it("no server call, the list read as before, no label, no attention half, three tabs", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a"), row("b", { storeCheckStatus: "not_found" })] });
    const r = screen(false);
    await waitFor(() => expect(r.getAllByTestId("fms-row").length).toBe(2));
    expect(m.loadFmScans).toHaveBeenCalledTimes(1);
    expect(m.loadFmScans).toHaveBeenCalledWith(); // no extra columns asked
    expect(fetchMock).not.toHaveBeenCalled();
    for (const id of ["fms-store-badge", "fms-store-ok", "fms-recheck", "fms-attn", "fms-attn-toast", "fms-tab-wrong", "fms-tab-attention"]) expect(r.queryByTestId(id)).toBeNull();
    expect(r.getByTestId("fms-tabs").querySelectorAll("button").length).toBe(3);
    expect(rowEl(r, "b").getAttribute("data-flag")).toBe("");
    expect(r.getByTestId("fms-batch").style.flex).toBe("0 1 50%");
    expect(exportBtn(r).textContent).toContain("2"); // the not_found row is still exported, as before
    expect(fake.text()).toBe("[]");
  });
});

describe("switch on — the row, the top bar, the alert, the tabs, the export", () => {
  it("valid = '✅ Store OK'; not_found = '❌ Wrong store code' + red row + Re-check; an exported row has no label; no alert for what was already saved", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" }), row("n", { storeCheckStatus: "not_found", storeId: "015905" }), row("x", { exportedAt: "2026-10-11T04:00:00Z", exportBatchId: "b1" })] });
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-store-ok")).not.toBeNull());
    expect(m.loadFmScans).toHaveBeenCalledWith(true);
    expect(fetchMock).not.toHaveBeenCalled(); // every not-exported row already has an answer
    expect(badgeOf(r, "v")).toBeNull();
    expect(rowEl(r, "v").querySelector('[data-testid="fms-store-ok"]')!.textContent).toBe("✅ Store OK");
    expect(badgeOf(r, "n")!.textContent).toContain("❌ Wrong store code");
    expect(rowEl(r, "n").getAttribute("data-flag")).toBe("red");
    expect(recheckOf(r, "n").textContent).toBe("Re-check");
    expect(r.getAllByTestId("fms-store-ok").length).toBe(1);
    expect(badgeOf(r, "x")).toBeNull();
    expect(r.queryByTestId("fms-attn-toast")).toBeNull();
  });

  it("opening the screen checks a row with no answer: '⏳ Checking store…', Export stays enabled, then the answer + the alert once; the answer is written WITH its store #", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((res) => { release = res; }));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("p", { storeId: "015905" }), row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await waitFor(() => expect(badgeOf(r, "p")?.textContent).toContain("Checking store"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(0)).toEqual({ storeId: "015905" });
    expect(exportBtn(r).disabled).toBe(false); // 3a: a check never disables Export
    expect(exportBtn(r).textContent).not.toContain("Checking");
    expect(r.getByTestId("fms-attn").getAttribute("data-state")).toBe("ok");
    await act(async () => { release(answer("not_found")); });
    await waitFor(() => expect(badgeOf(r, "p")?.textContent).toContain("Wrong store code"));
    expect(r.getByTestId("fms-attn-toast").textContent).toBe("⚠ wrong store code · 015905");
    expect(m.haptic).toHaveBeenCalledTimes(1);
    expect(r.getByTestId("fms-attn").textContent).toBe("⚠ 1 need attention");
    await settled(r);
    expect(exportBtn(r).textContent).toContain("1"); // only the valid one
    await waitFor(() => expect(checkWrites().length).toBe(1));
    expect(checkWrites()[0]).toMatchObject({ store_check_status: "not_found", store_check_store_id: "015905" });
  });

  it("attention half + tabs: tap the red half → the attention filter and the first problem highlighted; 'Wrong code · n'; all good → '✓ All OK'", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" }), row("n", { storeCheckStatus: "not_found" })] });
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-attn").getAttribute("data-state")).toBe("problem"));
    expect(r.getByTestId("fms-tab-wrong").textContent).toBe("Wrong code · 1");
    fireEvent.click(r.getByTestId("fms-attn"));
    expect(r.getByTestId("fms-tab-attention").getAttribute("aria-pressed")).toBe("true");
    expect(r.getAllByTestId("fms-row").length).toBe(1);
    expect(rowEl(r, "n").getAttribute("data-highlight")).toBe("1");
    r.unmount();
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" })] });
    const r2 = screen(true);
    await waitFor(() => expect(r2.getByTestId("fms-attn").textContent).toBe("✓ All OK"));
    fireEvent.click(r2.getByTestId("fms-tab-wrong"));
    expect(r2.getByTestId("fms-wrong-empty")).not.toBeNull();
  });

  it("export: a wrong store code is not in the file and is listed with its reason; an unverified row is exported", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" }), row("n", { storeCheckStatus: "not_found" }), row("u")] });
    const r = screen(true);
    await waitFor(() => expect(badgeOf(r, "u")?.textContent).toContain("Can't verify store"));
    await settled(r);
    fireEvent.click(exportBtn(r));
    fireEvent.click(r.getByTestId("fms-confirm-export"));
    await waitFor(() => expect(m.markFmExported).toHaveBeenCalled());
    expect(m.markFmExported.mock.calls[0][0]).toEqual(["v", "u"]);
    await waitFor(() => expect(r.getByTestId("fms-export-summary")).not.toBeNull());
    const attn = r.getAllByTestId("fms-export-attn-row");
    expect(attn.length).toBe(1);
    expect(attn[0].textContent).toBe("Buyer nwrong store code");
  });

  it("'Store OK' exists in all 8 languages (Filipino: 'OK ang store'); the row never says 'Buyer OK'", async () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" })] });
      const r = render(<TProvider lang={lang}><FmParcelScan storeCheckOn /></TProvider>);
      await waitFor(() => expect(r.getByTestId("fms-store-ok").textContent!.length).toBeGreaterThan(3));
      expect(r.getByTestId("fms-store-ok").textContent).not.toContain("Buyer OK");
      if (lang === "fil") expect(r.getByTestId("fms-store-ok").textContent).toBe("✅ OK ang store");
      r.unmount();
    }
  });
});

describe("2 — the checks never stop silently", () => {
  it("2a the cap of 60 counts the backlog only: rows past it say 'Can't verify store' + Re-check; a Re-check and a newly saved parcel are still asked", async () => {
    expect(FM_STORE_CHECK_BACKLOG_MAX).toBe(60);
    fetchMock.mockImplementation(async () => answer("valid"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: Array.from({ length: 62 }, (_x, i) => row(`b${i}`)) });
    m.saveFmScan.mockImplementation(async (input: { storeId: string }) => ({ ok: true, row: row("fresh1", { storeId: input.storeId }) }));
    const r = render(<TProvider lang="en"><FmParcelScan storeCheckOn pendingCap={100} /></TProvider>);
    await waitFor(() => expect(r.getAllByTestId("fms-store-ok").length).toBe(60), { timeout: 8000 });
    await settled(r);
    expect(fetchMock).toHaveBeenCalledTimes(60);
    for (const id of ["b60", "b61"]) { expect(badgeOf(r, id)!.textContent).toContain("Can't verify store"); expect(recheckOf(r, id)).not.toBeNull(); }
    expect(checkWrites().length).toBe(60);
    fireEvent.click(recheckOf(r, "b60"));
    await waitFor(() => expect(rowEl(r, "b60").querySelector('[data-testid="fms-store-ok"]')).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(61);
    expect(bodyOf(60)).toEqual({ storeId: "022131", fresh: true }); // a Re-check asks FamilyMart again
    fireEvent.click(r.getByTestId("fms-manual"));
    fireEvent.change(r.getByTestId("fms-name"), { target: { value: "New Buyer" } });
    fireEvent.change(r.getByTestId("fms-phone"), { target: { value: "0958704782" } });
    fireEvent.change(r.getByTestId("fms-store"), { target: { value: "015905" } });
    fireEvent.change(r.getByTestId("fms-amount"), { target: { value: "300" } });
    fireEvent.change(r.getByTestId("fms-username"), { target: { value: "@n" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(62));
    expect(bodyOf(61)).toEqual({ storeId: "015905" });
    await waitFor(() => expect(rowEl(r, "fresh1").querySelector('[data-testid="fms-store-ok"]')).not.toBeNull());
  }, 20000);

  it("2b + 2c two failures in a row (an 'unknown' answer counts) drop what is queued: the rest say 'Can't verify store', nothing is blocked; a Re-check is still asked, and its real answer lets the backlog go on", async () => {
    fetchMock.mockResolvedValueOnce(answer("unknown")).mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => answer("valid"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a"), row("b"), row("c"), row("d")] });
    const r = screen(true);
    await waitFor(() => expect(badgeOf(r, "d")?.textContent).toContain("Can't verify store"));
    await settled(r);
    expect(fetchMock).toHaveBeenCalledTimes(2); // c and d were never asked
    for (const id of ["a", "b", "c", "d"]) { expect(badgeOf(r, id)!.textContent).toContain("Can't verify store"); expect(recheckOf(r, id)).not.toBeNull(); }
    expect(exportBtn(r).textContent).toContain("4"); // not verified ≠ blocked
    expect(checkWrites().length).toBe(0); // 2d: a failure is never written
    fireEvent.click(recheckOf(r, "a"));
    await waitFor(() => expect(r.getAllByTestId("fms-store-ok").length).toBe(3)); // a, then c and d again
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(badgeOf(r, "b")!.textContent).toContain("Can't verify store"); // b was asked and failed: next open or Re-check
  });

  it("2d a Re-check that fails on a red row leaves it red and out of the file; nothing is written", async () => {
    fetchMock.mockResolvedValueOnce(answer("unknown")).mockRejectedValueOnce(new Error("offline"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("n", { storeCheckStatus: "not_found", storeId: "015905" }), row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await waitFor(() => expect(recheckOf(r, "n")).not.toBeNull());
    for (let i = 1; i <= 2; i++) {
      fireEvent.click(recheckOf(r, "n"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i));
      await waitFor(() => expect(badgeOf(r, "n")?.textContent).toContain("Wrong store code"));
      expect(rowEl(r, "n").getAttribute("data-flag")).toBe("red");
    }
    await settled(r);
    expect(exportBtn(r).textContent).toContain("1");
    expect(r.getByTestId("fms-attn").textContent).toBe("⚠ 1 need attention");
    expect(checkWrites().length).toBe(0);
  });

  it("2g the check turns on while the screen is open: the list is read again WITH the check columns before any check or label; an already-saved wrong code gives no alert", async () => {
    m.loadFmScans.mockResolvedValueOnce({ ok: true, rows: [row("n", { storeId: "015905" }), row("u")] });
    let give: (v: unknown) => void = () => {};
    m.loadFmScans.mockImplementationOnce(() => new Promise((res) => { give = res; }));
    fetchMock.mockImplementation(async () => answer("valid"));
    const r = screen(false);
    await waitFor(() => expect(r.getAllByTestId("fms-row").length).toBe(2));
    r.rerender(<TProvider lang="en"><FmParcelScan storeCheckOn /></TProvider>);
    await waitFor(() => expect(m.loadFmScans).toHaveBeenCalledTimes(2));
    expect(m.loadFmScans.mock.calls[1]).toEqual([true]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.queryByTestId("fms-store-badge")).toBeNull();
    expect(r.queryByTestId("fms-attn")).toBeNull();
    await act(async () => { give({ ok: true, rows: [row("n", { storeId: "015905", storeCheckStatus: "not_found" }), row("u")] }); });
    await waitFor(() => expect(badgeOf(r, "n")?.textContent).toContain("Wrong store code"));
    await waitFor(() => expect(rowEl(r, "u").querySelector('[data-testid="fms-store-ok"]')).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the row with no answer
    expect(r.queryByTestId("fms-attn-toast")).toBeNull();
    expect(m.haptic).not.toHaveBeenCalled();
  });

  it("Edit: the same store # keeps the answer (no call); a changed store # is checked again and the old red is gone only by a real answer", async () => {
    fetchMock.mockImplementation(async () => answer("valid"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("n", { storeCheckStatus: "not_found", storeId: "015905" })] });
    m.saveFmScan.mockImplementation(async (input: { storeId: string }, id: string) => ({ ok: true, row: row(id, { storeId: input.storeId }) }));
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-row-edit")).not.toBeNull());
    fireEvent.click(r.getByTestId("fms-row-edit"));
    fireEvent.click(r.getByTestId("fms-save")); // same store #
    await waitFor(() => expect(m.saveFmScan).toHaveBeenCalledTimes(1));
    expect(m.saveFmScan.mock.calls[0].length).toBeLessThanOrEqual(3); // no store-check argument on a save
    await waitFor(() => expect(badgeOf(r, "n")?.textContent).toContain("Wrong store code"));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(r.getByTestId("fms-row-edit"));
    fireEvent.change(r.getByTestId("fms-store"), { target: { value: "022131" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(r.getByTestId("fms-store-ok")).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).storeId).toBe("022131");
    expect(r.getByTestId("fms-attn").textContent).toBe("✓ All OK");
  });

  it("Edit: a wrong store # changed to ANOTHER wrong # is checked and stays red", async () => {
    fetchMock.mockImplementation(async () => answer("not_found"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("n", { storeCheckStatus: "not_found", storeId: "015905" })] });
    m.saveFmScan.mockImplementation(async (input: { storeId: string }, id: string) => ({ ok: true, row: row(id, { storeId: input.storeId }) }));
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-row-edit")).not.toBeNull());
    fireEvent.click(r.getByTestId("fms-row-edit"));
    fireEvent.change(r.getByTestId("fms-store"), { target: { value: "015906" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).storeId).toBe("015906");
    await waitFor(() => expect(badgeOf(r, "n")?.textContent).toContain("Wrong store code"));
    expect(rowEl(r, "n").getAttribute("data-flag")).toBe("red");
    expect(exportBtn(r).textContent).toContain("0");
  });
});

// ── Fix Round 2 ────────────────────────────────────────────────────────────────────────────
type Held = { storeId: string; res: (v: unknown) => void };
const holdFetch = () => {
  const held: Held[] = [];
  fetchMock.mockImplementation((_u: string, o: { body: string }) => new Promise((res) => { held.push({ storeId: JSON.parse(o.body).storeId, res }); }));
  return {
    held,
    asked: () => held.map((h) => h.storeId),
    until: (n: number) => waitFor(() => expect(held.length).toBe(n)),
    reply: (i: number, status: string) => act(async () => { held[i].res(answer(status)); }),
  };
};
const useH = (p: { on: boolean; ready: boolean; initial: FmScanRow[] }) => { const [rows, setRows] = useState(p.initial); return { rows, setRows, ...useFmStoreChecks(p.on, p.ready, rows, setRows) }; };
const hook = (initial: FmScanRow[]) => renderHook((p: { on: boolean; ready: boolean; initial: FmScanRow[] }) => useH(p), { initialProps: { on: true, ready: true, initial } });
const S = (n: number) => `02200${n}`;

describe("round 2 — the hook", () => {
  it("2a a stop sets EVERYTHING queued aside (NEW too); the first real answer puts it all back, NEW before BACKLOG", async () => {
    const f = holdFetch();
    const h = hook([row("b1", { storeId: S(1) }), row("b2", { storeId: S(2) }), row("b3", { storeId: S(3) }), row("v", { storeId: S(9), storeCheckStatus: "valid" })]);
    await f.until(1); // b1 is being asked
    act(() => { h.result.current.setRows((l) => [...l, row("n1", { storeId: S(4) }), row("n2", { storeId: S(5) })]); });
    await f.reply(0, "unknown"); await f.until(2);
    await f.reply(1, "unknown"); // second failure in a row → stop
    await waitFor(() => expect(h.result.current.busy.size).toBe(0));
    expect(f.asked()).toEqual([S(1), S(4)]);
    act(() => { h.result.current.recheck("v", S(9)); });
    await f.until(3); await f.reply(2, "valid"); // a real answer
    await f.until(4); await f.reply(3, "valid");
    await f.until(5); await f.reply(4, "valid");
    await f.until(6); await f.reply(5, "valid");
    expect(f.asked()).toEqual([S(1), S(4), S(9), S(5), S(2), S(3)]); // n2 (NEW) first, then the backlog
    await waitFor(() => expect(h.result.current.busy.size).toBe(0));
  });
  it("NEW is asked before BACKLOG", async () => {
    const f = holdFetch();
    const h = hook([row("b1", { storeId: S(1) }), row("b2", { storeId: S(2) })]);
    await f.until(1);
    act(() => { h.result.current.setRows((l) => [...l, row("n", { storeId: S(4) })]); });
    await f.reply(0, "valid"); await f.until(2); await f.reply(1, "valid"); await f.until(3);
    expect(f.asked()).toEqual([S(1), S(4), S(2)]);
  });
  it("2b the check turns off: the queue is forgotten; the check on its way writes nothing and asks nothing more", async () => {
    const f = holdFetch();
    const h = hook([row("a", { storeId: S(1) }), row("b", { storeId: S(2) })]);
    await f.until(1);
    expect(h.result.current.busy.size).toBe(2);
    h.rerender({ on: false, ready: false, initial: [] });
    expect(h.result.current.busy.size).toBe(0);
    await f.reply(0, "not_found");
    await new Promise((res) => setTimeout(res, 30));
    expect(f.held.length).toBe(1);
    expect(checkWrites().length).toBe(0);
    expect(h.result.current.rows.every((x) => x.storeCheckStatus === undefined)).toBe(true);
    // on again = a clean start: the same rows are a backlog again
    h.rerender({ on: true, ready: true, initial: [] });
    await f.until(2);
    expect(f.held[1].storeId).toBe(S(1));
  });
  it("2c an answer put back after a list re-read is written to the row again", async () => {
    const f = holdFetch();
    const h = hook([row("a", { storeId: S(1) })]);
    await f.until(1); await f.reply(0, "valid");
    await waitFor(() => expect(checkWrites().length).toBe(1));
    act(() => { h.result.current.setRows([row("a", { storeId: S(1) })]); }); // a re-read that raced the write
    await waitFor(() => expect(h.result.current.rows[0].storeCheckStatus).toBe("valid"));
    expect(checkWrites().length).toBe(2);
    expect(checkWrites()[1]).toMatchObject({ store_check_status: "valid", store_check_store_id: S(1) });
    expect(f.held.length).toBe(1); // not asked again
  });
  it("2d no flash: the parcel is 'being checked' in the same pass that shows it (queued before paint)", () => {
    holdFetch();
    const h = hook([row("a", { storeId: S(1) })]);
    expect(h.result.current.busy.has(`a:${S(1)}`)).toBe(true);
    act(() => { h.result.current.setRows((l) => [...l, row("n", { storeId: S(2) })]); });
    expect(h.result.current.busy.has(`n:${S(2)}`)).toBe(true);
    const src = readFileSync(resolve(__dirname, "../../adapters/fmStoreCheck.ts"), "utf8");
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{\n\s+rowsRef\.current = rows;/);
  });
  it("an answer that arrives after the store # changed is not applied", async () => {
    const f = holdFetch();
    const h = hook([row("a", { storeId: S(1) })]);
    await f.until(1);
    act(() => { h.result.current.setRows((l) => l.map((x) => ({ ...x, storeId: S(2) }))); });
    await f.reply(0, "not_found");
    await f.until(2); // the new store # is asked
    expect(f.held[1].storeId).toBe(S(2));
    expect(h.result.current.rows[0].storeCheckStatus).toBeUndefined();
  });
  it("a queued parcel that was deleted, exported or changed is not asked", async () => {
    const f = holdFetch();
    const h = hook([row("a", { storeId: S(1) }), row("del", { storeId: S(2) }), row("exp", { storeId: S(3) }), row("chg", { storeId: S(4) })]);
    await f.until(1);
    act(() => { h.result.current.setRows((l) => l.filter((x) => x.id !== "del").map((x) => (x.id === "exp" ? { ...x, exportedAt: "2026-10-11T04:00:00Z" } : x.id === "chg" ? { ...x, storeId: "12" } : x))); });
    await f.reply(0, "valid");
    await waitFor(() => expect(h.result.current.busy.size).toBe(0));
    expect(f.asked()).toEqual([S(1)]);
  });
  it("no write after the screen closes", async () => {
    const f = holdFetch();
    const h = hook([row("a", { storeId: S(1) }), row("b", { storeId: S(2) })]);
    await f.until(1);
    h.unmount();
    await f.reply(0, "not_found");
    await new Promise((res) => setTimeout(res, 30));
    expect(checkWrites().length).toBe(0);
    expect(f.held.length).toBe(1);
  });
});

describe("round 2 — the screen", () => {
  it("2b off then on again: the list is read again WITH the check columns before any check", async () => {
    fetchMock.mockImplementation(async () => answer("valid"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await waitFor(() => expect(rowEl(r, "v")?.querySelector('[data-testid="fms-store-ok"]')).not.toBeNull());
    r.rerender(<TProvider lang="en"><FmParcelScan storeCheckOn={false} /></TProvider>);
    await waitFor(() => expect(m.loadFmScans).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(r.queryByTestId("fms-store-ok")).toBeNull());
    let give: (v: unknown) => void = () => {};
    m.loadFmScans.mockImplementationOnce(() => new Promise((res) => { give = res; }));
    r.rerender(<TProvider lang="en"><FmParcelScan storeCheckOn /></TProvider>);
    await waitFor(() => expect(m.loadFmScans).toHaveBeenCalledTimes(3));
    expect(m.loadFmScans.mock.calls[2]).toEqual([true]);
    expect(r.queryByTestId("fms-store-badge")).toBeNull(); // nothing of the check before the list is read again
    expect(r.queryByTestId("fms-store-ok")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { give({ ok: true, rows: [row("v", { storeCheckStatus: "valid" })] }); });
    await waitFor(() => expect(r.queryByTestId("fms-store-ok")).not.toBeNull());
  });
  it("3b Export while parcels of the file are still being checked → the 7-11 question; Wait closes it; Export anyway goes on to the normal confirm", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never answers during this test
    // p1 + p2 would go into the file; bad breaks a FamilyMart rule (not in the file) → not counted
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("p1", { storeId: S(1) }), row("p2", { storeId: S(2) }), row("bad", { storeId: S(3), phone: "123" }), row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await waitFor(() => expect(badgeOf(r, "p1")?.textContent).toContain("Checking store"));
    fireEvent.click(exportBtn(r));
    expect(r.getByTestId("fms-pending-msg").textContent).toBe("2 parcel(s) are still being checked. Exported parcels won't be checked anymore. Wait a moment, or export anyway?");
    expect(r.getByTestId("fms-confirm-cancel").textContent).toBe("Wait");
    expect(r.queryByTestId("fms-confirm-export")).toBeNull();
    fireEvent.click(r.getByTestId("fms-confirm-cancel"));
    expect(r.queryByTestId("fms-pending-msg")).toBeNull();
    expect(m.deliverFmFiles).not.toHaveBeenCalled();
    fireEvent.click(exportBtn(r));
    expect(r.getByTestId("fms-confirm-export-anyway").textContent).toBe("Export anyway");
    fireEvent.click(r.getByTestId("fms-confirm-export-anyway"));
    expect(r.queryByTestId("fms-pending-msg")).toBeNull();
    fireEvent.click(r.getByTestId("fms-confirm-export")); // the normal confirm
    await waitFor(() => expect(m.markFmExported).toHaveBeenCalled());
    expect((m.markFmExported.mock.calls[0][0] as string[]).slice().sort()).toEqual(["p1", "p2", "v"]);
  });
  it("3b nothing being checked → the normal confirm at once; 3c the old key is gone", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await settled(r);
    fireEvent.click(exportBtn(r));
    expect(r.queryByTestId("fms-pending-msg")).toBeNull();
    expect(r.getByTestId("fms-confirm-export")).not.toBeNull();
    const src = (f: string) => readFileSync(resolve(__dirname, f), "utf8");
    expect(src("../../i18n/index.tsx")).not.toContain("rd_fms_sc_checking");
    expect(src("../FmParcelScan.tsx")).not.toContain("rd_fms_sc_checking");
    expect(src("../../i18n/index.tsx").match(/^\s*rd_fms_sc_\w+:/gm)).toEqual([expect.stringContaining("rd_fms_sc_ok")]);
  });
  it("3d the guide says what happens at export; an exported parcel is never counted as wrong", async () => {
    const guide = readFileSync(resolve(__dirname, "../../../../docs/support/sfl-guide.md"), "utf8");
    expect(guide).toContain("If parcels are still being checked when you export, you are asked to wait or export anyway.");
    expect(guide).not.toContain("Checking stores…");
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("x", { storeCheckStatus: "not_found", storeId: "015905", exportedAt: "2026-10-11T04:00:00Z", exportBatchId: "b" }), row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await settled(r);
    expect(r.getByTestId("fms-tab-wrong").textContent).toContain("· 0");
    expect(r.getByTestId("fms-attn").getAttribute("data-state")).toBe("ok");
    expect(rowEl(r, "x").getAttribute("data-flag")).not.toBe("red");
  });
});

describe("the hook and the ask", () => {
  const useHarness = (initial: FmScanRow[]) => { const [rows, setRows] = useState(initial); return { rows, ...useFmStoreChecks(true, true, rows, setRows) }; };
  it("2f Re-check on a parcel that is already waiting or being checked does nothing (one call)", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((res) => { release = res; }));
    const h = renderHook(() => useHarness([row("v", { storeCheckStatus: "valid" })]));
    act(() => { h.result.current.recheck("v", "022131"); h.result.current.recheck("v", "022131"); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => { h.result.current.recheck("v", "022131"); });
    await act(async () => { release(answer("valid")); });
    await waitFor(() => expect(h.result.current.busy.size).toBe(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("2d an 'unknown' answer never replaces a real one on screen", async () => {
    fetchMock.mockResolvedValue(answer("unknown"));
    const h = renderHook(() => useHarness([row("v", { storeCheckStatus: "valid" })]));
    act(() => { h.result.current.recheck("v", "022131"); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.result.current.busy.size).toBe(0));
    expect(h.result.current.rows[0].storeCheckStatus).toBe("valid");
    expect(checkWrites().length).toBe(0);
  });
  it("2e the 6 s give-up covers the whole ask — a session read that never answers too", async () => {
    vi.useFakeTimers();
    fake.getSession = () => new Promise(() => {});
    const p = askFmStore("022131");
    await vi.advanceTimersByTimeAsync(FM_STORE_CHECK_GIVE_UP_MS + 10);
    expect(await p).toEqual({ status: "unknown", noAnswer: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FM_STORE_CHECK_GIVE_UP_MS).toBe(6000);
  });
  it("2e a server that never answers → unknown after 6 s; 6 digits only; a refused / odd answer is unknown", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_u: string, o: { signal: AbortSignal }) => new Promise((_res, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))));
    const p = askFmStore("022131");
    await vi.advanceTimersByTimeAsync(FM_STORE_CHECK_GIVE_UP_MS + 10);
    expect(await p).toEqual({ status: "unknown", noAnswer: true });
    vi.useRealTimers();
    fetchMock.mockReset();
    expect(await askFmStore("12345")).toEqual({ status: "unknown" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ success: false }) });
    expect(await askFmStore("022131")).toEqual({ status: "unknown", noAnswer: true });
    fetchMock.mockResolvedValueOnce(answer("closed"));
    expect(await askFmStore("022131")).toEqual({ status: "unknown" });
  });
});
