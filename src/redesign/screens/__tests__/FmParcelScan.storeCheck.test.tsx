// Parcel Scan FamilyMart — store # check (sql/154): the 7-11 wrong-store-code flow on the
// FamilyMart screen. Switch off / login not listed = the screen as before (no server call).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { TProvider } from "../../i18n";

const m = vi.hoisted(() => ({
  saveFmScan: vi.fn(), loadFmScans: vi.fn(), deliverFmFiles: vi.fn(), markFmExported: vi.fn(), loadFmGlobalFee: vi.fn(), haptic: vi.fn(),
}));
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
import { askFmStore, fmStoreCheckVisible, FM_STORE_CHECK_GIVE_UP_MS } from "../../adapters/fmStoreCheck";

const row = (id: string, extra = {}) => ({ id, recipientName: `Buyer ${id}`, phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-10-11", buyerUsername: "@x", createdAt: "2026-10-11T03:00:00Z", exportedAt: null, exportBatchId: null, ...extra });
const answer = (status: string) => ({ ok: true, json: async () => ({ success: true, status }) });
const fetchMock = vi.fn();
const screen = (on: boolean) => render(<TProvider lang="en"><FmParcelScan storeCheckOn={on} /></TProvider>);
const badgeOf = (r: ReturnType<typeof render>, id: string) => r.container.querySelector(`[data-row-id="${id}"] [data-testid="fms-store-badge"]`);
const rowEl = (r: ReturnType<typeof render>, id: string) => r.container.querySelector(`[data-row-id="${id}"]`)!;

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  fetchMock.mockReset();
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
    expect(m.loadFmScans).toHaveBeenCalledWith(); // no extra columns asked
    expect(fetchMock).not.toHaveBeenCalled();
    for (const id of ["fms-store-badge", "fms-store-ok", "fms-recheck", "fms-attn", "fms-attn-toast", "fms-tab-wrong", "fms-tab-attention"]) expect(r.queryByTestId(id)).toBeNull();
    expect(r.getByTestId("fms-tabs").querySelectorAll("button").length).toBe(3);
    expect(rowEl(r, "b").getAttribute("data-flag")).toBe("");
    expect(r.getByTestId("fms-batch").style.flex).toBe("0 1 50%");
    expect(r.getByTestId("fms-export-btn").textContent).toContain("2"); // the not_found row is still exported, as before
  });
});

describe("switch on — each answer on a row (the 7-11 words)", () => {
  it("valid = '✅ Store OK'; not_found = '❌ Wrong store code' + red row + Re-check; unknown = '⚠️ Can't verify store' + Re-check; none of the green line for the others", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" }), row("n", { storeCheckStatus: "not_found", storeId: "015905" }), row("u", { storeCheckStatus: "unknown" }), row("x", { exportedAt: "2026-10-11T04:00:00Z", exportBatchId: "b1" })] });
    const r = screen(true);
    await waitFor(() => expect(r.getAllByTestId("fms-row").length).toBe(4));
    expect(m.loadFmScans).toHaveBeenCalledWith(true);
    expect(fetchMock).not.toHaveBeenCalled(); // every not-exported row already has an answer
    expect(badgeOf(r, "v")).toBeNull();
    expect(rowEl(r, "v").querySelector('[data-testid="fms-store-ok"]')!.textContent).toBe("✅ Store OK");
    expect(badgeOf(r, "n")!.textContent).toContain("❌ Wrong store code");
    expect(rowEl(r, "n").getAttribute("data-flag")).toBe("red");
    expect(rowEl(r, "n").querySelector('[data-testid="fms-recheck"]')!.textContent).toBe("Re-check");
    expect(badgeOf(r, "u")!.textContent).toContain("Can't verify store");
    expect(rowEl(r, "u").getAttribute("data-flag")).toBe("");
    expect(rowEl(r, "u").querySelector('[data-testid="fms-recheck"]')).not.toBeNull();
    expect(r.getAllByTestId("fms-store-ok").length).toBe(1); // not on unknown / not_found / an exported row
    expect(r.queryByTestId("fms-attn-toast")).toBeNull(); // a problem already there when the screen opens: no alert
  });

  it("opening the screen checks the not-exported rows with no answer: '⏳ Checking store…', Export waits, then the answer + the alert once", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((res) => { release = res; }));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("p", { storeId: "015905" }), row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await waitFor(() => expect(badgeOf(r, "p")?.textContent).toContain("Checking store"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ storeId: "015905" });
    const btn = r.getByTestId("fms-export-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Checking stores…");
    expect(r.getByTestId("fms-attn").getAttribute("data-state")).toBe("ok");
    await act(async () => { release(answer("not_found")); });
    await waitFor(() => expect(badgeOf(r, "p")?.textContent).toContain("Wrong store code"));
    expect(r.getByTestId("fms-attn-toast").textContent).toBe("⚠ wrong store code · 015905");
    expect(m.haptic).toHaveBeenCalledTimes(1);
    expect(r.getByTestId("fms-attn").textContent).toBe("⚠ 1 need attention");
    await waitFor(() => expect((r.getByTestId("fms-export-btn") as HTMLButtonElement).disabled).toBe(false));
    expect(r.getByTestId("fms-export-btn").textContent).toContain("1"); // only the valid one
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attention half + tabs: tap the red half → the attention filter and the first problem highlighted; 'Wrong code · n' tab", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" }), row("n", { storeCheckStatus: "not_found" })] });
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-attn").getAttribute("data-state")).toBe("problem"));
    expect(r.getByTestId("fms-tab-wrong").textContent).toBe("Wrong code · 1");
    fireEvent.click(r.getByTestId("fms-attn"));
    expect(r.getByTestId("fms-tab-attention").getAttribute("aria-pressed")).toBe("true");
    expect(r.getAllByTestId("fms-row").length).toBe(1);
    expect(rowEl(r, "n").getAttribute("data-highlight")).toBe("1");
    fireEvent.click(r.getByTestId("fms-tab-wrong"));
    expect(r.getAllByTestId("fms-row").length).toBe(1);
  });

  it("all good → green '✓ All OK' and an empty Wrong code tab says so", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" })] });
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-attn").textContent).toBe("✓ All OK"));
    fireEvent.click(r.getByTestId("fms-tab-wrong"));
    expect(r.getByTestId("fms-wrong-empty")).not.toBeNull();
  });

  it("Re-check asks again and shows the new answer", async () => {
    fetchMock.mockResolvedValue(answer("valid"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("u", { storeCheckStatus: "unknown" })] });
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-recheck")).not.toBeNull());
    fireEvent.click(r.getByTestId("fms-recheck"));
    await waitFor(() => expect(r.getByTestId("fms-store-ok")).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(badgeOf(r, "u")).toBeNull();
  });

  it("the server does not answer → '⚠️ Can't verify store', nothing blocked; two in a row end the automatic checks", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a"), row("b"), row("c")] });
    const r = screen(true);
    await waitFor(() => expect(badgeOf(r, "b")?.textContent).toContain("Can't verify store"));
    await waitFor(() => expect((r.getByTestId("fms-export-btn") as HTMLButtonElement).disabled).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(badgeOf(r, "c")).toBeNull();
    expect(r.getByTestId("fms-export-btn").textContent).toContain("3"); // unknown and unchecked rows are exported as before
  });

  it("export: a wrong store code is not in the file and is listed with its reason", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" }), row("n", { storeCheckStatus: "not_found" }), row("u", { storeCheckStatus: "unknown" })] });
    const r = screen(true);
    await waitFor(() => expect(r.getAllByTestId("fms-row").length).toBe(3));
    fireEvent.click(r.getByTestId("fms-export-btn"));
    fireEvent.click(r.getByTestId("fms-confirm-export"));
    await waitFor(() => expect(m.markFmExported).toHaveBeenCalled());
    expect(m.markFmExported.mock.calls[0][0]).toEqual(["v", "u"]);
    await waitFor(() => expect(r.getByTestId("fms-export-summary")).not.toBeNull());
    const attn = r.getAllByTestId("fms-export-attn-row");
    expect(attn.length).toBe(1);
    expect(attn[0].textContent).toBe("Buyer nwrong store code");
  });

  it("Edit that changes the store # clears the old answer and checks again; the same store # keeps it", async () => {
    fetchMock.mockResolvedValue(answer("valid"));
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("n", { storeCheckStatus: "not_found", storeId: "015905" })] });
    m.saveFmScan.mockImplementation(async (input: { storeId: string }, id: string) => ({ ok: true, row: row(id, { storeId: input.storeId }) }));
    const r = screen(true);
    await waitFor(() => expect(r.getByTestId("fms-row-edit")).not.toBeNull());
    fireEvent.click(r.getByTestId("fms-row-edit"));
    fireEvent.click(r.getByTestId("fms-save")); // same store #
    await waitFor(() => expect(m.saveFmScan).toHaveBeenCalledTimes(1));
    expect(m.saveFmScan.mock.calls[0][3]).toBeUndefined();
    await waitFor(() => expect(badgeOf(r, "n")?.textContent).toContain("Wrong store code"));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(r.getByTestId("fms-row-edit"));
    fireEvent.change(r.getByTestId("fms-store"), { target: { value: "022131" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(m.saveFmScan).toHaveBeenCalledTimes(2));
    expect(m.saveFmScan.mock.calls[1][3]).toBe(true);
    await waitFor(() => expect(r.getByTestId("fms-store-ok")).not.toBeNull());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ storeId: "022131" });
    expect(r.getByTestId("fms-attn").textContent).toBe("✓ All OK");
  });

  it("'Store OK' and 'Checking stores…' exist in all 8 languages; the row never says 'Buyer OK'", async () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("v", { storeCheckStatus: "valid" })] });
      const r = render(<TProvider lang={lang}><FmParcelScan storeCheckOn /></TProvider>);
      await waitFor(() => expect(r.getByTestId("fms-store-ok").textContent!.length).toBeGreaterThan(3));
      expect(r.getByTestId("fms-store-ok").textContent).not.toContain("Buyer OK");
      r.unmount();
    }
  });
});

describe("askFmStore", () => {
  it("gives up after 6 s → unknown (so Export can never stay stuck)", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_u: string, o: { signal: AbortSignal }) => new Promise((_res, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))));
    const p = askFmStore("022131");
    await vi.advanceTimersByTimeAsync(FM_STORE_CHECK_GIVE_UP_MS + 10);
    expect(await p).toEqual({ status: "unknown", noAnswer: true });
    expect(FM_STORE_CHECK_GIVE_UP_MS).toBe(6000);
  });
  it("6 digits only; a refused / odd answer is unknown", async () => {
    expect(await askFmStore("12345")).toEqual({ status: "unknown" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ success: false }) });
    expect((await askFmStore("022131")).status).toBe("unknown");
    fetchMock.mockResolvedValueOnce(answer("closed"));
    expect(await askFmStore("022131")).toEqual({ status: "unknown" });
  });
});
