// Scan QR → fill from Customers on the 7-11 PHOTO path (a parcel-slip photo is read, then the seller
// confirms). The reading of the photo counts as "already typed": nothing is filled over it and nothing is
// shown; a fill happens only when the photo gave no name, phone or store. The next photo and Skip start
// clean; switch off = no lookup on this card either.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { TProvider } from "../../i18n";
import { clearParcelDrafts } from "../../adapters/parcelDrafts";
import type { ScanQrLookupResult, ScanQrLookupRow } from "../../adapters/scanQrLookup";

const m = vi.hoisted(() => ({ scanParcel: vi.fn(), saveParcelScan: vi.fn(), decode: vi.fn(), lookup: vi.fn() }));
vi.mock("../../adapters/parcelScan", async (orig) => ({
  ...(await orig<typeof import("../../adapters/parcelScan")>()),
  fileToScanBase64: async () => ({ base64: "x", mediaType: "image/jpeg" }), scanParcel: m.scanParcel, saveParcelScan: m.saveParcelScan,
  loadParcelScans: async () => ({ ok: true, rows: [] }),
  loadLastExportBatch: async () => ({ ok: true, batch: null }), loadUndeliveredExports: async () => ({ ok: true, batches: [] }),
  checkEmapStore: async () => ({ status: "valid" }), saveStoreCheck: async () => ({ ok: true }),
  getCreditBalance: async () => ({ ok: true, balance: 9 }), updateParcelScan: async () => ({ ok: true }),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile: m.decode }));
vi.mock("../../adapters/scanQrLookup", async (orig) => ({ ...(await orig<typeof import("../../adapters/scanQrLookup")>()), lookupCustomersByHandle: m.lookup }));

import ParcelScan from "../ParcelScan";

const rec = (id: string, over: Partial<ScanQrLookupRow> = {}): ScanQrLookupRow => ({ id, name: "Maria Santos", phone: "0911222333", storeId: "246810", updatedAt: "2026-11-01T02:00:00+00:00", ...over });
const found = (...rows: ScanQrLookupRow[]): ScanQrLookupResult => ({ ok: true, rows });
const photo = (n: string) => new File([new Uint8Array([1])], n, { type: "image/jpeg" });
const read = (name: string | null, phone: string | null, store: string | null) => ({
  ok: true, balance: 8,
  fields: { name, phone, store_id: store, amount: null, notes: null },
  confidence: { name: "low", phone: "low", store_id: "low", amount: "high", notes: "high" },
});
const mount = (lookupOn: boolean) => render(<TProvider lang="en"><ParcelScan cur="NT$" lookupOn={lookupOn} /></TProvider>);
type R = ReturnType<typeof mount>;
const val = (r: R, t: string) => (r.getByTestId(t) as HTMLInputElement).value;
const details = (r: R) => ({ name: val(r, "ps-name"), phone: val(r, "ps-phone"), store: val(r, "ps-store") });
const pickPhotos = async (r: R, n: number) => {
  await waitFor(() => expect(r.getByTestId("ps-file")).toBeTruthy());
  fireEvent.change(r.getByTestId("ps-file"), { target: { files: Array.from({ length: n }, (_, i) => photo(`slip${i}.jpg`)) } });
  await waitFor(() => expect(r.getByTestId("ps-confirm")).toBeTruthy());
};
const scanQr = async (r: R, payload: string, handle: string) => {
  m.decode.mockResolvedValueOnce(payload);
  fireEvent.change(r.getByTestId("ps-qr-file"), { target: { files: [photo("sticker.jpg")] } });
  await waitFor(() => expect(val(r, "ps-notes")).toBe(handle));
  await waitFor(() => expect((r.getByTestId("ps-scan-qr") as HTMLButtonElement).disabled).toBe(false));
};
const lowMarks = (r: R) => (r.getByTestId("ps-confirm").textContent?.match(/Hard to read/g) ?? []).length;

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.saveParcelScan.mockResolvedValue({ ok: true, id: "srv-1" });
  m.lookup.mockResolvedValue(found());
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { cleanup(); clearParcelDrafts(); });

const nothingNew = (r: R) => {
  expect(r.container.querySelector('[data-testid*="-ql"]')).toBeNull();
  expect(r.container.textContent).not.toMatch(/Found in Customers|records for @|Not here|last updated|Couldn't check|These details came from/i);
};

describe("7-11 photo path — Scan QR → fill from Customers", () => {
  it("the photo reading is never overwritten: a record exists, but NOTHING is filled, nothing is shown, the 'hard to read' marks stay — the card is exactly the lookup-off card", async () => {
    m.scanParcel.mockResolvedValue(read("Mraia Sntos", "0911222338", "246816"));
    const off = mount(false);
    await pickPhotos(off, 1);
    await scanQr(off, "https://tiktok.com/@maria_shops", "maria_shops");
    const offCard = off.getByTestId("ps-confirm").innerHTML;
    expect(m.lookup).not.toHaveBeenCalled();
    cleanup(); clearParcelDrafts();

    m.lookup.mockResolvedValue(found(rec("a"), rec("b", { storeId: "135791", updatedAt: "2026-10-01T02:00:00+00:00" })));
    const r = mount(true);
    await pickPhotos(r, 1);
    expect(lowMarks(r)).toBe(3);
    await scanQr(r, "https://tiktok.com/@maria_shops", "maria_shops");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual({ name: "Mraia Sntos", phone: "0911222338", store: "246816" });
    expect(lowMarks(r)).toBe(3);
    nothingNew(r);
    expect(r.getByTestId("ps-confirm").innerHTML === offCard).toBe(true);
  });

  it("the photo gave no name / phone / store: the NEWEST record fills them (and their marks go); nothing else appears", async () => {
    m.scanParcel.mockResolvedValue(read(null, null, null));
    m.lookup.mockResolvedValue(found(rec("new", { updatedAt: "2026-11-09T02:00:00+00:00" }), rec("old", { name: "Old Name", storeId: "135791", updatedAt: "2026-09-01T02:00:00+00:00" })));
    const r = mount(true);
    await pickPhotos(r, 1);
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(details(r)).toEqual({ name: "Maria Santos", phone: "0911222333", store: "246810" }));
    expect(lowMarks(r)).toBe(0);
    nothingNew(r);
    expect(r.container.textContent).not.toContain("Old Name");
  });

  it("the photo gave only ONE of the three (the phone): nothing is filled", async () => {
    m.scanParcel.mockResolvedValue(read(null, "0911222338", null));
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = mount(true);
    await pickPhotos(r, 1);
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual({ name: "", phone: "0911222338", store: "" });
  });

  it("Skip → the NEXT photo: no details and no username of the parcel before", async () => {
    m.scanParcel.mockResolvedValueOnce(read(null, null, null)).mockResolvedValueOnce(read("Next Buyer", "0955000111", "111222"));
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = mount(true);
    await pickPhotos(r, 2);
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(details(r).name).toBe("Maria Santos"));
    fireEvent.click(r.getByTestId("ps-skip"));
    await waitFor(() => expect(val(r, "ps-name")).toBe("Next Buyer"));
    expect(val(r, "ps-notes")).toBe("");
    expect(details(r)).toEqual({ name: "Next Buyer", phone: "0955000111", store: "111222" });
    nothingNew(r);
  });

  it("a fill on photo 1 is forgotten on photo 2: a later scan there never takes back what the photo read, even if it equals the old fill", async () => {
    // photo 2 reads the very same details the lookup had filled on photo 1
    m.scanParcel.mockResolvedValueOnce(read(null, null, null)).mockResolvedValueOnce(read("Maria Santos", "0911222333", "246810"));
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = mount(true);
    await pickPhotos(r, 2);
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(details(r).name).toBe("Maria Santos"));
    fireEvent.click(r.getByTestId("ps-skip"));
    await waitFor(() => expect(val(r, "ps-notes")).toBe(""));
    await waitFor(() => expect(val(r, "ps-name")).toBe("Maria Santos"));
    m.lookup.mockResolvedValueOnce(found());
    await scanQr(r, "other_buyer", "other_buyer");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(r)).toEqual({ name: "Maria Santos", phone: "0911222333", store: "246810" }); // the photo's reading stays
  });

  it("a slow answer for photo 1 arriving on photo 2 is dropped", async () => {
    m.scanParcel.mockResolvedValueOnce(read(null, null, null)).mockResolvedValueOnce(read(null, null, null));
    let answer: (v: ScanQrLookupResult) => void = () => {};
    m.lookup.mockImplementationOnce(() => new Promise<ScanQrLookupResult>((res) => { answer = res; }));
    const r = mount(true);
    await pickPhotos(r, 2);
    await scanQr(r, "maria_shops", "maria_shops");
    fireEvent.click(r.getByTestId("ps-skip"));
    await waitFor(() => expect(val(r, "ps-notes")).toBe(""));
    await waitFor(() => expect(r.getByTestId("ps-confirm")).toBeTruthy());
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "maria_shops" } }); // same username typed on the next parcel
    await act(async () => { answer(found(rec("a"))); await Promise.resolve(); });
    expect(details(r)).toEqual({ name: "", phone: "", store: "" });
  });

  it("Save on the photo card while the lookup is running: the answer is dropped and the NEXT photo starts clean", async () => {
    m.scanParcel.mockResolvedValueOnce(read("Ana Cruz", "0912345678", "123456")).mockResolvedValueOnce(read(null, null, null));
    let answer: (v: ScanQrLookupResult) => void = () => {};
    m.lookup.mockImplementationOnce(() => new Promise<ScanQrLookupResult>((res) => { answer = res; }));
    let finishSave: () => void = () => {};
    m.saveParcelScan.mockImplementationOnce(async () => { await new Promise<void>((res) => { finishSave = res; }); return { ok: true, id: "srv-1" }; });
    const r = mount(true);
    await pickPhotos(r, 2);
    fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "500" } });
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect((r.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId("ps-save"));
    await waitFor(() => expect(m.saveParcelScan).toHaveBeenCalledTimes(1));
    await act(async () => { finishSave(); await Promise.resolve(); });
    await waitFor(() => expect(val(r, "ps-notes")).toBe("")); // photo 2, blank reading
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "maria_shops" } });
    await act(async () => { answer(found(rec("a"))); await Promise.resolve(); });
    expect(details(r)).toEqual({ name: "", phone: "", store: "" });
    expect((m.saveParcelScan.mock.calls[0][0] as { name: string }).name).toBe("Ana Cruz");
    nothingNew(r);
  });

  it("switch OFF on the photo card: username only, no lookup, the reading and its marks untouched", async () => {
    m.scanParcel.mockResolvedValue(read(null, null, null));
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = mount(false);
    await pickPhotos(r, 1);
    const marks = lowMarks(r);
    await scanQr(r, "maria_shops", "maria_shops");
    await act(async () => { await Promise.resolve(); });
    expect(m.lookup).not.toHaveBeenCalled();
    expect(details(r)).toEqual({ name: "", phone: "", store: "" });
    expect(lowMarks(r)).toBe(marks);
    nothingNew(r);
  });
});
