// Parcel Scan FamilyMart — looks and works like the 7-11 Parcel Scan manual entry (sql/120 + sql/121).
// The FamilyMart tile opens the screen only when allowed (else it stays "Soon"); no order-date or
// fee field (today in Taipei + the global FamilyMart fee); QR fills the @username; customers can be
// imported; export = the unchanged 好賣+ file, marked exported only after a real delivery, with undo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import SettingsHub from "../SettingsHub";

const m = vi.hoisted(() => ({
  saveFmScan: vi.fn(), loadFmScans: vi.fn(), deliverFmFiles: vi.fn(), markFmExported: vi.fn(),
  undoFmExport: vi.fn(), deleteFmScan: vi.fn(), deleteFmExported: vi.fn(), loadFmGlobalFee: vi.fn(),
  decodeQrFromFile: vi.fn(), loadRecentFmCustomers: vi.fn(),
}));
vi.mock("../../adapters/fmScan", async (orig) => {
  const actual = await orig<typeof import("../../adapters/fmScan")>();
  return {
    ...actual, saveFmScan: m.saveFmScan, loadFmScans: m.loadFmScans, deliverFmFiles: m.deliverFmFiles, markFmExported: m.markFmExported,
    undoFmExport: m.undoFmExport, deleteFmScan: m.deleteFmScan, deleteFmExported: m.deleteFmExported, loadFmGlobalFee: m.loadFmGlobalFee,
  };
});
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile: m.decodeQrFromFile }));
vi.mock("../../adapters/fmCustomers", () => ({
  loadRecentFmCustomers: m.loadRecentFmCustomers,
  searchFmCustomers: async () => ({ ok: true, rows: [] }),
  countFmCustomers: async () => ({ ok: true, count: 1 }),
  updateFmCustomer: async () => ({ ok: true }),
  deleteFmCustomer: async () => ({ ok: true }),
}));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-11" }));

import FmParcelScan from "../FmParcelScan";

const noop = () => {};
const hub = (extra: Record<string, unknown>) => render(<TProvider lang="en"><SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} {...extra} /></TProvider>);
const row = (id: string, extra = {}) => ({ id, recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-10-11", buyerUsername: "@x", createdAt: "2026-10-11T03:00:00Z", exportedAt: null, exportBatchId: null, ...extra });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.loadFmScans.mockResolvedValue({ ok: true, rows: [] });
  m.loadFmGlobalFee.mockResolvedValue(39);
  m.loadRecentFmCustomers.mockResolvedValue({ ok: true, rows: [] });
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
  const loaded = async (r: ReturnType<typeof view>) => { await waitFor(() => expect(r.getByTestId("fms-saved-list")).toBeTruthy()); await waitFor(() => expect(m.loadFmGlobalFee).toHaveBeenCalled()); };
  const fill = (r: ReturnType<typeof view>) => { type(r, "name", "Jeffrey"); type(r, "phone", "0958704782"); type(r, "store", "022131"); type(r, "amount", "500"); type(r, "username", "@jeff"); };

  it("same sections as the 7-11 manual entry; the card's fields are in the 7-11 order", async () => {
    const r = view();
    await loaded(r);
    for (const id of ["fms-top", "fms-manual", "fms-export-card", "fms-saved-list", "fms-tabs"]) expect(r.getByTestId(id)).toBeTruthy();
    fireEvent.click(r.getByTestId("fms-manual"));
    const card = r.getByTestId("fms-confirm");
    expect(r.getByTestId("fms-open-customers")).toBeTruthy();
    expect(r.getByTestId("fms-scan-qr")).toBeTruthy();
    const ids = Array.from(card.querySelectorAll("input")).map((i) => i.getAttribute("data-testid"));
    expect(ids).toEqual(["fms-name", "fms-phone", "fms-store", "fms-amount", "fms-qr-file", "fms-username", "fms-no-handle"]);
    // the 7-11 card has the same order: name, phone, store, amount, QR file, @username, no-handle
    const ps = readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8");
    const order = ["ps-name", "ps-phone", "ps-store", "ps-amount", "ps-qr-file", "ps-notes", "ps-no-handle"].map((k) => ps.indexOf(`data-testid="${k}"`));
    expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]))).toBe(true);
  });

  it("no order-date and no shipping-fee field anywhere", async () => {
    const r = view();
    await loaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    expect(r.container.querySelector('input[type="date"]')).toBeNull();
    expect(r.container.querySelector('[data-testid*="fee"], [data-testid*="date"]')).toBeNull();
    expect(r.container.textContent).not.toMatch(/shipping fee|order date/i);
  });

  it("Save adds the parcel with today's date (Taipei) and the global FamilyMart fee", async () => {
    m.loadFmGlobalFee.mockResolvedValue(45);
    m.saveFmScan.mockResolvedValue({ ok: true, row: row("n1", { shippingFee: 45 }) });
    const r = view();
    await loaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    fill(r);
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    expect(m.saveFmScan).toHaveBeenCalledWith({ recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: "500", shippingFee: "45", orderDate: "2026-10-11", buyerUsername: "@jeff" });
    // continuous entry: the card stays open and blank
    expect((r.getByTestId("fms-name") as HTMLInputElement).value).toBe("");
    expect(r.getByTestId("fms-manual-cancel").textContent).toBe("Done");
  });

  it("validation: phone 09+8, store 6 digits, amount + fee 60–20000, @username required unless 'no social handle'", async () => {
    m.saveFmScan.mockResolvedValue({ ok: true, row: row("n1", { buyerUsername: null }) });
    const r = view();
    await loaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    type(r, "name", "Jeffrey"); type(r, "phone", "0858"); type(r, "store", "2213"); type(r, "amount", "15");
    const errs = r.getAllByTestId("fms-field-err").map((e) => e.textContent);
    expect(errs).toEqual(["Phone must be 10 digits starting with 09.", "Store number must be 6 digits (e.g. 022131).", "Item amount + shipping must be 60 to 20,000."]);
    expect(r.getByTestId("fms-handle-err")).toBeTruthy();
    expect((r.getByTestId("fms-save") as HTMLButtonElement).disabled).toBe(true);
    type(r, "phone", "0958704782"); type(r, "store", "022131"); type(r, "amount", "21");
    expect((r.getByTestId("fms-save") as HTMLButtonElement).disabled).toBe(true); // still no @username
    fireEvent.click(r.getByTestId("fms-no-handle"));
    expect((r.getByTestId("fms-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(m.saveFmScan).toHaveBeenCalledWith(expect.objectContaining({ amount: "21", buyerUsername: "" })));
  });

  it("Scan QR fills the @username (a TikTok sticker); a random QR leaves it alone", async () => {
    const r = view();
    await loaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    m.decodeQrFromFile.mockResolvedValue("https://tiktok.com/@buyer.one");
    fireEvent.change(r.getByTestId("fms-qr-file"), { target: { files: [new File(["x"], "s.png", { type: "image/png" })] } });
    await waitFor(() => expect((r.getByTestId("fms-username") as HTMLInputElement).value).toBe("buyer.one"));
    expect(r.getByTestId("fms-toast").textContent).toBe("Filled @username from QR");
    m.decodeQrFromFile.mockResolvedValue("https://example.com/x");
    fireEvent.change(r.getByTestId("fms-qr-file"), { target: { files: [new File(["x"], "s.png", { type: "image/png" })] } });
    await waitFor(() => expect(r.getByTestId("fms-toast").textContent).toBe("No QR found — type the username"));
    expect((r.getByTestId("fms-username") as HTMLInputElement).value).toBe("buyer.one");
  });

  it("editing keeps the parcel's saved fee + date", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a", { shippingFee: 45, orderDate: "2026-10-05" })] });
    m.saveFmScan.mockResolvedValue({ ok: true, row: row("a", { shippingFee: 45, orderDate: "2026-10-05", recipientName: "Jeff" }) });
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fms-row-edit"));
    expect(r.getByTestId("fms-confirm").getAttribute("data-editing")).toBe("1");
    type(r, "name", "Jeff");
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(m.saveFmScan).toHaveBeenCalledWith(expect.objectContaining({ recipientName: "Jeff", shippingFee: "45", orderDate: "2026-10-05" }), "a"));
  });

  it("export: confirm → files delivered → marked exported → tag + Undo; Undo puts them back", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a"), row("b", { orderDate: "2026-01-01" })] });
    m.deliverFmFiles.mockResolvedValue({ ok: true });
    m.markFmExported.mockResolvedValue(true);
    m.undoFmExport.mockResolvedValue(true);
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(2));
    expect(r.getByTestId("fms-export-btn").textContent).toBe("📄 Export 1 parcel(s)"); // the too-old one is held back
    fireEvent.click(r.getByTestId("fms-export-btn"));
    expect(r.getByTestId("fms-confirm-msg").textContent).toContain("Export 1 parcel(s)?");
    expect(m.deliverFmFiles).not.toHaveBeenCalled();
    fireEvent.click(r.getByTestId("fms-confirm-export"));
    expect(m.deliverFmFiles).toHaveBeenCalledTimes(1); // inside the tap, no await first
    await waitFor(() => expect(r.getByTestId("fms-undo-btn")).toBeTruthy());
    const files = m.deliverFmFiles.mock.calls[0][0] as { name: string }[];
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^familymart_\d{8}_\d{4}\.xlsx$/);
    expect(m.markFmExported.mock.calls[0][0]).toEqual(["a"]);
    expect(r.getAllByTestId("fms-exported-tag")).toHaveLength(1);
    expect(r.getByTestId("fms-export-summary").textContent).toContain("1 exported · 1 need attention");
    const batch = m.markFmExported.mock.calls[0][1];
    fireEvent.click(r.getByTestId("fms-undo-btn"));
    fireEvent.click(r.getByTestId("fms-confirm-undo"));
    await waitFor(() => expect(r.queryAllByTestId("fms-exported-tag")).toHaveLength(0));
    expect(m.undoFmExport).toHaveBeenCalledWith(batch);
  });

  it("a cancelled share marks nothing", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a")] });
    m.deliverFmFiles.mockResolvedValue({ ok: false, cancelled: true });
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fms-export-btn"));
    fireEvent.click(r.getByTestId("fms-confirm-export"));
    await waitFor(() => expect(m.deliverFmFiles).toHaveBeenCalled());
    await waitFor(() => expect((r.getByTestId("fms-export-btn") as HTMLButtonElement).disabled).toBe(false));
    expect(m.markFmExported).not.toHaveBeenCalled();
    expect(r.queryByTestId("fms-undo-btn")).toBeNull();
  });

  it("opening the screen offers Undo for the newest export; Clear exported deletes the exported ones", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [
      row("a", { exportedAt: "2026-10-10T01:00:00Z", exportBatchId: "old" }),
      row("b", { exportedAt: "2026-10-11T01:00:00Z", exportBatchId: "new" }),
      row("c", { exportedAt: "2026-10-11T01:00:00Z", exportBatchId: "new" }),
      row("d"),
    ] });
    m.deleteFmExported.mockResolvedValue(true);
    const r = view();
    await waitFor(() => expect(r.getByTestId("fms-undo-btn").textContent).toBe("↩ Undo last export (2)"));
    fireEvent.click(r.getByTestId("fms-clear-exported"));
    fireEvent.click(r.getByTestId("fms-confirm-delete"));
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    expect(m.deleteFmExported).toHaveBeenCalled();
    expect(r.queryByTestId("fms-undo-btn")).toBeNull();
  });

  it("delete one parcel asks first", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("a")] });
    m.deleteFmScan.mockResolvedValue(true);
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fms-row-delete"));
    expect(m.deleteFmScan).not.toHaveBeenCalled();
    fireEvent.click(r.getByTestId("fms-confirm-delete"));
    await waitFor(() => expect(r.queryAllByTestId("fms-row")).toHaveLength(0));
    expect(m.deleteFmScan).toHaveBeenCalledWith("a");
  });

  it("Customers: a saved buyer can be imported as a new parcel (today + global fee), then the list reloads", async () => {
    m.loadFmGlobalFee.mockResolvedValue(45);
    m.loadRecentFmCustomers.mockResolvedValue({ ok: true, rows: [{ id: "c1", phone: "0958704782", name: "Jeffrey", storeId: "022131", buyerUsername: "@jeff", createdAt: "", updatedAt: "" }] });
    m.saveFmScan.mockResolvedValue({ ok: true, row: row("n1") });
    const r = view();
    await loaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    fireEvent.click(r.getByTestId("fms-open-customers"));
    await waitFor(() => expect(r.getAllByTestId("fcd-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fcd-row-main"));
    expect((r.getByTestId("fcd-handle") as HTMLInputElement).value).toBe("@jeff");
    fireEvent.change(r.getByTestId("fcd-price"), { target: { value: "300" } });
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [row("n1")] });
    fireEvent.click(r.getByTestId("fcd-import"));
    await waitFor(() => expect(r.queryByTestId("fms-customers-overlay")).toBeNull());
    expect(m.saveFmScan).toHaveBeenCalledWith({ recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: "300", shippingFee: "45", orderDate: "2026-10-11", buyerUsername: "@jeff" });
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
  });

  it("Customers import follows the FamilyMart rules (a buyer without a 6-digit store is not imported)", async () => {
    m.loadRecentFmCustomers.mockResolvedValue({ ok: true, rows: [{ id: "c1", phone: "0958704782", name: "Jeffrey", storeId: "", buyerUsername: "@jeff", createdAt: "", updatedAt: "" }] });
    const r = view();
    await loaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    fireEvent.click(r.getByTestId("fms-open-customers"));
    await waitFor(() => expect(r.getAllByTestId("fcd-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fcd-row-main"));
    fireEvent.change(r.getByTestId("fcd-price"), { target: { value: "300" } });
    fireEvent.click(r.getByTestId("fcd-import"));
    await waitFor(() => expect(r.getByTestId("fcd-import-err").textContent).toBe("Store number must be 6 digits (e.g. 022131)."));
    expect(m.saveFmScan).not.toHaveBeenCalled();
  });
});
