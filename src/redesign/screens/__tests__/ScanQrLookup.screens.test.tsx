// Scan QR → fill from Customers (Jeff 2026-11-12, sql/149) — every situation, on the 7-11 Parcel Scan
// AND the FamilyMart Parcel Scan (same tests, both screens).
//   • a record of the username → name, phone and store from the NEWEST record. No list, no box, no words.
//   • something typed in name, phone or store → nothing is filled, nothing is shown.
//   • no record / error / too slow → exactly as before (username only), no message.
// The QR decode and the lookup read are mocked here (the read itself: adapters/__tests__/scanQrLookup.test.ts;
// the screen with the REAL read and a recording client: ScanQrLookup.offOn.test.tsx).
import { useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
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
  },
  fm: {
    store: "fm" as const, p: "fms", handle: "fms-username",
    el: (x: P) => <FmParcelScan cur="NT$" {...x} />,
    valid: { name: "Jeffrey", phone: "0958704782", store: "022131", amount: "500" },
    savedArg: () => m.saveFmScan.mock.calls[0]?.[0] as unknown,
    savedName: () => (m.saveFmScan.mock.calls[0]?.[0] as { recipientName: string }).recipientName,
    saved: m.saveFmScan,
    seedRow: () => m.loadFmScans.mockResolvedValue({ ok: true, rows: [{ id: "r1", recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-11-10", buyerUsername: "@saved", createdAt: "2026-11-10T03:00:00Z", exportedAt: null, exportBatchId: null }] }),
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
