// Scan QR → Customers lookup on the 7-11 PHOTO path (a parcel-slip photo is read, then the seller
// confirms). The reading of the photo counts as "already typed": never overwritten, a suggestion
// with "Use"; the box is gone on the next photo and on Skip; switch off = no lookup on this card either.
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
const found = (...rows: ScanQrLookupRow[]): ScanQrLookupResult => ({ ok: true, rows, more: false });
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

describe("7-11 photo path — Scan QR → Customers lookup", () => {
  it("the photo reading is never overwritten: one record = a suggestion; 'Use' writes name, phone, store and removes their 'hard to read' marks", async () => {
    m.scanParcel.mockResolvedValue(read("Mraia Sntos", "0911222338", "246816"));
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = mount(true);
    await pickPhotos(r, 1);
    expect(lowMarks(r)).toBe(3);
    await scanQr(r, "https://tiktok.com/@maria_shops", "maria_shops");
    await waitFor(() => expect(r.getByTestId("ps-ql").getAttribute("data-kind")).toBe("suggest"));
    expect(details(r)).toEqual({ name: "Mraia Sntos", phone: "0911222338", store: "246816" }); // untouched
    expect(lowMarks(r)).toBe(3);
    fireEvent.click(r.getByTestId("ps-ql-use"));
    await waitFor(() => expect(details(r)).toEqual({ name: "Maria Santos", phone: "0911222333", store: "246810" }));
    expect(lowMarks(r)).toBe(0);
    expect(r.getByTestId("ps-ql").getAttribute("data-kind")).toBe("found");
  });

  it("the photo gave no name / phone / store: one record fills them (and their marks go)", async () => {
    m.scanParcel.mockResolvedValue(read(null, null, null));
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = mount(true);
    await pickPhotos(r, 1);
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(details(r)).toEqual({ name: "Maria Santos", phone: "0911222333", store: "246810" }));
    expect(lowMarks(r)).toBe(0);
  });

  it("2+ records on the photo card: a list; nothing of the reading is replaced until one is tapped", async () => {
    m.scanParcel.mockResolvedValue(read("Mraia", "0911222338", "246816"));
    m.lookup.mockResolvedValue(found(rec("a"), rec("b", { storeId: "135791", updatedAt: "2026-10-01T02:00:00+00:00" })));
    const r = mount(true);
    await pickPhotos(r, 1);
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(r.getByTestId("ps-ql").getAttribute("data-kind")).toBe("choose"));
    expect(details(r)).toEqual({ name: "Mraia", phone: "0911222338", store: "246816" });
    fireEvent.click(r.getAllByTestId("ps-ql-pick")[1]);
    await waitFor(() => expect(details(r).store).toBe("135791"));
  });

  it("Skip → the NEXT photo: no box, no details and no username of the parcel before; an answer on its way is dropped", async () => {
    m.scanParcel.mockResolvedValueOnce(read(null, null, null)).mockResolvedValueOnce(read("Next Buyer", "0955000111", "111222"));
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = mount(true);
    await pickPhotos(r, 2);
    await scanQr(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(r.getByTestId("ps-ql").getAttribute("data-kind")).toBe("found"));
    fireEvent.click(r.getByTestId("ps-skip"));
    await waitFor(() => expect(val(r, "ps-name")).toBe("Next Buyer"));
    expect(r.queryByTestId("ps-ql")).toBeNull();
    expect(val(r, "ps-notes")).toBe("");
    expect(details(r)).toEqual({ name: "Next Buyer", phone: "0955000111", store: "111222" });
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
    expect(r.queryByTestId("ps-ql")).toBeNull();
  });

  it("switch OFF on the photo card: username only, no lookup, the reading and its marks untouched", async () => {
    m.scanParcel.mockResolvedValue(read("Mraia Sntos", "0911222338", "246816"));
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = mount(false);
    await pickPhotos(r, 1);
    await scanQr(r, "maria_shops", "maria_shops");
    await act(async () => { await Promise.resolve(); });
    expect(m.lookup).not.toHaveBeenCalled();
    expect(r.queryByTestId("ps-ql")).toBeNull();
    expect(details(r)).toEqual({ name: "Mraia Sntos", phone: "0911222338", store: "246816" });
    expect(lowMarks(r)).toBe(3);
  });
});
