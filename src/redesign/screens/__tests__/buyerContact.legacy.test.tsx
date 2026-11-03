// PERMANENT — buyer contact OFF (the default): every screen and every payload is exactly
// today's. Keep this test for as long as the feature switch exists.
//   • Parcel Scan manual / scan-confirm / edit: the @username row (input, hint, "no social
//     handle", Scan QR beside the label), Customers alone in the header, no picker anywhere.
//   • Save payloads: saveParcelScan / updateParcelScan called with today's exact argument
//     list — no contact_platform key — except the ONE deliberate case (v2 item 7): editing the
//     handle of a row that HAS a platform sends contact_platform: null.
//   • Customer Details import / edit: same.
//   • scanToXlsRow + fmScanCells: byte-identical with or without a platform on the row.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import type { ParcelCustomer } from "../../adapters/parcelCustomers";
import { TProvider } from "../../i18n";

const { saveParcelScan, updateParcelScan, loadRows, scanParcel, custRecent, saveCust, updateParcelCustomer } = vi.hoisted(() => ({
  saveParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-1" })),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  loadRows: { current: [] as ParcelScanRow[] },
  scanParcel: vi.fn(),
  custRecent: { current: [] as ParcelCustomer[] },
  saveCust: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-2" })),
  updateParcelCustomer: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(async () => ({ base64: "aGk=", mediaType: "image/jpeg" })), scanParcel,
    saveParcelScan: (...a: unknown[]) => (a.length && (a[0] as { phone?: unknown }).phone === "0955555555" ? saveCust(...a) : saveParcelScan(...a)),
    updateParcelScan,
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(), deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    resetExtensionChecks: vi.fn(async () => ({ ok: true })), getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })), undoExportBatch: vi.fn(async () => ({ ok: true, result: "undone" })),
  };
});
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => ({ ok: true, rows: custRecent.current }),
  searchParcelCustomers: async () => ({ ok: true, rows: [] }),
  updateParcelCustomer: (...a: unknown[]) => updateParcelCustomer(...a),
  deleteParcelCustomer: vi.fn(async () => ({ ok: true })),
  countPendingParcels: async () => ({ ok: true, count: 0 }),
  countParcelCustomers: async () => ({ ok: true, count: 1 }),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/parcelFrozen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelFrozen")>();
  return { ...actual, loadFrozenState: vi.fn(async () => ({ allowed: false, blocked: false, mode: "常溫", cfg: null })) };
});

const fm = vi.hoisted(() => ({ saveFmScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, row: null as unknown })), rows: { current: [] as unknown[] } }));
vi.mock("../../adapters/fmScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/fmScan")>();
  return { ...actual, saveFmScan: (...a: unknown[]) => fm.saveFmScan(...a), loadFmScans: async () => ({ ok: true, rows: fm.rows.current }), loadFmGlobalFee: async () => 39, deliverFmFiles: vi.fn(), markFmExported: vi.fn(), undoFmExport: vi.fn(), deleteFmScan: vi.fn(), deleteFmExported: vi.fn() };
});
vi.mock("../../adapters/fmCustomers", () => ({ loadRecentFmCustomers: async () => ({ ok: true, rows: [] }), searchFmCustomers: async () => ({ ok: true, rows: [] }), countFmCustomers: async () => ({ ok: true, count: 0 }), updateFmCustomer: async () => ({ ok: true }), deleteFmCustomer: async () => ({ ok: true }) }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-11-03" }));

import ParcelScan from "../ParcelScan";
import CustomerDetails from "../CustomerDetails";
import FmParcelScan from "../FmParcelScan";
import { scanToXlsRow, rowToScan } from "../../adapters/parcelScan";
import { fmScanCells } from "../../adapters/fmScan";

const row = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "王小美", phone: "0912345678", storeId: "266402", amount: 550, notes: "maria", status: "confirmed",
  storeCheckStatus: "valid", storeFullStatus: "open", phoneCheckStatus: "ok", phoneRestrictedUntil: null, createdAt: "2026-11-03T00:00:00Z", ...over,
});
const noPicker = (c: HTMLElement) => {
  expect(c.querySelectorAll('[data-testid^="ps-bc-"], [data-testid^="cd-bc-"], [data-testid^="fms-bc-"], [data-testid^="cd-edit-bc"]').length).toBe(0);
  expect(c.firstElementChild!.querySelector('[data-testid="ps-scan-qr"], [data-testid="fms-scan-qr"]')).toBeNull(); // Scan QR is NOT in the header
  expect(c.textContent).not.toContain("Buyer contact");
  expect(c.textContent).not.toContain("Buyer has no contact");
};
const legacyHandleRow = (c: HTMLElement, prefix: "ps" | "cd") => {
  const input = c.querySelector(`[data-testid="${prefix === "ps" ? "ps-notes" : "cd-handle"}"]`) as HTMLInputElement;
  expect(input).toBeTruthy();
  expect(input.placeholder).toBe("@username");
  expect(input.maxLength).toBe(50);
  expect(c.querySelector(`[data-testid="${prefix}-no-handle"]`)).toBeTruthy();
  expect(c.textContent).toContain("Buyer has no social handle");
  expect(c.textContent).toContain("Buyer @username (TikTok/FB/IG)");
};
const fill = (r: ReturnType<typeof render>) => {
  fireEvent.change(r.getByTestId("ps-name"), { target: { value: "王小美" } });
  fireEvent.change(r.getByTestId("ps-phone"), { target: { value: "0912345678" } });
  fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
  fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "550" } });
};
const view = () => render(<TProvider lang="en"><ParcelScan cur="NT$" checkOn /></TProvider>);

beforeEach(() => { saveParcelScan.mockClear(); updateParcelScan.mockClear(); scanParcel.mockReset(); loadRows.current = []; custRecent.current = []; saveCust.mockClear(); updateParcelCustomer.mockClear(); });

describe("Parcel Scan — switch off", () => {
  it("manual entry = today's handle row; Scan QR beside the label; Customers alone in the header; save payload = 3 args, no contact key", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    const card = await r.findByTestId("ps-confirm");
    legacyHandleRow(card, "ps"); noPicker(card);
    expect(card.querySelector('[data-testid="ps-open-customers"]')).toBeTruthy();
    const label = card.querySelector('label[for="ps-handle"]')!;
    expect(label.parentElement!.querySelector("button")!.textContent).toContain("Scan QR");        // Scan QR sits in the handle row
    expect(card.querySelector('[data-testid="ps-qr-file"]')).toBeTruthy();
    fill(r);
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "@maria" } });
    fireEvent.click(r.getByText("Save"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0]).toHaveLength(3);
    expect(saveParcelScan.mock.calls[0][0]).toEqual({ name: "王小美", phone: "0912345678", store_id: "266402", amount: 550, notes: "@maria" });
    expect(JSON.stringify(saveParcelScan.mock.calls[0])).not.toContain("contact");
  });
  it("scan-confirm = today's handle row, no picker", async () => {
    scanParcel.mockResolvedValue({ ok: true, fields: { name: "陳大文", phone: "0922333444", store_id: "133712", amount: 1200, notes: null }, confidence: {}, balance: 4 });
    const r = view();
    const file = new File(["x"], "slip.jpg", { type: "image/jpeg" });
    fireEvent.change(await r.findByTestId("ps-file"), { target: { files: [file] } });
    const card = await r.findByTestId("ps-confirm");
    expect(card.getAttribute("data-manual")).toBeNull();
    legacyHandleRow(card, "ps"); noPicker(card);
    expect(card.querySelector('[data-testid="ps-open-customers"]')).toBeNull();                      // Customers is manual-only, as today
  });
  it("edit: a row with NO platform → updateParcelScan has exactly 4 args; a row WITH a stale platform + changed handle → 5th arg null (v2 item 7); unchanged handle → 4 args", async () => {
    loadRows.current = [row({ id: "a", notes: "maria" }), row({ id: "b", notes: "+886922333444", contactPlatform: "whatsapp" }), row({ id: "c", notes: "yating.line", contactPlatform: "line" })];
    const r = view();
    const edits = await r.findAllByTestId("ps-row-edit");
    expect(edits).toHaveLength(3);
    // a: NULL platform
    fireEvent.click(edits[0]);
    const card = await r.findByTestId("ps-confirm");
    legacyHandleRow(card, "ps"); noPicker(card);
    expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe("maria");
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "maria2" } });
    fireEvent.click(r.getByText("Save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    expect(updateParcelScan.mock.calls[0]).toHaveLength(4);
    expect(JSON.stringify(updateParcelScan.mock.calls[0])).not.toContain("contact");
    // b: stale platform + handle changed → null
    fireEvent.click((await r.findAllByTestId("ps-row-edit"))[1]);
    await r.findByTestId("ps-confirm");
    expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe("+886922333444");
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "@newhandle" } });
    fireEvent.click(r.getByText("Save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(2));
    expect(updateParcelScan.mock.calls[1]).toHaveLength(5);
    expect(updateParcelScan.mock.calls[1][4]).toBeNull();
    // c: platform, handle unchanged (only the amount) → today's 4 args
    fireEvent.click((await r.findAllByTestId("ps-row-edit"))[2]);
    await r.findByTestId("ps-confirm");
    fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "600" } });
    fireEvent.click(r.getByText("Save"));
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(3));
    expect(updateParcelScan.mock.calls[2]).toHaveLength(4);
  });
});

describe("Customer Details — switch off", () => {
  const cust = (over: Partial<ParcelCustomer> = {}): ParcelCustomer => ({ id: "c1", phone: "0955555555", name: "Ana", storeId: "211004", notes: "@ana", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", ...over });
  it("import row = today's handle row; import payload = 3 args, no contact key", async () => {
    custRecent.current = [cust()];
    const r = render(<TProvider lang="en"><CustomerDetails cur="NT$" /></TProvider>);
    fireEvent.click(await r.findByTestId("cd-row-main"));
    const panel = await r.findByTestId("cd-import-panel");
    legacyHandleRow(panel, "cd"); noPicker(panel);
    fireEvent.change(r.getByTestId("cd-price") ?? r.container.querySelector("input"), { target: { value: "300" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(saveCust).toHaveBeenCalledTimes(1));
    expect(saveCust.mock.calls[0]).toHaveLength(3);
    expect((saveCust.mock.calls[0][0] as { notes: string }).notes).toBe("@ana");
  });
  it("edit: NULL platform → 2 args; stale platform + changed handle → 3rd arg null; unchanged handle → 2 args", async () => {
    custRecent.current = [cust({ id: "c1", notes: "@ana" }), cust({ id: "c2", name: "Joy", notes: "joy.reyes.90", contactPlatform: "facebook" }), cust({ id: "c3", name: "Mei", notes: "mei.line", contactPlatform: "line" })];
    const r = render(<TProvider lang="en"><CustomerDetails cur="NT$" /></TProvider>);
    const rows = await r.findAllByTestId("cd-row-main");
    expect(rows).toHaveLength(3);
    const editRow = async (i: number, newNotes: string | null) => {
      fireEvent.click((await r.findAllByTestId("cd-row-main"))[i]);
      fireEvent.click(await r.findByTestId("cd-edit"));
      const notes = await r.findByTestId("cd-edit-notes");
      expect(r.queryByTestId("cd-edit-bc-field")).toBeNull();
      if (newNotes !== null) fireEvent.change(notes, { target: { value: newNotes } });
      fireEvent.click(r.getByTestId("cd-edit-save"));
      await waitFor(() => expect(r.queryByTestId("cd-edit-overlay")).toBeNull());
    };
    await editRow(0, "@ana2");
    expect(updateParcelCustomer.mock.calls[0]).toHaveLength(2);
    await editRow(1, "joy.new");
    expect(updateParcelCustomer.mock.calls[1]).toHaveLength(3);
    expect(updateParcelCustomer.mock.calls[1][2]).toBeNull();
    await editRow(2, null);
    expect(updateParcelCustomer.mock.calls[2]).toHaveLength(2);
  });
});

describe("Parcel Scan FamilyMart — switch off", () => {
  const fmRow = (over: Record<string, unknown> = {}) => ({ id: "f1", recipientName: "黃志明", phone: "0911222333", storeId: "022131", amount: 450, shippingFee: 39, orderDate: "2026-11-03", buyerUsername: "@pedro", createdAt: "2026-11-03T00:00:00Z", exportedAt: null, exportBatchId: null, ...over });
  const fillFm = (r: ReturnType<typeof render>) => {
    fireEvent.change(r.getByTestId("fms-name"), { target: { value: "黃志明" } });
    fireEvent.change(r.getByTestId("fms-phone"), { target: { value: "0911222333" } });
    fireEvent.change(r.getByTestId("fms-store"), { target: { value: "022131" } });
    fireEvent.change(r.getByTestId("fms-amount"), { target: { value: "450" } });
  };
  beforeEach(() => { fm.saveFmScan.mockClear(); fm.rows.current = []; fm.saveFmScan.mockImplementation(async () => ({ ok: true, row: fmRow({ id: "n1" }) })); });
  it("manual entry = today's handle row, no picker; save = exactly 1 arg", async () => {
    const r = render(<TProvider lang="en"><FmParcelScan cur="NT$" /></TProvider>);
    fireEvent.click(await r.findByTestId("fms-manual"));
    const card = await r.findByTestId("fms-confirm");
    noPicker(card);
    expect((card.querySelector('[data-testid="fms-username"]') as HTMLInputElement).placeholder).toBe("@username");
    expect(card.querySelector('[data-testid="fms-no-handle"]')).toBeTruthy();
    expect(card.querySelector('label[for="fms-handle"]')!.parentElement!.querySelector("button")!.textContent).toContain("Scan QR");
    fillFm(r);
    fireEvent.change(r.getByTestId("fms-username"), { target: { value: "@pedro" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(fm.saveFmScan).toHaveBeenCalledTimes(1));
    expect(fm.saveFmScan.mock.calls[0]).toHaveLength(1);
    expect(fm.saveFmScan.mock.calls[0][0]).toMatchObject({ buyerUsername: "@pedro" });
    expect(JSON.stringify(fm.saveFmScan.mock.calls[0])).not.toContain("contact");
  });
  it("edit: NULL platform → 2 args; stale platform + changed handle → 3rd arg null; unchanged → 2 args", async () => {
    fm.rows.current = [fmRow({ id: "a" }), fmRow({ id: "b", buyerUsername: "+886911222333", contactPlatform: "whatsapp" }), fmRow({ id: "c", buyerUsername: "pedro.line", contactPlatform: "line" })];
    const r = render(<TProvider lang="en"><FmParcelScan cur="NT$" /></TProvider>);
    const edits = await r.findAllByTestId("fms-row-edit");
    expect(edits).toHaveLength(3);
    fireEvent.click(edits[0]);
    noPicker(await r.findByTestId("fms-confirm"));
    fireEvent.change(r.getByTestId("fms-username"), { target: { value: "@pedro2" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(fm.saveFmScan).toHaveBeenCalledTimes(1));
    expect(fm.saveFmScan.mock.calls[0]).toHaveLength(2);
    fireEvent.click((await r.findAllByTestId("fms-row-edit"))[1]);
    await r.findByTestId("fms-confirm");
    fireEvent.change(r.getByTestId("fms-username"), { target: { value: "@newhandle" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(fm.saveFmScan).toHaveBeenCalledTimes(2));
    expect(fm.saveFmScan.mock.calls[1]).toHaveLength(3);
    expect(fm.saveFmScan.mock.calls[1][2]).toBeNull();
    fireEvent.click((await r.findAllByTestId("fms-row-edit"))[2]);
    await r.findByTestId("fms-confirm");
    fireEvent.change(r.getByTestId("fms-amount"), { target: { value: "500" } });
    fireEvent.click(r.getByTestId("fms-save"));
    await waitFor(() => expect(fm.saveFmScan).toHaveBeenCalledTimes(3));
    expect(fm.saveFmScan.mock.calls[2]).toHaveLength(2);
  });
});

describe("exports never see the platform", () => {
  it("scanToXlsRow + fmScanCells are byte-identical with or without contactPlatform; rowToScan omits a NULL platform", () => {
    const base = row({ notes: "+886922333444" });
    const opts = { storeName: "Budget Ukay", fee: 38 };
    expect(scanToXlsRow({ ...base, contactPlatform: "whatsapp" }, opts)).toEqual(scanToXlsRow(base, opts));
    expect(JSON.stringify(scanToXlsRow({ ...base, contactPlatform: "line" }, opts))).toBe(JSON.stringify(scanToXlsRow(base, opts)));
    const fm = { recipientName: "黃志明", phone: "0911222333", storeId: "022131", amount: 450, shippingFee: 39, orderDate: "2026-11-03", buyerUsername: "+886911222333" };
    expect(fmScanCells({ ...fm, contactPlatform: "whatsapp" } as typeof fm)).toEqual(fmScanCells(fm));
    expect("contactPlatform" in rowToScan({ id: "x", notes: "m", contact_platform: null })).toBe(false);
    expect(rowToScan({ id: "x", notes: "m", contact_platform: "line" }).contactPlatform).toBe("line");
  });
});
