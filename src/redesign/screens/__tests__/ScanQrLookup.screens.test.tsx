// Scan QR → fill from Customers (Jeff 2026-11-12, sql/149) — every situation, on the 7-11 Parcel Scan
// AND the FamilyMart Parcel Scan (same tests, both screens).
//   • a record of the username → name, phone and store from the NEWEST record. No list, no box, no words.
//   • something typed in name, phone or store → nothing is filled, nothing is shown.
//   • the username's records have 3+ different phones (a word used for many buyers) → nothing is filled.
//   • no record / error / too slow → exactly as before (username only), no message.
//   • the username changed BY HAND after a fill to one that is no longer that buyer's → the filled details nobody
//     touched go (as at a scan of another buyer); the same username typed another way → nothing is erased.
// The QR decode and the lookup read are mocked here (the read itself: adapters/__tests__/scanQrLookup.test.ts;
// the screen with the REAL read and a recording client: ScanQrLookup.offOn.test.tsx).
import { useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { TProvider } from "../../i18n";
import { clearParcelDrafts, readParcelDraft, writeParcelDraft, holdParcelDraftForSave } from "../../adapters/parcelDrafts";
import type { ScanQrLookupResult, ScanQrLookupRow } from "../../adapters/scanQrLookup";

const m = vi.hoisted(() => ({
  saveFmScan: vi.fn(), loadFmScans: vi.fn(), deleteFmScan: vi.fn(), loadFmGlobalFee: vi.fn(),
  saveParcelScan: vi.fn(), loadParcelScans: vi.fn(),
  decode: vi.fn(), lookup: vi.fn(),
}));
vi.mock("../../adapters/fmScan", async (orig) => ({
  ...(await orig<typeof import("../../adapters/fmScan")>()),
  saveFmScan: m.saveFmScan, loadFmScans: m.loadFmScans, deleteFmScan: m.deleteFmScan, loadFmGlobalFee: m.loadFmGlobalFee,
}));
vi.mock("../../adapters/parcelScan", async (orig) => ({
  ...(await orig<typeof import("../../adapters/parcelScan")>()),
  saveParcelScan: m.saveParcelScan, loadParcelScans: m.loadParcelScans,
  loadLastExportBatch: async () => ({ ok: true, batch: null }), loadUndeliveredExports: async () => ({ ok: true, batches: [] }),
  checkEmapStore: async () => ({ status: "valid" }), saveStoreCheck: async () => ({ ok: true }),
  getCreditBalance: async () => ({ ok: true, balance: 5 }), updateParcelScan: async () => ({ ok: true }),
}));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-11-11" }));
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile: m.decode }));
vi.mock("../../adapters/scanQrLookup", async (orig) => ({
  ...(await orig<typeof import("../../adapters/scanQrLookup")>()),
  lookupCustomersByHandle: m.lookup,
}));
// The Customers overlays, reduced to one button that reports a finished import. Like the real ones, the
// button calls the onImported it got when the overlay OPENED (an import runs for a while) — never a newer one.
function ImportStub({ onImported }: { onImported?: () => void }) {
  const first = useRef(onImported);
  return <button data-testid="stub-imported" onClick={() => first.current?.()}>import</button>;
}
vi.mock("../CustomerDetails", () => ({ default: ImportStub }));
vi.mock("../FmCustomerDetails", () => ({ default: ImportStub }));

import ParcelScan from "../ParcelScan";
import FmParcelScan from "../FmParcelScan";
import { useScanQrLookup } from "../../adapters/useScanQrLookup";

type P = { lookupOn?: boolean; contactOn?: boolean };
const SCREENS = {
  "711": {
    store: "711" as const, p: "ps", handle: "ps-notes",
    el: (x: P) => <ParcelScan cur="NT$" manualOnly {...x} />,
    valid: { name: "Ana Cruz", phone: "0912345678", store: "123456", amount: "500" },
    savedArg: () => m.saveParcelScan.mock.calls[0]?.[0] as unknown,
    savedName: () => (m.saveParcelScan.mock.calls[0]?.[0] as { name: string }).name,
    saved: m.saveParcelScan,
    seedRow: () => m.loadParcelScans.mockResolvedValue({ ok: true, rows: [{ id: "r1", customerName: "Saved Buyer", phone: "0912345678", storeId: "982063", amount: 550, notes: "@saved", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-11-10T00:00:00Z" }] }),
    seedMariaRow: () => m.loadParcelScans.mockResolvedValue({ ok: true, rows: [{ id: "r1", customerName: "Maria Santos", phone: "0911222333", storeId: "246810", amount: 550, notes: "@saved", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-11-10T00:00:00Z" }] }),
  },
  fm: {
    store: "fm" as const, p: "fms", handle: "fms-username",
    el: (x: P) => <FmParcelScan cur="NT$" {...x} />,
    valid: { name: "Jeffrey", phone: "0958704782", store: "022131", amount: "500" },
    savedArg: () => m.saveFmScan.mock.calls[0]?.[0] as unknown,
    savedName: () => (m.saveFmScan.mock.calls[0]?.[0] as { recipientName: string }).recipientName,
    saved: m.saveFmScan,
    seedRow: () => m.loadFmScans.mockResolvedValue({ ok: true, rows: [{ id: "r1", recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-11-10", buyerUsername: "@saved", createdAt: "2026-11-10T03:00:00Z", exportedAt: null, exportBatchId: null }] }),
    seedMariaRow: () => m.loadFmScans.mockResolvedValue({ ok: true, rows: [{ id: "r1", recipientName: "Maria Santos", phone: "0911222333", storeId: "246810", amount: 500, shippingFee: 39, orderDate: "2026-11-10", buyerUsername: "@saved", createdAt: "2026-11-10T03:00:00Z", exportedAt: null, exportBatchId: null }] }),
  },
};
type Key = keyof typeof SCREENS;

const rec = (id: string, over: Partial<ScanQrLookupRow> = {}): ScanQrLookupRow => ({ id, name: "Maria Santos", phone: "0911222333", storeId: "246810", updatedAt: "2026-11-01T02:00:00+00:00", ...over });
const found = (...rows: ScanQrLookupRow[]): ScanQrLookupResult => ({ ok: true, rows });
const qrFile = () => new File([new Uint8Array([1])], "sticker.jpg", { type: "image/jpeg" });
const MARIA = { name: "Maria Santos", phone: "0911222333", store: "246810" };
const BLANK = { name: "", phone: "", store: "" };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.loadFmScans.mockResolvedValue({ ok: true, rows: [] });
  m.loadFmGlobalFee.mockResolvedValue(39);
  m.loadParcelScans.mockResolvedValue({ ok: true, rows: [] });
  m.saveParcelScan.mockResolvedValue({ ok: true, id: "srv-1" });
  m.saveFmScan.mockImplementation(async (p: { recipientName: string; phone: string; storeId: string; amount: string; buyerUsername: string }) => ({ ok: true, row: { id: "srv-1", recipientName: p.recipientName, phone: p.phone, storeId: p.storeId, amount: Number(p.amount), shippingFee: 39, orderDate: "2026-11-11", buyerUsername: p.buyerUsername, createdAt: "2026-11-11T03:00:00Z", exportedAt: null, exportBatchId: null } }));
  m.decode.mockResolvedValue(null);
  m.lookup.mockResolvedValue(found());
});
afterEach(() => { cleanup(); clearParcelDrafts(); vi.useRealTimers(); });

describe.each(Object.keys(SCREENS) as Key[])("Scan QR → fill from Customers — %s Parcel Scan", (key) => {
  const S = SCREENS[key];
  const id = (s: string) => `${S.p}-${s}`;
  const mount = (x: P = { lookupOn: true }) => render(<TProvider lang="en">{S.el(x)}</TProvider>);
  type R = ReturnType<typeof mount>;
  const val = (r: R, t: string) => (r.getByTestId(t) as HTMLInputElement).value;
  const type = (r: R, t: string, v: string) => fireEvent.change(r.getByTestId(t), { target: { value: v } });
  const details = (r: R) => ({ name: val(r, id("name")), phone: val(r, id("phone")), store: val(r, id("store")) });
  const typeDetails = (r: R, d: { name: string; phone: string; store: string }) => { type(r, id("name"), d.name); type(r, id("phone"), d.phone); type(r, id("store"), d.store); };
  const card = (r: R) => r.getByTestId(id("confirm")).innerHTML;
  const toast = (r: R) => r.queryByTestId(id("toast"))?.textContent ?? null;
  // nothing of the removed list / box / words may exist anywhere on the screen
  const nothingNew = (r: R) => {
    expect(r.container.querySelector('[data-testid*="-ql"]')).toBeNull();
    expect(r.container.textContent).not.toMatch(/Found in Customers|records for @|Not here|last updated|please check|Couldn't check|These details came from/i);
  };
  const open = async (x?: P) => {
    const r = mount(x);
    await waitFor(() => expect(r.getByTestId(id("saved-list"))).toBeTruthy());
    await waitFor(() => expect((r.getByTestId(id("manual")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("manual")));
    await waitFor(() => expect(r.getByTestId(id("confirm"))).toBeTruthy());
    return r;
  };
  // Pick a sticker photo whose QR says `payload`; waits until the screen has put the username in the field.
  const scan = async (r: R, payload: string | null, handle?: string) => {
    m.decode.mockResolvedValueOnce(payload);
    const before = m.decode.mock.calls.length;
    fireEvent.change(r.getByTestId(id("qr-file")), { target: { files: [qrFile()] } });
    await waitFor(() => expect(m.decode.mock.calls.length).toBe(before + 1));
    if (handle !== undefined) await waitFor(() => expect(val(r, S.handle)).toBe(handle));
    await waitFor(() => expect((r.getByTestId(id("scan-qr")) as HTMLButtonElement).disabled).toBe(false)); // button free again
  };
  // A lookup the test answers by hand (slow network).
  const slow = () => {
    let answer: (v: ScanQrLookupResult) => void = () => {};
    m.lookup.mockImplementationOnce(() => new Promise<ScanQrLookupResult>((res) => { answer = res; }));
    return (v: ScanQrLookupResult) => act(async () => { answer(v); await Promise.resolve(); });
  };
  // The same screen with the lookup OFF, after the same scan (+ optional typing): what "exactly as before" looks like.
  const offReference = async (payload: string, handle: string, typed?: { name: string; phone: string; store: string }) => {
    const off = await open({ lookupOn: false });
    await scan(off, payload, handle);
    if (typed) typeDetails(off, typed);
    const out = { card: card(off), toast: toast(off) };
    expect(m.lookup).not.toHaveBeenCalled();
    cleanup(); clearParcelDrafts();
    return out;
  };

  it("a record of the username: name, phone and store are filled, the contact is the scanned username, the cursor is in Amount — and NOTHING new is on the screen", async () => {
    const ref = await offReference("https://tiktok.com/@Maria_Shops", "Maria_Shops", MARIA); // lookup off + the same details typed by hand
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = await open();
    await scan(r, "https://tiktok.com/@Maria_Shops", "Maria_Shops");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    expect(val(r, S.handle)).toBe("Maria_Shops");
    expect(val(r, id("amount"))).toBe("");
    expect(document.activeElement).toBe(r.getByTestId(id("amount")));
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(m.lookup).toHaveBeenCalledWith(S.store, "maria_shops"); // this screen's own Customers, never the other one's
    nothingNew(r);
    expect(card(r) === ref.card).toBe(true); // the form is byte-for-byte the form of someone who typed the three details
    expect(toast(r)).toBe(ref.toast);
    type(r, id("name"), "Maria S."); // everything stays editable
    expect(val(r, id("name"))).toBe("Maria S.");
  });

  it("2+ records: NO list — the NEWEST record is filled straight away, nothing else appears", async () => {
    const newest = { name: "Maria Santos", phone: "0911222333", store: "246810" };
    const ref = await offReference("https://tiktok.com/@annc_tw", "annc_tw", newest);
    m.lookup.mockResolvedValue(found(
      rec("new", { name: "Maria Santos", storeId: "246810", updatedAt: "2026-11-09T02:00:00+00:00" }),
      rec("mid", { name: "Maria S", storeId: "135791", updatedAt: "2026-10-02T02:00:00+00:00" }),
      rec("old", { name: "Mariah Santos", phone: "0955000111", storeId: "975310", updatedAt: "2026-09-20T02:00:00+00:00" }),
    ));
    const r = await open();
    await scan(r, "https://tiktok.com/@annc_tw", "annc_tw");
    await waitFor(() => expect(details(r)).toEqual(newest));
    nothingNew(r);
    expect(r.container.textContent).not.toContain("Mariah Santos"); // the older records are nowhere
    expect(r.container.textContent).not.toContain("135791");
    expect(card(r) === ref.card).toBe(true);
    expect(document.activeElement).toBe(r.getByTestId(id("amount")));
  });

  it("3 DIFFERENT phones under the scanned word (it is used for many buyers, not one person): NOTHING is filled — exactly the lookup-off form, same message, nothing remembered", async () => {
    const ref = await offReference("https://tiktok.com/@user", "user");
    m.lookup.mockResolvedValue(found(
      rec("a", { name: "Buyer One", phone: "0911000001", storeId: "111111", updatedAt: "2026-11-09T02:00:00+00:00" }),
      rec("b", { name: "Buyer Two", phone: "0922000002", storeId: "222222", updatedAt: "2026-11-08T02:00:00+00:00" }),
      rec("c", { name: "Buyer Three", phone: "0933000003", storeId: "333333", updatedAt: "2026-11-07T02:00:00+00:00" }),
    ));
    const r = await open();
    await scan(r, "https://tiktok.com/@user", "user");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("user");
    nothingNew(r);
    expect(r.container.textContent).not.toContain("Buyer One");
    expect(card(r) === ref.card).toBe(true);
    expect(toast(r)).toBe(ref.toast);
    expect(document.activeElement).not.toBe(r.getByTestId(id("amount"))); // the cursor is not moved either
    expect(readParcelDraft(S.store) && "lookup" in readParcelDraft(S.store)!).toBe(false);
    // the seller types the details by hand and saves — as before
    typeDetails(r, S.valid); type(r, id("amount"), S.valid.amount);
    fireEvent.click(r.getByTestId(id("save")));
    await waitFor(() => expect(S.saved).toHaveBeenCalledTimes(1));
    expect(S.savedName()).toBe(S.valid.name);
  });

  it.each([
    ["A, A, B, C (the three newest do not have three phones)", ["0911000001", "0911000001", "0922000002", "0933000003"]],
    ["A, A, A, B, B, C (the third phone is the oldest of six)", ["0911000001", "0911000001", "0911000001", "0922000002", "0922000002", "0933000003"]],
    ["A, B, A, B, A, C", ["0911000001", "0922000002", "0911000001", "0922000002", "0911000001", "0933000003"]],
  ])("3 different phones anywhere in the list — %s: NOTHING is filled", async (_w, phones) => {
    m.lookup.mockResolvedValue(found(...(phones as string[]).map((phone, i) => rec(`r${i}`, { name: `Buyer ${i}`, phone, updatedAt: `2026-11-${String(20 - i).padStart(2, "0")}T02:00:00+00:00` }))));
    const r = await open();
    await scan(r, "https://tiktok.com/@user", "user");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual(BLANK);
    nothingNew(r);
  });

  it("2 different phones (4 records, one phone written with spaces) is still ONE buyer's username: the NEWEST record is filled", async () => {
    const newest = { name: "Maria Santos", phone: "0911222333", store: "246810" };
    m.lookup.mockResolvedValue(found(
      rec("new", { updatedAt: "2026-11-09T02:00:00+00:00" }),
      rec("b", { name: "Maria S", phone: "0911 222 333", storeId: "135791", updatedAt: "2026-10-02T02:00:00+00:00" }),
      rec("c", { name: "Mariah Santos", phone: "0955000111", storeId: "975310", updatedAt: "2026-09-20T02:00:00+00:00" }),
      rec("d", { name: "M Santos", phone: "0955000111", storeId: "975310", updatedAt: "2026-09-10T02:00:00+00:00" }),
    ));
    const r = await open();
    await scan(r, "https://tiktok.com/@annc_tw", "annc_tw");
    await waitFor(() => expect(details(r)).toEqual(newest));
    nothingNew(r);
  });

  it("a shared word first, then a real username: the second scan fills normally (nothing sticks from the first)", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a", { phone: "0911000001" }), rec("b", { phone: "0922000002" }), rec("c", { phone: "0933000003" })));
    const r = await open();
    await scan(r, "https://tiktok.com/@user", "user");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual(BLANK);
    m.lookup.mockResolvedValueOnce(found(rec("m")));
    await scan(r, "https://tiktok.com/@Maria_Shops", "Maria_Shops");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    // …and the other way round: after a fill, a scan of the shared word takes the untouched details back and fills nothing
    m.lookup.mockResolvedValueOnce(found(rec("a", { phone: "0911000001" }), rec("b", { phone: "0922000002" }), rec("c", { phone: "0933000003" })));
    await scan(r, "https://tiktok.com/@user", "user");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(3));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("user");
    nothingNew(r);
  });

  it.each([
    ["name", { name: "Typed Name", phone: "", store: "" }],
    ["phone", { name: "", phone: "0999", store: "" }],
    ["store", { name: "", phone: "", store: "1234" }],
  ])("something is typed in the %s: NOTHING is filled and nothing is shown — the form is exactly the lookup-off form", async (_f, typed) => {
    const ref = await offReference("buyer_a", "buyer_a", typed);
    m.lookup.mockResolvedValue(found(rec("a"), rec("b", { storeId: "135791", updatedAt: "2026-10-01T02:00:00+00:00" })));
    const r = await open();
    typeDetails(r, typed);
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual(typed);
    nothingNew(r);
    expect(card(r) === ref.card).toBe(true);
    expect(toast(r)).toBe(ref.toast);
    expect(readParcelDraft(S.store) && "lookup" in readParcelDraft(S.store)!).toBe(false); // nothing is remembered either
  });

  it("NO record: the form is exactly the lookup-off form — while waiting AND after (no extra line, same message, button free)", async () => {
    const ref = await offReference("https://tiktok.com/@new_buyer", "new_buyer");
    expect(ref.toast).toBe("Filled @username from QR");
    const answer = slow();
    const on = await open({ lookupOn: true });
    await scan(on, "https://tiktok.com/@new_buyer", "new_buyer");
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(card(on) === ref.card).toBe(true); // still waiting for the answer
    expect(toast(on)).toBe(ref.toast);
    expect((on.getByTestId(id("scan-qr")) as HTMLButtonElement).disabled).toBe(false);
    await answer(found());
    expect(card(on) === ref.card).toBe(true);
    expect(toast(on)).toBe(ref.toast);
    nothingNew(on);
  });

  it("error / no signal / too slow: exactly the lookup-off form — username only, NO message", async () => {
    const ref = await offReference("maria_shops", "maria_shops");
    m.lookup.mockResolvedValue({ ok: false });
    const r = await open();
    await scan(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("maria_shops");
    expect(card(r) === ref.card).toBe(true);
    expect(toast(r)).toBe(ref.toast); // only the scan's own message
    nothingNew(r);
  });

  it("QR not readable / not a TikTok QR: as before — no lookup at all", async () => {
    const r = await open();
    await scan(r, null);
    await waitFor(() => expect(toast(r)).toBe("No QR found — type the username"));
    await scan(r, "https://youtube.com/@someone");
    expect(val(r, S.handle)).toBe("");
    expect(m.lookup).not.toHaveBeenCalled();
  });

  it("scan A (filled) then scan B (no record): none of A's details stay with B's username", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    m.lookup.mockResolvedValueOnce(found());
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(r)).toEqual(BLANK);
    nothingNew(r);
  });

  it("scan A (filled) then scan B and B cannot be read: A's untouched details are gone all the same", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    m.lookup.mockResolvedValueOnce({ ok: false });
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(r)).toEqual(BLANK);
  });

  it("scan A then scan B (has a record): B's details replace A's", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    m.lookup.mockResolvedValueOnce(found(rec("b", { name: "Pedro Reyes", phone: "0933444555", storeId: "975310" })));
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(details(r)).toEqual({ name: "Pedro Reyes", phone: "0933444555", store: "975310" }));
    expect(val(r, S.handle)).toBe("buyer_b");
  });

  it("scan A, the seller edits one detail, scan B: the edited one stays (it is typed), the untouched ones go, and B's record is NOT filled over it", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    type(r, id("name"), "Maria Santos Jr");
    m.lookup.mockResolvedValueOnce(found(rec("b", { name: "Pedro Reyes", phone: "0933444555", storeId: "975310" })));
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual({ name: "Maria Santos Jr", phone: "", store: "" });
    nothingNew(r);
  });

  it("slow answer: the seller typed while waiting → nothing is filled, the typing stays, the cursor is not pulled away", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    const phone = r.getByTestId(id("phone")) as HTMLInputElement;
    phone.focus();
    type(r, id("phone"), "0999");
    await answer(found(rec("a")));
    expect(details(r)).toEqual({ name: "", phone: "0999", store: "" });
    expect(document.activeElement).toBe(phone);
    nothingNew(r);
  });

  it("a record arrives while the cursor is in another field: filled, but the cursor stays where the seller is", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    const handle = r.getByTestId(S.handle) as HTMLInputElement;
    handle.focus();
    await answer(found(rec("a")));
    expect(details(r)).toEqual(MARIA);
    expect(document.activeElement).toBe(handle);
  });

  it("the username was changed by hand while waiting: the late answer is dropped", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    type(r, S.handle, "other_person");
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
  });

  it("two scans in a row: the newer one wins, the older answer is dropped whenever it arrives", async () => {
    const answerA = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    const answerB = slow();
    await scan(r, "buyer_b", "buyer_b");
    await answerA(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
    await answerB(found(rec("b", { name: "Pedro Reyes" })));
    expect(details(r).name).toBe("Pedro Reyes");
    await answerA(found(rec("a")));
    expect(details(r).name).toBe("Pedro Reyes");
  });

  it("Cancel while a lookup is running, then the SAME username is typed again: the old answer is still dropped", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    fireEvent.click(r.getByTestId(id("manual-cancel")));
    fireEvent.click(r.getByTestId(id("manual")));
    type(r, S.handle, "buyer_a");
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
  });

  it("the same sticker scanned twice: only the answer of the LAST scan counts", async () => {
    const first = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    const second = slow();
    await scan(r, "buyer_a", "buyer_a");
    await second(found());                 // the newest read says: no record
    await first(found(rec("a")));          // the older read arrives afterwards
    expect(details(r)).toEqual(BLANK);
  });

  it("Save while the lookup is still running: what was typed is saved, Save is never held, and the late answer does NOT fill the next parcel", async () => {
    const answer = slow();
    const r = await open();
    typeDetails(r, S.valid); type(r, id("amount"), S.valid.amount);
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect((r.getByTestId(id("save")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("save")));
    await waitFor(() => expect(S.saved).toHaveBeenCalledTimes(1));
    expect(S.savedName()).toBe(S.valid.name);
    await waitFor(() => expect(val(r, id("name"))).toBe(""));
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("");
  });

  it("Save pressed while the lookup is running: its answer is dropped at that moment — even if the seller blanks the details while the save runs, nothing is filled under a save", async () => {
    const answer = slow();
    let finishSave: () => void = () => {};
    const gate = new Promise<void>((res) => { finishSave = res; });
    const real = S.saved.getMockImplementation();
    S.saved.mockImplementationOnce(async (...a: unknown[]) => { await gate; return real ? real(...a) : { ok: true, id: "srv-1" }; });
    const r = await open();
    typeDetails(r, S.valid); type(r, id("amount"), S.valid.amount);
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect((r.getByTestId(id("save")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("save")));
    await waitFor(() => expect(S.saved).toHaveBeenCalledTimes(1));
    typeDetails(r, BLANK); // blank form + the scanned username still in the field: an answer WOULD be filled — if it were not dropped
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
    expect(readParcelDraft(S.store) && "lookup" in readParcelDraft(S.store)!).toBe(false);
    await act(async () => { finishSave(); await Promise.resolve(); });
    await waitFor(() => expect(val(r, S.handle)).toBe(""));
    expect(S.savedName()).toBe(S.valid.name); // what was typed at the press is what was saved
    nothingNew(r);
  });

  it("the filled form is an ordinary form: it is saved through the same Save, with the record's details and the scanned username; then a clean form", async () => {
    m.lookup.mockResolvedValue(found(rec("a", { name: S.valid.name, phone: S.valid.phone, storeId: S.valid.store })));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r).name).toBe(S.valid.name));
    type(r, id("amount"), "500");
    await waitFor(() => expect((r.getByTestId(id("save")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("save")));
    await waitFor(() => expect(S.saved).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(S.savedArg())).toContain(S.valid.name);
    expect(JSON.stringify(S.savedArg())).toContain("buyer_a");
    await waitFor(() => expect(details(r)).toEqual(BLANK));
    // the fill is forgotten with the save: a scan of B now has nothing of A to take back or leave behind
    m.lookup.mockResolvedValue(found());
    type(r, id("name"), S.valid.name); // the seller happens to type the same name for the next buyer
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(val(r, id("name"))).toBe(S.valid.name); // typed by hand → never taken back
  });

  it("Cancel forgets the fill; reopening the entry shows a clean form", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    fireEvent.click(r.getByTestId(id("manual-cancel")));
    fireEvent.click(r.getByTestId(id("manual")));
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("");
    expect(readParcelDraft(S.store) && "lookup" in readParcelDraft(S.store)!).toBe(false);
  });

  it("a finished import from Customers clears a filled entry completely — details AND username (nothing of buyer A is left for the next scan)", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    type(r, id("phone"), "0999888777"); // the seller edited one detail
    fireEvent.click(r.getByTestId(id("open-customers")));
    fireEvent.click(await r.findByTestId("stub-imported"));
    await waitFor(() => expect(details(r)).toEqual(BLANK));
    expect(val(r, S.handle)).toBe("");
    m.lookup.mockResolvedValueOnce(found());
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(r)).toEqual(BLANK);
  });

  it("a finished import when nothing was filled leaves the typed entry as it is (as before)", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    typeDetails(r, { name: "Typed Name", phone: "0911", store: "1234" });
    await scan(r, "buyer_a", "buyer_a"); // a record exists, but something was typed → nothing filled
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
    fireEvent.click(r.getByTestId(id("open-customers")));
    fireEvent.click(await r.findByTestId("stub-imported"));
    await waitFor(() => expect(r.queryByTestId("stub-imported")).toBeNull());
    expect(details(r)).toEqual({ name: "Typed Name", phone: "0911", store: "1234" });
    expect(val(r, S.handle)).toBe("buyer_a");
  });

  it("scan A (filled), scan B (no record), then the seller types B's details by hand: A's fill is forgotten — a finished import leaves the typed entry alone", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    m.lookup.mockResolvedValueOnce(found());
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(r)).toEqual(BLANK);
    await waitFor(() => expect(readParcelDraft(S.store) && "lookup" in readParcelDraft(S.store)!).toBe(false)); // nothing of A is remembered
    typeDetails(r, { name: "Typed For B", phone: "0977", store: "5555" });
    fireEvent.click(r.getByTestId(id("open-customers")));
    fireEvent.click(await r.findByTestId("stub-imported"));
    await waitFor(() => expect(r.queryByTestId("stub-imported")).toBeNull());
    expect(details(r)).toEqual({ name: "Typed For B", phone: "0977", store: "5555" });
    expect(val(r, S.handle)).toBe("buyer_b");
  });

  it("the seller retyped ALL the filled details by hand: a finished import leaves that typed entry alone", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    typeDetails(r, { name: "Typed Again", phone: "0977", store: "5555" });
    fireEvent.click(r.getByTestId(id("open-customers")));
    fireEvent.click(await r.findByTestId("stub-imported"));
    await waitFor(() => expect(r.queryByTestId("stub-imported")).toBeNull());
    expect(details(r)).toEqual({ name: "Typed Again", phone: "0977", store: "5555" });
    expect(val(r, S.handle)).toBe("buyer_a");
  });

  it("an import while a lookup is still running drops its answer", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    fireEvent.click(r.getByTestId(id("open-customers")));
    fireEvent.click(await r.findByTestId("stub-imported"));
    await waitFor(() => expect(r.queryByTestId("stub-imported")).toBeNull());
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
  });

  it("the answer fills the form WHILE Customers is open: the finished import still clears the whole entry (decided at that moment, not when Customers was opened)", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    fireEvent.click(r.getByTestId(id("open-customers")));
    await r.findByTestId("stub-imported");
    await answer(found(rec("a")));
    await waitFor(() => expect(details(r)).toEqual(MARIA)); // filled behind the overlay
    fireEvent.click(r.getByTestId("stub-imported"));
    await waitFor(() => expect(r.queryByTestId("stub-imported")).toBeNull());
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("");
  });

  it("an import after a failed Save on a filled entry leaves a clean form — no old save error", async () => {
    m.lookup.mockResolvedValue(found(rec("a", { name: S.valid.name, phone: S.valid.phone, storeId: S.valid.store })));
    S.saved.mockReset();
    S.saved.mockResolvedValue({ ok: false, error: "x" });
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r).name).toBe(S.valid.name));
    type(r, id("amount"), "500");
    await waitFor(() => expect((r.getByTestId(id("save")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("save")));
    await waitFor(() => expect(r.getByTestId(id("save-err"))).toBeTruthy());
    expect(details(r).name).toBe(S.valid.name); // a failed save keeps the entry
    fireEvent.click(r.getByTestId(id("open-customers")));
    fireEvent.click(await r.findByTestId("stub-imported"));
    await waitFor(() => expect(details(r)).toEqual(BLANK));
    expect(r.queryByTestId(id("save-err"))).toBeNull();
  });

  it("editing a SAVED parcel: Scan QR fills the username as before — no lookup", async () => {
    S.seedRow();
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = mount({ lookupOn: true });
    fireEvent.click(await r.findByTestId(id("row-edit")));
    await waitFor(() => expect(r.getByTestId(id("confirm")).getAttribute("data-editing")).toBe("1"));
    const before = details(r);
    await scan(r, "buyer_a", "buyer_a");
    expect(m.lookup).not.toHaveBeenCalled();
    expect(details(r)).toEqual(before);
    nothingNew(r);
  });

  it("starting an edit while a lookup is running drops its answer — even when the edited parcel has the same username and blank details", async () => {
    S.seedRow();
    const answer = slow();
    const r = await open();
    await scan(r, "saved", "saved"); // the same username as the saved parcel that is edited next
    fireEvent.click(await r.findByTestId(id("row-edit"))); // straight from the open entry
    await waitFor(() => expect(r.getByTestId(id("confirm")).getAttribute("data-editing")).toBe("1"));
    typeDetails(r, BLANK); // the seller blanks the saved details while editing
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
    await scan(r, "saved", "saved"); // and a scan while editing looks nothing up
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(details(r)).toEqual(BLANK);
  });

  it("'no handle' was ticked before the scan: after a fill the contact is the scanned username and the tick is off", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    fireEvent.click(r.getByTestId(id("no-handle")));
    expect((r.getByTestId(id("no-handle")) as HTMLInputElement).checked).toBe(true);
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    expect((r.getByTestId(id("no-handle")) as HTMLInputElement).checked).toBe(false);
    expect(val(r, S.handle)).toBe("buyer_a");
  });

  it("leaving the screen while a lookup is running: the late answer is dropped, nothing throws", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    r.unmount();
    await answer(found(rec("a")));
    expect(readParcelDraft<Record<string, string>>(S.store)?.form.name ?? "").toBe("");
  });

  it("the SAME sticker scanned again after one detail was corrected: nothing is taken back, nothing is read again — and the fill is still remembered", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    type(r, id("name"), "Maria Santos Jr");
    await scan(r, "https://tiktok.com/@Buyer_A", "Buyer_A"); // the same username (another letter case)
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual({ ...MARIA, name: "Maria Santos Jr" });
    expect(m.lookup).toHaveBeenCalledTimes(1);
    nothingNew(r);
    // ANOTHER buyer's sticker now: the untouched phone and store of the first buyer go; the typed name stays, so B is not filled
    m.lookup.mockResolvedValue(found(rec("c2", { name: "Other Buyer", phone: "0988777666", storeId: "975310" })));
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual({ name: "Maria Santos Jr", phone: "", store: "" });
  });

  it("the SAME sticker again with nothing changed while the database cannot be read: the details stay (no second read at all)", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("c1")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    m.lookup.mockResolvedValue({ ok: false });
    await scan(r, "buyer_a", "buyer_a");
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual(MARIA);
    expect(m.lookup).toHaveBeenCalledTimes(1);
  });

  it("the SAME sticker again after the seller emptied the three fields: it is a new lookup and the form is filled again", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    typeDetails(r, BLANK);
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(details(r)).toEqual(MARIA));
  });

  it("an Amount typed before the scan is never touched — not by the fill, not by the next scan taking the details back", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("c1")));
    const r = await open();
    type(r, id("amount"), "750");
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    expect(val(r, id("amount"))).toBe("750");
    m.lookup.mockResolvedValueOnce(found());
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(details(r)).toEqual(BLANK));
    expect(val(r, id("amount"))).toBe("750");
  });

  it.each(["name", "phone", "store"])("only spaces in the %s count as nothing typed: the form is filled", async (field) => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = await open();
    type(r, id(field), "   ");
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
  });

  it("filled, then ONLY the name emptied, same sticker again: nothing happens and nothing is read (empty all three for a new fill)", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    type(r, id("name"), "");
    await scan(r, "buyer_a", "buyer_a");
    await act(async () => { await Promise.resolve(); });
    expect(details(r)).toEqual({ ...MARIA, name: "" });
    expect(m.lookup).toHaveBeenCalledTimes(1);
  });

  it("filled for A, then the seller TYPES B's username and scans B's sticker: it is another buyer — A's details go, B is looked up", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("c1")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    type(r, S.handle, "buyer_b");
    m.lookup.mockResolvedValueOnce(found());
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(details(r)).toEqual(BLANK));
    expect(m.lookup).toHaveBeenLastCalledWith(S.store, "buyer_b");
  });

  it("the buyer's app is changed to another one while the answer is on its way: NOTHING is filled", async () => {
    const answer = slow();
    const r = await open({ lookupOn: true, contactOn: true });
    await scan(r, "https://tiktok.com/@Maria_Shops");
    await waitFor(() => expect(val(r, id("bc-input")).replace(/^@/, "")).toBe("Maria_Shops"));
    expect(r.getByTestId(id("bc-pick-tiktok")).getAttribute("data-selected")).toBe("1");
    fireEvent.click(r.getByTestId(id("bc-pick-line")));
    await answer(found(rec("c1")));
    expect(details(r)).toEqual(BLANK);
    nothingNew(r);
  });

  it("the picker is shown and the answer comes LATER, after the screen has re-drawn (a real network): the form IS filled", async () => {
    const answer = slow();
    const r = await open({ lookupOn: true, contactOn: true });
    await scan(r, "https://tiktok.com/@Maria_Shops");
    await waitFor(() => expect(val(r, id("bc-input")).replace(/^@/, "")).toBe("Maria_Shops"));
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    await answer(found(rec("c1")));
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    expect(r.getByTestId(id("bc-pick-tiktok")).getAttribute("data-selected")).toBe("1");
  });

  it("the picker was on another app before the scan and the answer comes later: filled, the picker is on TikTok", async () => {
    const r = await open({ lookupOn: true, contactOn: true });
    fireEvent.click(r.getByTestId(id("bc-pick-line")));
    const answer = slow();
    await scan(r, "https://tiktok.com/@Maria_Shops");
    await waitFor(() => expect(r.getByTestId(id("bc-pick-tiktok")).getAttribute("data-selected")).toBe("1"));
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    await answer(found(rec("c1")));
    await waitFor(() => expect(details(r)).toEqual(MARIA));
  });

  it("another app picked and then TikTok again while waiting: filled", async () => {
    const answer = slow();
    const r = await open({ lookupOn: true, contactOn: true });
    await scan(r, "https://tiktok.com/@Maria_Shops");
    fireEvent.click(r.getByTestId(id("bc-pick-line")));
    fireEvent.click(r.getByTestId(id("bc-pick-tiktok")));
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    await answer(found(rec("c1")));
    await waitFor(() => expect(details(r)).toEqual(MARIA));
  });

  it("the picker is NOT shown (and an older entry left another app behind): the form is filled all the same", async () => {
    const first = await open({ lookupOn: true, contactOn: true });
    fireEvent.click(first.getByTestId(id("bc-pick-line")));
    await waitFor(() => expect(readParcelDraft(S.store)?.platform).toBe("line"));
    first.unmount();
    m.lookup.mockResolvedValue(found(rec("c1")));
    const answer = slow();
    const r = mount({ lookupOn: true, contactOn: false });
    await waitFor(() => expect(r.getByTestId(id("confirm"))).toBeTruthy());
    await scan(r, "https://tiktok.com/@Maria_Shops", "Maria_Shops");
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    await answer(found(rec("c1")));
    await waitFor(() => expect(details(r)).toEqual(MARIA));
  });

  it("the picker was on another app BEFORE the scan: the scan puts it on TikTok and the form is filled", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = await open({ lookupOn: true, contactOn: true });
    fireEvent.click(r.getByTestId(id("bc-pick-line")));
    expect(r.getByTestId(id("bc-pick-line")).getAttribute("data-selected")).toBe("1");
    await scan(r, "https://tiktok.com/@Maria_Shops");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    expect(r.getByTestId(id("bc-pick-tiktok")).getAttribute("data-selected")).toBe("1");
  });

  it("⇄ and back: the filled form returns on this screen only; a scan of B afterwards still takes A's untouched details back", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r)).toEqual(MARIA));
    await waitFor(() => expect(readParcelDraft(S.store)?.lookup).toEqual({ handle: "buyer_a", filled: MARIA }));
    r.unmount();
    expect(readParcelDraft(S.store === "711" ? "fm" : "711")).toBeNull(); // the OTHER store's entry never gets any of it
    const back = mount({ lookupOn: true });
    await waitFor(() => expect(back.getByTestId(id("confirm"))).toBeTruthy());
    expect(details(back)).toEqual(MARIA);
    nothingNew(back);
    m.lookup.mockResolvedValueOnce(found());
    await scan(back, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(back)).toEqual(BLANK);
  });

  // ── The username is changed BY HAND after a fill (audit LOW-1, Jeff 2026-11-12) ─────────────────────────────
  // Before: buyer A's name, phone and store stayed in the form under the username typed over A's.
  // Now: when the text no longer stands for A (rule #4), the filled details nobody touched go — as at a scan of B.
  describe("the username is changed BY HAND after a fill", () => {
    // Scan A's sticker with a record in Customers → the form holds MARIA and remembers the fill.
    const filledA = async (x: P = { lookupOn: true }) => {
      m.lookup.mockResolvedValueOnce(found(rec("a")));
      const r = await open(x);
      await scan(r, "buyer_a", x.contactOn ? undefined : "buyer_a");
      await waitFor(() => expect(details(r)).toEqual(MARIA));
      await waitFor(() => expect(readParcelDraft(S.store)?.lookup).toEqual({ handle: "buyer_a", filled: MARIA }));
      return r;
    };

    it("scan A (filled), then the seller TYPES B's username: none of A's details stay with it — no read, nothing new on the screen, the fill is forgotten", async () => {
      const r = await filledA();
      type(r, id("amount"), "650");
      type(r, S.handle, "buyer_b");
      expect(details(r)).toEqual(BLANK);
      expect(val(r, S.handle)).toBe("buyer_b");
      expect(val(r, id("amount"))).toBe("650"); // the amount is never the lookup's
      expect(m.lookup).toHaveBeenCalledTimes(1); // typing never reads Customers
      nothingNew(r);
      await waitFor(() => expect(readParcelDraft<{ form: Record<string, string> }>(S.store)?.form[key === "711" ? "notes" : "username"]).toBe("buyer_b"));
      expect(readParcelDraft(S.store)?.lookup).toBeUndefined();
    });

    it.each([
      ["B's username is typed", (r: R) => { type(r, S.handle, "buyer_b"); }],
      ["the 'no handle' box is ticked", (r: R) => { fireEvent.click(r.getByTestId(id("no-handle"))); }],
    ] as [string, (r: R) => void][])("NOTHING new appears when %s after a fill: the whole screen is byte-for-byte the lookup-off screen after the same steps", async (_how, change) => {
      const off = await open({ lookupOn: false });
      await scan(off, "buyer_a", "buyer_a");
      change(off);
      const ref = { card: card(off), toast: toast(off), whole: off.container.innerHTML };
      expect(m.lookup).not.toHaveBeenCalled();
      cleanup(); clearParcelDrafts();
      const r = await filledA();
      change(r);
      expect(details(r)).toEqual(BLANK);
      expect(card(r) === ref.card).toBe(true);
      expect(toast(r)).toBe(ref.toast);
      expect(r.container.innerHTML === ref.whole).toBe(true); // no new line, box, message or mark anywhere on the screen
    });

    it("a detail the seller already changed stays; only the untouched ones go", async () => {
      const r = await filledA();
      type(r, id("phone"), "0999888777");
      type(r, S.handle, "buyer_b");
      expect(details(r)).toEqual({ name: "", phone: "0999888777", store: "" });
    });

    it("all three details were retyped by the seller: typing another username erases none of them", async () => {
      const r = await filledA();
      typeDetails(r, { name: S.valid.name, phone: S.valid.phone, store: S.valid.store });
      type(r, S.handle, "buyer_b");
      expect(details(r)).toEqual({ name: S.valid.name, phone: S.valid.phone, store: S.valid.store });
    });

    it.each([
      ["another letter case", "BUYER_A"],
      ["an @ in front", "@buyer_a"],
      ["an @ and another letter case", "@Buyer_A"],
      ["a note after the @username", "@buyer_a (U)"],
      ["a space after the @", "@ buyer_a"],
      ["spaces around it", "  buyer_a "],
    ])("the SAME username typed with %s: nothing is erased — and the fill is still remembered", async (_how, text) => {
      const r = await filledA();
      type(r, S.handle, text);
      expect(details(r)).toEqual(MARIA);
      expect(val(r, S.handle)).toBe(text);
      expect(readParcelDraft(S.store)?.lookup).toEqual({ handle: "buyer_a", filled: MARIA }); // still remembered …
      m.lookup.mockResolvedValueOnce(found());
      await scan(r, "buyer_b", "buyer_b"); // … so a scan of another buyer still takes A's details back
      await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
      expect(details(r)).toEqual(BLANK);
    });

    it("the same username retyped with a note, then A's sticker scanned AGAIN: it is still the same buyer — nothing is taken back, nothing is read again", async () => {
      const r = await filledA();
      type(r, S.handle, "@buyer_a (U)"); // not the text a scan writes, but still A's username (rule #4)
      await scan(r, "buyer_a", "buyer_a");
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(m.lookup).toHaveBeenCalledTimes(1); // decided by the remembered fill, not by the text in the field
      expect(details(r)).toEqual(MARIA);
      expect(readParcelDraft(S.store)?.lookup).toEqual({ handle: "buyer_a", filled: MARIA });
    });

    it.each([
      ["one letter removed", "buyer_"],
      ["one letter added", "buyer_ab"],
      ["a note with no @ in front (rule #4: not a username)", "buyer_a (U)"],
      ["a note stuck to the @username (rule #4: not a username)", "@buyer_a(U)"],
      ["the field emptied", ""],
    ])("%s is no longer A's username: the untouched details go", async (_how, text) => {
      const r = await filledA();
      type(r, S.handle, text);
      expect(details(r)).toEqual(BLANK);
      expect(val(r, S.handle)).toBe(text);
      expect(readParcelDraft(S.store)?.lookup).toBeUndefined();
    });

    // What the rule means key by key (Scan QR writes the username WITHOUT an "@"):
    it("a note typed key by key after the scanned username, no @ in front: the details go at the first key that makes it another text (rule #4) — an @ added afterwards does not bring them back", async () => {
      const r = await filledA();
      type(r, S.handle, "buyer_a ");
      expect(details(r)).toEqual(MARIA); // a plain space after it is still A's username
      type(r, S.handle, "buyer_a (");
      expect(details(r)).toEqual(BLANK);
      type(r, S.handle, "buyer_a (U)");
      type(r, S.handle, "@buyer_a (U)");
      expect(details(r)).toEqual(BLANK);
      expect(m.lookup).toHaveBeenCalledTimes(1);
    });

    it("the SAME note with the @ typed in front FIRST: nothing is erased at any key", async () => {
      const r = await filledA();
      for (const text of ["@buyer_a", "@buyer_a ", "@buyer_a (", "@buyer_a (U", "@buyer_a (U)"]) {
        type(r, S.handle, text);
        expect(details(r)).toEqual(MARIA);
      }
    });

    it("the username selected and typed again letter by letter: the details go at the first letter and stay gone", async () => {
      const r = await filledA();
      const seen: string[] = [];
      for (const text of ["b", "bu", "buy", "buye", "buyer", "buyer_", "buyer_a"]) { type(r, S.handle, text); seen.push(JSON.stringify(details(r))); }
      expect(seen).toEqual(Array(7).fill(JSON.stringify(BLANK)));
      expect(m.lookup).toHaveBeenCalledTimes(1);
    });

    it("a full-width space after the username (rule #4 knows the plain spaces only) is another text: the details go", async () => {
      const r = await filledA();
      type(r, S.handle, "buyer_a\u3000");
      expect(details(r)).toEqual(BLANK);
    });

    it("the answer is still on its way: B is typed and then A's username is typed back — the answer for A is used", async () => {
      const answer = slow();
      const r = await open();
      await scan(r, "buyer_a", "buyer_a");
      type(r, S.handle, "buyer_b");
      type(r, S.handle, "buyer_a");
      await answer(found(rec("a")));
      await waitFor(() => expect(details(r)).toEqual(MARIA));
    });

    it("typing A's username back does NOT bring the details back (only a Scan QR reads Customers) — scanning the sticker again does", async () => {
      const r = await filledA();
      type(r, S.handle, "buyer_");
      type(r, S.handle, "buyer_a");
      expect(details(r)).toEqual(BLANK);
      expect(m.lookup).toHaveBeenCalledTimes(1);
      m.lookup.mockResolvedValueOnce(found(rec("a")));
      await scan(r, "buyer_a", "buyer_a");
      await waitFor(() => expect(details(r)).toEqual(MARIA));
      expect(m.lookup).toHaveBeenCalledTimes(2);
    });

    it("the 'no handle' tick empties the username field: A's untouched details go with it, a changed one stays", async () => {
      const r = await filledA();
      type(r, id("name"), "Maria S.");
      fireEvent.click(r.getByTestId(id("no-handle")));
      expect(val(r, S.handle)).toBe("");
      expect(details(r)).toEqual({ name: "Maria S.", phone: "", store: "" });
      expect(readParcelDraft(S.store)?.lookup).toBeUndefined();
    });

    it("with the app picker shown: the same username typed another way erases nothing; B's username takes A's untouched details", async () => {
      const r = await filledA({ lookupOn: true, contactOn: true });
      type(r, id("bc-input"), "@BUYER_A");
      expect(details(r)).toEqual(MARIA);
      type(r, id("bc-input"), "buyer_b");
      expect(details(r)).toEqual(BLANK);
      expect(m.lookup).toHaveBeenCalledTimes(1);
      nothingNew(r);
    });

    it("with the app picker shown: the 'no contact' tick empties the field and takes A's untouched details", async () => {
      const r = await filledA({ lookupOn: true, contactOn: true });
      fireEvent.click(r.getByTestId(id("bc-none")));
      expect(val(r, id("bc-input"))).toBe("");
      expect(details(r)).toEqual(BLANK);
    });

    it("with the app picker shown: a PASTED text (two lines) over A's username takes A's untouched details too", async () => {
      const r = await filledA({ lookupOn: true, contactOn: true });
      const input = r.getByTestId(id("bc-input")) as HTMLInputElement;
      input.setSelectionRange(0, input.value.length); // the paste replaces what is there
      fireEvent.paste(input, { clipboardData: { getData: () => "buyer_b\nsecond line" } });
      expect(val(r, id("bc-input"))).toBe("buyer_b second line");
      expect(details(r)).toEqual(BLANK);
    });

    // (Starting the edit already forgot the fill — reset(). The hook's own "not during an edit" guard is tested in "the hook on its own".)
    it("a SAVED parcel being edited is never touched: typing another username changes the username only — even when the saved details are the very ones a scan had just filled", async () => {
      S.seedMariaRow();
      const r = await filledA();
      fireEvent.click(await r.findByTestId(id("row-edit"))); // straight from the filled entry
      await waitFor(() => expect(r.getByTestId(id("confirm")).getAttribute("data-editing")).toBe("1"));
      expect(details(r)).toEqual(MARIA); // the saved parcel's own details
      type(r, S.handle, "someone_else");
      expect(details(r)).toEqual(MARIA);
      fireEvent.click(r.getByTestId(id("no-handle")));
      expect(details(r)).toEqual(MARIA);
      expect(m.lookup).toHaveBeenCalledTimes(1);
    });

    it("⇄ and back, then B's username typed by hand: the fill that came back with the entry is taken back the same way", async () => {
      const r = await filledA();
      r.unmount();
      const back = mount({ lookupOn: true });
      await waitFor(() => expect(back.getByTestId(id("confirm"))).toBeTruthy());
      expect(details(back)).toEqual(MARIA);
      type(back, S.handle, "buyer_b");
      expect(details(back)).toEqual(BLANK);
    });

    // (An off screen never takes the fill over from the entry. The hook's own "not when off" guard is tested in "the hook on its own".)
    it("switch OFF (the ⇄ entry still carries a fill from when it was on): typing another username erases nothing", async () => {
      const r = await filledA();
      r.unmount();
      const off = mount({ lookupOn: false });
      await waitFor(() => expect(off.getByTestId(id("confirm"))).toBeTruthy());
      expect(details(off)).toEqual(MARIA);
      type(off, S.handle, "buyer_b");
      expect(details(off)).toEqual(MARIA);
      fireEvent.click(off.getByTestId(id("no-handle")));
      expect(details(off)).toEqual(MARIA);
      expect(m.lookup).toHaveBeenCalledTimes(1);
    });

    it("nothing was filled (no record): typing in the username field is just typing — what the seller typed stays", async () => {
      m.lookup.mockResolvedValueOnce(found());
      const r = await open();
      await scan(r, "buyer_a", "buyer_a");
      await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(1));
      typeDetails(r, MARIA); // typed by hand — the very same text a fill would have written
      type(r, S.handle, "buyer_b");
      expect(details(r)).toEqual(MARIA);
    });
  });

  it("switch OFF and not listed: Scan QR does what it did before — username only, the lookup is never called, nothing is kept with the draft", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open({ lookupOn: false });
    await scan(r, "https://tiktok.com/@Maria_Shops", "Maria_Shops");
    await act(async () => { await Promise.resolve(); });
    expect(m.lookup).not.toHaveBeenCalled();
    expect(details(r)).toEqual(BLANK);
    expect(toast(r)).toBe("Filled @username from QR");
    nothingNew(r);
    await waitFor(() => expect(readParcelDraft<Record<string, string>>(S.store)).not.toBeNull());
    expect(Object.keys(readParcelDraft(S.store)!).sort()).toEqual(["form", "noHandle", "platform"]); // the draft is what it was before
  });

  it("switch OFF while the ⇄ draft still carries a fill from when it was on: the mark is not used and is not written back", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(readParcelDraft(S.store)?.lookup).toEqual({ handle: "buyer_a", filled: MARIA }));
    r.unmount();
    const off = mount({ lookupOn: false });
    await waitFor(() => expect(off.getByTestId(id("confirm"))).toBeTruthy());
    expect(details(off)).toEqual(MARIA); // the typed-or-filled entry itself comes back, as any draft does
    type(off, id("amount"), "500");
    await waitFor(() => expect(Object.keys(readParcelDraft(S.store)!).sort()).toEqual(["form", "noHandle", "platform"]));
    await scan(off, "buyer_b", "buyer_b");
    await act(async () => { await Promise.resolve(); });
    expect(details(off)).toEqual(MARIA); // nothing is taken back either: the lookup does nothing at all when off
    expect(m.lookup).toHaveBeenCalledTimes(1);
  });
});

describe("the hook on its own", () => {
  it("a scan itself counts as TikTok: an answer that comes before the screen has re-drawn the picker is still used", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const setFields = vi.fn();
    // the picker still says another app in the props the hook last saw (the screen sets TikTok in the same tick as the scan)
    const { result } = renderHook(() => useScanQrLookup({ on: true, store: "711", blocked: false, tiktok: false, initial: null, fields: { name: "", phone: "", store: "", handle: "buyer_a" }, setFields }));
    await act(async () => { result.current.scanned("buyer_a"); await Promise.resolve(); await Promise.resolve(); });
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(setFields).toHaveBeenCalledTimes(1);
    expect((setFields.mock.calls[0][0] as (c: unknown) => unknown)({ name: "", phone: "", store: "" })).toEqual(MARIA);
  });
});

describe("the hook on its own — a screen that does not say which app (no picker at all)", () => {
  it("is treated as TikTok: an answer that comes after a re-draw is used", async () => {
    let answer: (v: ScanQrLookupResult) => void = () => {};
    m.lookup.mockImplementationOnce(() => new Promise<ScanQrLookupResult>((res) => { answer = res; }));
    const setFields = vi.fn();
    const { result, rerender } = renderHook(() => useScanQrLookup({ on: true, store: "fm", blocked: false, initial: null, fields: { name: "", phone: "", store: "", handle: "buyer_a" }, setFields }));
    act(() => { result.current.scanned("buyer_a"); });
    rerender();
    await act(async () => { answer(found(rec("c1"))); await Promise.resolve(); await Promise.resolve(); });
    expect(setFields).toHaveBeenCalledTimes(1);
  });
});

describe("the hook on its own — only spaces in a field", () => {
  // (the phone and store boxes of the two screens keep digits only, so spaces can reach the hook only from elsewhere)
  it.each([
    ["phone", { name: "", phone: "  ", store: "" }],
    ["store", { name: "", phone: "", store: " " }],
    ["name", { name: "\t ", phone: "", store: "" }],
  ])("spaces in the %s count as nothing typed: the fill happens", async (_f, fields) => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const setFields = vi.fn();
    const { result } = renderHook(() => useScanQrLookup({ on: true, store: "711", blocked: false, initial: null, fields: { ...fields, handle: "buyer_a" }, setFields }));
    await act(async () => { result.current.scanned("buyer_a"); await Promise.resolve(); await Promise.resolve(); });
    expect(setFields).toHaveBeenCalledTimes(1);
  });
  it("…and a real character in any of them stops it", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const setFields = vi.fn();
    const { result } = renderHook(() => useScanQrLookup({ on: true, store: "711", blocked: false, initial: null, fields: { name: "", phone: " 0", store: "", handle: "buyer_a" }, setFields }));
    await act(async () => { result.current.scanned("buyer_a"); await Promise.resolve(); await Promise.resolve(); });
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(setFields).not.toHaveBeenCalled();
  });
});

describe("the hook on its own — the username changed by hand", () => {
  const MARK = { handle: "buyer_a", filled: MARIA };
  const hook = (over: Partial<Parameters<typeof useScanQrLookup>[0]> = {}) => {
    const setFields = vi.fn();
    const h = renderHook((p: Partial<Parameters<typeof useScanQrLookup>[0]>) => useScanQrLookup({
      on: true, store: "711", blocked: false, initial: MARK, fields: { ...MARIA, handle: "buyer_a" }, setFields, ...over, ...p,
    }), { initialProps: {} });
    return { ...h, setFields };
  };
  const wiped = (setFields: ReturnType<typeof vi.fn>, cur: { name: string; phone: string; store: string }) =>
    (setFields.mock.calls[0][0] as (c: unknown) => unknown)(cur);

  it("another username: the untouched filled details are blanked (and only those), the fill is forgotten, nothing is read", () => {
    const { result, setFields } = hook();
    act(() => { result.current.changedByHand("buyer_b"); });
    expect(setFields).toHaveBeenCalledTimes(1);
    expect(wiped(setFields, MARIA)).toEqual(BLANK);
    expect(wiped(setFields, { ...MARIA, phone: "0999888777" })).toEqual({ name: "", store: "" }); // judged on the form as it IS at that moment
    expect(result.current.mark).toBeNull();
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it("a detail the seller changed is not in what gets blanked", () => {
    const { result, setFields } = hook({ fields: { ...MARIA, phone: "0999888777", handle: "buyer_a" } });
    act(() => { result.current.changedByHand("buyer_b"); });
    expect(wiped(setFields, { ...MARIA, phone: "0999888777" })).toEqual({ name: "", store: "" });
    expect(result.current.mark).toBeNull();
  });
  it("all three were changed by the seller: nothing is written to the form, the fill is still forgotten", () => {
    const { result, setFields } = hook({ fields: { name: "A", phone: "1", store: "2", handle: "buyer_a" } });
    act(() => { result.current.changedByHand("buyer_b"); });
    expect(setFields).not.toHaveBeenCalled();
    expect(result.current.mark).toBeNull();
  });
  it.each(["buyer_a", "BUYER_A", "@buyer_a", "@Buyer_A (U)", "@ buyer_a", " buyer_a\t"])("the same username (%j): nothing happens, the fill stays remembered", (text) => {
    const { result, setFields } = hook();
    act(() => { result.current.changedByHand(text); });
    expect(setFields).not.toHaveBeenCalled();
    expect(result.current.mark).toEqual(MARK);
  });
  it.each(["buyer_", "buyer_a (U)", "@buyer_a(U)", "(U) @buyer_a", "", "unknown"])("no longer that username (%j): taken back", (text) => {
    const { result, setFields } = hook();
    act(() => { result.current.changedByHand(text); });
    expect(setFields).toHaveBeenCalledTimes(1);
    expect(result.current.mark).toBeNull();
  });
  it("the field says the same username another way and that sticker is scanned again: nothing is read, nothing is written", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const { result, setFields, rerender } = hook();
    act(() => { result.current.changedByHand("@buyer_a (U)"); });
    rerender({ fields: { ...MARIA, handle: "@buyer_a (U)" } });
    await act(async () => { result.current.scanned("buyer_a"); await Promise.resolve(); await Promise.resolve(); });
    expect(m.lookup).not.toHaveBeenCalled();
    expect(setFields).not.toHaveBeenCalled();
    expect(result.current.mark).toEqual(MARK);
  });
  it("an answer is on its way and the username is changed by hand BEFORE the screen re-draws: the answer is dropped", async () => {
    let answer: (v: ScanQrLookupResult) => void = () => {};
    m.lookup.mockImplementationOnce(() => new Promise<ScanQrLookupResult>((res) => { answer = res; }));
    const { result, setFields } = hook({ initial: null, fields: { ...BLANK, handle: "buyer_b" } });
    act(() => { result.current.scanned("buyer_b"); result.current.changedByHand("buyer_c"); });
    await act(async () => { answer(found(rec("b"))); await Promise.resolve(); await Promise.resolve(); });
    expect(setFields).not.toHaveBeenCalled(); // the form says buyer_c now — buyer_b's record must not land under it
    expect(result.current.mark).toBeNull();
  });
  it("while a saved parcel is edited (blocked): nothing happens, whatever is typed", () => {
    const { result, setFields } = hook({ blocked: true });
    act(() => { result.current.changedByHand("buyer_b"); result.current.changedByHand(""); });
    expect(setFields).not.toHaveBeenCalled();
    expect(result.current.mark).toEqual(MARK);
  });
  it("the lookup was turned off after the fill: nothing happens", () => {
    const { result, setFields, rerender } = hook();
    rerender({ on: false });
    act(() => { result.current.changedByHand("buyer_b"); });
    expect(setFields).not.toHaveBeenCalled();
  });
  it("the lookup is off from the start: no fill is ever remembered and nothing happens", () => {
    const { result, setFields } = hook({ on: false });
    expect(result.current.mark).toBeNull();
    act(() => { result.current.changedByHand("buyer_b"); });
    expect(setFields).not.toHaveBeenCalled();
  });
  it("nothing was filled: typing does nothing", () => {
    const { result, setFields } = hook({ initial: null });
    act(() => { result.current.changedByHand("buyer_b"); });
    expect(setFields).not.toHaveBeenCalled();
  });
  it("typed twice in one go (before the screen re-draws): the form is written once", () => {
    const { result, setFields } = hook();
    act(() => { result.current.changedByHand("buyer_b"); result.current.changedByHand("buyer_bc"); });
    expect(setFields).toHaveBeenCalledTimes(1);
  });
  it("after the username was changed by hand, a scan of that same new username is an ordinary first scan", async () => {
    m.lookup.mockResolvedValue(found(rec("b", { name: "Ben Tan", phone: "0922333444", storeId: "135790" })));
    const { result, setFields, rerender } = hook();
    act(() => { result.current.changedByHand("buyer_b"); });
    rerender({ fields: { ...BLANK, handle: "buyer_b" } }); // the screen re-drew with the blanked form
    await act(async () => { result.current.scanned("buyer_b"); await Promise.resolve(); await Promise.resolve(); });
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(result.current.mark).toEqual({ handle: "buyer_b", filled: { name: "Ben Tan", phone: "0922333444", store: "135790" } });
    expect(setFields).toHaveBeenCalledTimes(2);
  });
});

describe("the hook on its own — the read fails (audit LOW-3)", () => {
  it("could not read → nothing is filled, nothing is remembered, onFilled is not called, and no error is thrown", async () => {
    m.lookup.mockResolvedValue({ ok: false });
    const setFields = vi.fn(); const onFilled = vi.fn();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { result } = renderHook(() => useScanQrLookup({ on: true, store: "711", blocked: false, initial: null, fields: { ...BLANK, handle: "buyer_a" }, setFields, onFilled }));
      let threw: unknown = null;
      await act(async () => {
        try { result.current.scanned("buyer_a"); } catch (e) { threw = e; }
        await Promise.resolve(); await Promise.resolve();
        await new Promise((res) => setTimeout(res, 0));
      });
      expect(threw).toBeNull();
      expect(m.lookup).toHaveBeenCalledTimes(1);
      expect(setFields).not.toHaveBeenCalled();
      expect(onFilled).not.toHaveBeenCalled();
      expect(result.current.mark).toBeNull();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("the ⇄ draft and what a fill remembers", () => {
  const mark = { handle: "a", filled: { name: "N", phone: "1", store: "2" } };
  it("it travels with its own screen's entry only; none = the draft exactly as before", () => {
    writeParcelDraft("711", { form: { name: "N" }, noHandle: false, platform: "tiktok", lookup: mark });
    expect(readParcelDraft("711")?.lookup).toEqual(mark);
    expect(readParcelDraft("fm")).toBeNull();
    writeParcelDraft("fm", { form: { name: "X" }, noHandle: false, platform: "tiktok" });
    expect(readParcelDraft("fm")).toEqual({ form: { name: "X" }, noHandle: false, platform: "tiktok" });
    writeParcelDraft("fm", { form: { name: "X" }, noHandle: false, platform: "tiktok", lookup: null });
    expect(Object.keys(readParcelDraft("fm")!)).toEqual(["form", "noHandle", "platform"]);
  });
  it("the hold before a Save blanks it with the form; a failed save puts both back", () => {
    writeParcelDraft("711", { form: { name: "N" }, noHandle: false, platform: "line", lookup: mark });
    const restore = holdParcelDraftForSave("711");
    expect(readParcelDraft("711")).toEqual({ form: { name: "" }, noHandle: false, platform: "line" });
    restore();
    expect(readParcelDraft("711")).toEqual({ form: { name: "N" }, noHandle: false, platform: "line", lookup: mark });
  });
});
