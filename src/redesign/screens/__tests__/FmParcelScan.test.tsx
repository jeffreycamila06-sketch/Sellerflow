// Parcel Scan FamilyMart (sql/120): the FamilyMart tile opens the screen only when allowed (else it
// stays "Soon" exactly as today); the screen validates every rule inline, saves, and exports.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import SettingsHub from "../SettingsHub";

const { saveFmScan, loadFmScans, deliverFmFiles, markFmExported } = vi.hoisted(() => ({
  saveFmScan: vi.fn(), loadFmScans: vi.fn(), deliverFmFiles: vi.fn(), markFmExported: vi.fn(),
}));
vi.mock("../../adapters/fmScan", async (orig) => {
  const actual = await orig<typeof import("../../adapters/fmScan")>();
  return { ...actual, saveFmScan, loadFmScans, deliverFmFiles, markFmExported, loadFmFee: async () => 39, saveFmFee: async () => true, deleteFmScan: async () => true };
});
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-11" }));

import FmParcelScan from "../FmParcelScan";

const noop = () => {};
const hub = (extra: Record<string, unknown>) => render(<TProvider lang="en"><SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} {...extra} /></TProvider>);
const row = (id: string, extra = {}) => ({ id, recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-10-11", buyerUsername: "@x", createdAt: "", exportedAt: null, exportBatchId: null, ...extra });

beforeEach(() => {
  saveFmScan.mockReset(); loadFmScans.mockReset(); deliverFmFiles.mockReset(); markFmExported.mockReset();
  loadFmScans.mockResolvedValue({ ok: true, rows: [] });
});

describe("Settings tile", () => {
  it("access off → the FamilyMart tile is still 'Soon' (toast only), no open tile", () => {
    const onParcelSoon = vi.fn();
    const r = hub({ onParcelSoon });
    expect(r.getByTestId("tile-parcelscan-fm").getAttribute("data-soon")).toBe("1");
    expect(r.queryByTestId("tile-parcelscan-fm-open")).toBeNull();
    fireEvent.click(r.getByTestId("tile-parcelscan-fm"));
    expect(onParcelSoon).toHaveBeenCalledWith("fm");
  });
  it("access on → the tile opens the screen, no 'Soon'", () => {
    const onFmScan = vi.fn();
    const r = hub({ onParcelSoon: noop, onFmScan });
    expect(r.queryByTestId("tile-parcelscan-fm")).toBeNull();
    fireEvent.click(r.getByTestId("tile-parcelscan-fm-open"));
    expect(onFmScan).toHaveBeenCalledTimes(1);
  });
  it("RedesignApp: allowed = the 7-11 manual rule AND (switch or fm_pickup preview); screen gated the same", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('const fmScanAllowed = parcelAllowed && (featureSw.fmScan || hasFeature("fm_pickup"));');
    expect(src).toContain('onFmScan={fmScanAllowed ? () => setScreen("fmparcelscan") : undefined}');
    expect(src).toContain('{screen === "fmparcelscan" && fmScanAllowed && <FmParcelScan cur={cur} />}');
  });
});

describe("FmParcelScan screen", () => {
  const view = () => render(<TProvider lang="en"><FmParcelScan /></TProvider>);
  const type = (r: ReturnType<typeof view>, id: string, v: string) => fireEvent.change(r.getByTestId(`fms-${id}`), { target: { value: v } });

  it("shows plain-words errors and does not save a bad parcel", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("fms-empty")).toBeTruthy());
    type(r, "phone", "123"); type(r, "storeId", "22131"); type(r, "amount", "5");
    fireEvent.click(r.getByTestId("fms-save"));
    expect(r.getByTestId("fms-err-recipientName").textContent).toBe("Enter the recipient's name.");
    expect(r.getByTestId("fms-err-phone").textContent).toBe("Phone must be 10 digits starting with 09.");
    expect(r.getByTestId("fms-err-storeId").textContent).toBe("Store number must be 6 digits (e.g. 022131).");
    expect(r.getByTestId("fms-err-amount").textContent).toBe("Item amount must be 10 to 20,000.");
    expect(saveFmScan).not.toHaveBeenCalled();
  });

  it("the form has exactly 5 fields; fee + order date sit side by side in the top row with the hint", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("fms-empty")).toBeTruthy());
    const ids = Array.from(r.getByTestId("fms-form").querySelectorAll("input")).map((i) => i.getAttribute("data-testid"));
    expect(ids).toEqual(["fms-recipientName", "fms-phone", "fms-storeId", "fms-amount", "fms-buyerUsername"]);
    const top = r.getByTestId("fms-top");
    expect(top.querySelector('[data-testid="fms-default-fee"]')).toBeTruthy();
    expect(top.querySelector('[data-testid="fms-top-date"]')).toBeTruthy();
    expect((top.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe("minmax(0, 1fr) minmax(0, 1fr)");
    expect(r.getByTestId("fms-top-hint").textContent).toBe("Applies to new parcels. For a different fee or date, change it here before adding.");
  });

  it("Add parcel uses the top fee + top order date (today by default, changeable)", async () => {
    saveFmScan.mockResolvedValue({ ok: true, row: row("n1") });
    const r = view();
    await waitFor(() => expect(r.getByTestId("fms-empty")).toBeTruthy());
    expect((r.getByTestId("fms-default-fee") as HTMLInputElement).value).toBe("39");
    expect((r.getByTestId("fms-top-date") as HTMLInputElement).value).toBe("2026-10-11");
    type(r, "default-fee", "60"); type(r, "top-date", "2026-10-01");
    type(r, "recipientName", "Jeffrey"); type(r, "phone", "0958704782"); type(r, "storeId", "022131"); type(r, "amount", "500");
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    expect(saveFmScan).toHaveBeenCalledWith(expect.objectContaining({ recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: "500", shippingFee: "60", orderDate: "2026-10-01" }), undefined);
    expect(r.getByTestId("fms-summary").textContent).toBe("1 parcels · total NT$539");
  });

  it("total error shows under Item amount; date error under the top Order date", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("fms-empty")).toBeTruthy());
    type(r, "amount", "10"); type(r, "top-date", "2026-08-01");
    fireEvent.click(r.getByTestId("fms-save"));
    const total = r.getByTestId("fms-err-total");
    expect(total.textContent).toBe("Item amount + shipping must be 60 to 20,000.");
    expect(total.parentElement!.querySelector('[data-testid="fms-amount"]')).toBeTruthy();
    expect(r.getByTestId("fms-top").contains(r.getByTestId("fms-err-orderDate"))).toBe(true);
    expect(r.getByTestId("fms-err-orderDate").textContent).toBe("Order date must be within the last 60 days.");
    expect(saveFmScan).not.toHaveBeenCalled();
  });

  it("editing keeps the parcel's saved fee + date, even when the top values differ", async () => {
    loadFmScans.mockResolvedValue({ ok: true, rows: [row("a", { shippingFee: 45, orderDate: "2026-10-05" })] });
    saveFmScan.mockResolvedValue({ ok: true, row: row("a", { shippingFee: 45, orderDate: "2026-10-05", recipientName: "Jeff" }) });
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    type(r, "default-fee", "80"); type(r, "top-date", "2026-10-11");
    fireEvent.click(r.getByTestId("fms-edit"));
    expect(r.getByTestId("fms-form").querySelectorAll("input")).toHaveLength(5);
    type(r, "recipientName", "Jeff");
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(saveFmScan).toHaveBeenCalled());
    expect(saveFmScan).toHaveBeenCalledWith(expect.objectContaining({ recipientName: "Jeff", shippingFee: "45", orderDate: "2026-10-05" }), "a");
  });

  it("export: builds the file, marks the rows exported, moves them to the Exported tab", async () => {
    loadFmScans.mockResolvedValue({ ok: true, rows: [row("a"), row("b", { orderDate: "2026-01-01" })] });
    deliverFmFiles.mockResolvedValue({ ok: true });
    markFmExported.mockResolvedValue(true);
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(2));
    expect(r.getByTestId("fms-export").textContent).toBe("Export 1 parcel(s)"); // the too-old one is held back
    fireEvent.click(r.getByTestId("fms-export"));
    await waitFor(() => expect(markFmExported).toHaveBeenCalled());
    const files = deliverFmFiles.mock.calls[0][0] as { name: string }[];
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^familymart_\d{8}_\d{4}\.xlsx$/);
    expect(markFmExported.mock.calls[0][0]).toEqual(["a"]);
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fms-tab-done"));
    expect(r.getAllByTestId("fms-row")).toHaveLength(1);
  });

  it("a cancelled share marks nothing", async () => {
    loadFmScans.mockResolvedValue({ ok: true, rows: [row("a")] });
    deliverFmFiles.mockResolvedValue({ ok: false, cancelled: true });
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fms-export"));
    await waitFor(() => expect(deliverFmFiles).toHaveBeenCalled());
    expect(markFmExported).not.toHaveBeenCalled();
  });
});
