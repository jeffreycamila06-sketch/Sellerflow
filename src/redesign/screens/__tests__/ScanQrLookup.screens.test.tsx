// Scan QR → look the scanned @username up in Customers (Jeff 2026-11-11, sql/149) — every
// situation, on the 7-11 Parcel Scan AND the FamilyMart Parcel Scan (same tests, both screens).
// The QR decode and the lookup read are mocked here (the read itself: adapters/__tests__/scanQrLookup.test.ts;
// the screen with the REAL read and a recording client: ScanQrLookup.offOn.test.tsx).
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
// The Customers overlays, reduced to one button that reports a finished import.
vi.mock("../CustomerDetails", () => ({ default: ({ onImported }: { onImported?: () => void }) => <button data-testid="stub-imported" onClick={() => onImported?.()}>import</button> }));
vi.mock("../FmCustomerDetails", () => ({ default: ({ onImported }: { onImported?: () => void }) => <button data-testid="stub-imported" onClick={() => onImported?.()}>import</button> }));

import ParcelScan from "../ParcelScan";
import FmParcelScan from "../FmParcelScan";

type P = { lookupOn?: boolean; contactOn?: boolean };
const SCREENS = {
  "711": {
    store: "711" as const, p: "ps", handle: "ps-notes",
    el: (x: P) => <ParcelScan cur="NT$" manualOnly {...x} />,
    valid: { name: "Ana Cruz", phone: "0912345678", store: "123456", amount: "500" },
    savedArg: () => m.saveParcelScan.mock.calls[0]?.[0] as { name: string; phone: string; store_id: string; notes: string },
    savedName: () => (m.saveParcelScan.mock.calls[0]?.[0] as { name: string }).name,
    saved: m.saveParcelScan,
    seedRow: () => m.loadParcelScans.mockResolvedValue({ ok: true, rows: [{ id: "r1", customerName: "Saved Buyer", phone: "0912345678", storeId: "982063", amount: 550, notes: "@saved", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-11-10T00:00:00Z" }] }),
  },
  fm: {
    store: "fm" as const, p: "fms", handle: "fms-username",
    el: (x: P) => <FmParcelScan cur="NT$" {...x} />,
    valid: { name: "Jeffrey", phone: "0958704782", store: "022131", amount: "500" },
    savedArg: () => m.saveFmScan.mock.calls[0]?.[0] as { recipientName: string },
    savedName: () => (m.saveFmScan.mock.calls[0]?.[0] as { recipientName: string }).recipientName,
    saved: m.saveFmScan,
    seedRow: () => m.loadFmScans.mockResolvedValue({ ok: true, rows: [{ id: "r1", recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-11-10", buyerUsername: "@saved", createdAt: "2026-11-10T03:00:00Z", exportedAt: null, exportBatchId: null }] }),
  },
};
type Key = keyof typeof SCREENS;

const rec = (id: string, over: Partial<ScanQrLookupRow> = {}): ScanQrLookupRow => ({ id, name: "Maria Santos", phone: "0911222333", storeId: "246810", updatedAt: "2026-11-01T02:00:00+00:00", ...over });
const found = (...rows: ScanQrLookupRow[]): ScanQrLookupResult => ({ ok: true, rows, more: false });
const qrFile = () => new File([new Uint8Array([1])], "sticker.jpg", { type: "image/jpeg" });

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

describe.each(Object.keys(SCREENS) as Key[])("Scan QR → Customers lookup — %s Parcel Scan", (key) => {
  const S = SCREENS[key];
  const id = (s: string) => `${S.p}-${s}`;
  const mount = (x: P = { lookupOn: true }) => render(<TProvider lang="en">{S.el(x)}</TProvider>);
  type R = ReturnType<typeof mount>;
  const val = (r: R, t: string) => (r.getByTestId(t) as HTMLInputElement).value;
  const type = (r: R, t: string, v: string) => fireEvent.change(r.getByTestId(t), { target: { value: v } });
  const details = (r: R) => ({ name: val(r, id("name")), phone: val(r, id("phone")), store: val(r, id("store")) });
  const BLANK = { name: "", phone: "", store: "" };
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
  const box = (r: R) => r.queryByTestId(id("ql"));
  // A lookup the test answers by hand (slow network).
  const slow = () => {
    let answer: (v: ScanQrLookupResult) => void = () => {};
    m.lookup.mockImplementationOnce(() => new Promise<ScanQrLookupResult>((res) => { answer = res; }));
    return (v: ScanQrLookupResult) => act(async () => { answer(v); await Promise.resolve(); });
  };

  it("ONE record: name, phone and store are filled; contact = the scanned username; blue box with 'please check' and the last-updated date; cursor in Amount", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = await open();
    await scan(r, "https://tiktok.com/@Maria_Shops", "Maria_Shops");
    await waitFor(() => expect(details(r)).toEqual({ name: "Maria Santos", phone: "0911222333", store: "246810" }));
    expect(val(r, S.handle)).toBe("Maria_Shops");
    expect(val(r, id("amount"))).toBe("");
    expect(box(r)?.getAttribute("data-kind")).toBe("found");
    expect(r.getByTestId(id("ql-title")).textContent).toBe("Found in Customers: @maria_shops — please check");
    expect(r.getByTestId(id("ql-date")).textContent).toBe("last updated Nov 1, 2026");
    expect(document.activeElement).toBe(r.getByTestId(id("amount")));
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(m.lookup).toHaveBeenCalledWith(S.store, "maria_shops"); // this screen's own Customers, never the other one's
    // everything stays editable
    type(r, id("name"), "Maria S.");
    expect(val(r, id("name"))).toBe("Maria S.");
  });

  it("2+ records: ALWAYS a list — nothing is chosen for the seller; all records, newest first, each with its date", async () => {
    m.lookup.mockResolvedValue(found(
      rec("new", { name: "Maria Santos", storeId: "246810", updatedAt: "2026-11-09T02:00:00+00:00" }),
      rec("mid", { name: "Maria S", storeId: "135791", updatedAt: "2026-10-02T02:00:00+00:00" }),
      rec("old", { name: "Mariah Santos", storeId: "246810", updatedAt: "2026-09-20T02:00:00+00:00" }),
    ));
    const r = await open();
    await scan(r, "https://tiktok.com/@annc_tw", "annc_tw");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("choose"));
    expect(details(r)).toEqual(BLANK); // nothing filled
    expect(r.getByTestId(id("ql-title")).textContent).toBe("3 records for @annc_tw — different stores");
    const picks = r.getAllByTestId(id("ql-pick"));
    expect(picks.map((b) => b.textContent)).toEqual([
      "Maria Santos0911222333246810last updated Nov 9, 2026",
      "Maria S0911222333135791last updated Oct 2, 2026",
      "Mariah Santos0911222333246810last updated Sep 20, 2026",
    ]);
    for (const b of [...picks, r.getByTestId(id("ql-none"))]) expect(b.style.minHeight).toBe("44px"); // thumb-sized
    fireEvent.click(picks[1]);
    await waitFor(() => expect(details(r)).toEqual({ name: "Maria S", phone: "0911222333", store: "135791" }));
    expect(box(r)?.getAttribute("data-kind")).toBe("found");
    expect(r.getByTestId(id("ql-date")).textContent).toBe("last updated Oct 2, 2026");
    expect(val(r, S.handle)).toBe("annc_tw");
  });

  it("2 records that differ only in the name spelling: still a list (never picked for the seller)", async () => {
    m.lookup.mockResolvedValue(found(rec("a", { name: "Maria Santos" }), rec("b", { name: "Maria Santoss", updatedAt: "2026-10-01T02:00:00+00:00" })));
    const r = await open();
    await scan(r, "annc_tw", "annc_tw");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("choose"));
    expect(r.getByTestId(id("ql-title")).textContent).toBe("2 records for @annc_tw");
    expect(details(r)).toEqual(BLANK);
  });

  it("'Not here — I'll type it' closes the list and fills nothing", async () => {
    m.lookup.mockResolvedValue(found(rec("a"), rec("b", { storeId: "135791" })));
    const r = await open();
    await scan(r, "annc_tw", "annc_tw");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("choose"));
    expect(r.getByTestId(id("ql-none")).textContent).toBe("Not here — I'll type it");
    fireEvent.click(r.getByTestId(id("ql-none")));
    expect(box(r)).toBeNull();
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("annc_tw");
  });

  it("NO record: the form is exactly what it is with the lookup off — while waiting AND after (no box, no extra line, same toast, button free)", async () => {
    const off = await open({ lookupOn: false });
    await scan(off, "https://tiktok.com/@new_buyer", "new_buyer");
    const offCard = off.getByTestId(id("confirm")).innerHTML;
    const offToast = off.getByTestId(id("toast")).textContent;
    expect(offToast).toBe("Filled @username from QR");
    expect(m.lookup).not.toHaveBeenCalled();
    cleanup(); clearParcelDrafts();

    const answer = slow();
    const on = await open({ lookupOn: true });
    await scan(on, "https://tiktok.com/@new_buyer", "new_buyer");
    expect(m.lookup).toHaveBeenCalledTimes(1);
    // still waiting for the answer: same form, same toast, Scan QR already free
    expect(on.getByTestId(id("confirm")).innerHTML).toBe(offCard);
    expect(on.getByTestId(id("toast")).textContent).toBe(offToast);
    expect((on.getByTestId(id("scan-qr")) as HTMLButtonElement).disabled).toBe(false);
    await answer(found());
    expect(on.getByTestId(id("confirm")).innerHTML).toBe(offCard);
    expect(on.getByTestId(id("toast")).textContent).toBe(offToast);
    expect(box(on)).toBeNull();
  });

  it("error / no signal / too slow: the username is in, one short message, nothing else", async () => {
    m.lookup.mockResolvedValue({ ok: false });
    const r = await open();
    await scan(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(r.getByTestId(id("toast")).textContent).toBe("Couldn't look up Customers now — type it, or use Customers"));
    expect(details(r)).toEqual(BLANK);
    expect(box(r)).toBeNull();
  });

  it("QR not readable / not a TikTok QR: as before — no lookup at all", async () => {
    const r = await open();
    await scan(r, null);
    await waitFor(() => expect(r.getByTestId(id("toast")).textContent).toBe("No QR found — type the username"));
    await scan(r, "https://youtube.com/@someone");
    expect(val(r, S.handle)).toBe("");
    expect(m.lookup).not.toHaveBeenCalled();
  });

  it("scan A (filled) then scan B (no record): none of A's details stay with B's username", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r).name).toBe("Maria Santos"));
    m.lookup.mockResolvedValueOnce(found());
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(r)).toEqual(BLANK);
    expect(box(r)).toBeNull();
  });

  it("scan A then scan B (one record): B's details replace A's, the box is about B", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r).name).toBe("Maria Santos"));
    m.lookup.mockResolvedValueOnce(found(rec("b", { name: "Pedro Reyes", phone: "0933444555", storeId: "975310" })));
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(details(r)).toEqual({ name: "Pedro Reyes", phone: "0933444555", store: "975310" }));
    expect(r.getByTestId(id("ql-title")).textContent).toBe("Found in Customers: @buyer_b — please check");
  });

  it("scan A, the seller edits one detail, scan B (no record): the edited one stays, the untouched ones go, and the box says whose details they were", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r).name).toBe("Maria Santos"));
    type(r, id("name"), "Maria Santos Jr");
    m.lookup.mockResolvedValueOnce(found());
    await scan(r, "buyer_b", "buyer_b");
    await waitFor(() => expect(m.lookup).toHaveBeenCalledTimes(2));
    expect(details(r)).toEqual({ name: "Maria Santos Jr", phone: "", store: "" });
    expect(box(r)?.getAttribute("data-kind")).toBe("mismatch");
    expect(r.getByTestId(id("ql-title")).textContent).toBe("These details came from @buyer_a — please check");
  });

  it("the seller changes the username by hand after a fill: the box turns into 'these details came from @x'", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("found"));
    type(r, S.handle, "someone_else");
    expect(box(r)?.getAttribute("data-kind")).toBe("mismatch");
    type(r, S.handle, "@Buyer_A");
    expect(box(r)?.getAttribute("data-kind")).toBe("found");
  });

  it("something is typed already: never overwritten — a suggestion with 'Use'; 'Use' writes name, phone and store only", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    type(r, id("name"), "Typed Name");
    type(r, id("amount"), "777");
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("suggest"));
    expect(details(r)).toEqual({ name: "Typed Name", phone: "", store: "" });
    expect(r.getByTestId(id("ql-row")).textContent).toBe("Maria Santos0911222333246810last updated Nov 1, 2026");
    const use = r.getByTestId(id("ql-use"));
    expect(use.textContent).toBe("Use");
    expect(use.style.minHeight).toBe("44px");
    fireEvent.click(use);
    await waitFor(() => expect(details(r)).toEqual({ name: "Maria Santos", phone: "0911222333", store: "246810" }));
    expect(val(r, id("amount"))).toBe("777");
    expect(val(r, S.handle)).toBe("buyer_a");
    expect(box(r)?.getAttribute("data-kind")).toBe("found");
  });

  it("slow answer: the seller typed while waiting → the answer never overwrites, it becomes a suggestion; the cursor is not pulled away", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    const phone = r.getByTestId(id("phone")) as HTMLInputElement;
    phone.focus();
    type(r, id("phone"), "0999");
    await answer(found(rec("a")));
    expect(details(r)).toEqual({ name: "", phone: "0999", store: "" });
    expect(box(r)?.getAttribute("data-kind")).toBe("suggest");
    expect(document.activeElement).toBe(phone);
  });

  it("one record while the cursor is in another field: filled, but the cursor stays where the seller is", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    const handle = r.getByTestId(S.handle) as HTMLInputElement;
    handle.focus();
    await answer(found(rec("a")));
    expect(details(r).name).toBe("Maria Santos");
    expect(document.activeElement).toBe(handle);
  });

  it("the username was changed by hand while waiting: the late answer is dropped", async () => {
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    type(r, S.handle, "other_person");
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
    expect(box(r)).toBeNull();
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
    expect(r.getByTestId(id("ql-title")).textContent).toBe("Found in Customers: @buyer_b — please check");
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
    expect(box(r)).toBeNull();
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
    expect(box(r)).toBeNull();
  });

  it("Save while the lookup is still running: what was typed is saved, Save is never held, and the late answer does NOT fill the next parcel", async () => {
    const answer = slow();
    const r = await open();
    type(r, id("name"), S.valid.name); type(r, id("phone"), S.valid.phone); type(r, id("store"), S.valid.store); type(r, id("amount"), S.valid.amount);
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect((r.getByTestId(id("save")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("save")));
    await waitFor(() => expect(S.saved).toHaveBeenCalledTimes(1));
    expect(S.savedName()).toBe(S.valid.name);
    await waitFor(() => expect(val(r, id("name"))).toBe(""));
    await answer(found(rec("a")));
    expect(details(r)).toEqual(BLANK);
    expect(val(r, S.handle)).toBe("");
    expect(box(r)).toBeNull();
  });

  it("the filled form is an ordinary form: it is saved through the same Save, with the record's details and the scanned username", async () => {
    m.lookup.mockResolvedValue(found(rec("a", S.valid)));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r).name).toBe(S.valid.name));
    type(r, id("amount"), "500");
    await waitFor(() => expect((r.getByTestId(id("save")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("save")));
    await waitFor(() => expect(S.saved).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(S.savedArg())).toContain(S.valid.name);
    expect(JSON.stringify(S.savedArg())).toContain("buyer_a");
    // after the save: blank form for the next parcel, no box left over
    await waitFor(() => expect(details(r)).toEqual(BLANK));
    expect(box(r)).toBeNull();
  });

  it("Cancel clears the box and the list; reopening the entry shows a clean form", async () => {
    m.lookup.mockResolvedValue(found(rec("a"), rec("b", { storeId: "135791" })));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("choose"));
    fireEvent.click(r.getByTestId(id("manual-cancel")));
    fireEvent.click(r.getByTestId(id("manual")));
    expect(box(r)).toBeNull();
    expect(val(r, S.handle)).toBe("");
  });

  it("a finished import from Customers clears the box and the details the lookup wrote (the details the seller typed stay)", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("found"));
    type(r, id("name"), "Edited By Seller");
    fireEvent.click(r.getByTestId(id("open-customers")));
    fireEvent.click(await r.findByTestId("stub-imported"));
    await waitFor(() => expect(box(r)).toBeNull());
    expect(details(r)).toEqual({ name: "Edited By Seller", phone: "", store: "" });
  });

  it("editing a SAVED parcel: Scan QR fills the username as before — no lookup, no box", async () => {
    S.seedRow();
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = mount({ lookupOn: true });
    fireEvent.click(await r.findByTestId(id("row-edit")));
    await waitFor(() => expect(r.getByTestId(id("confirm")).getAttribute("data-editing")).toBe("1"));
    const before = details(r);
    await scan(r, "buyer_a", "buyer_a");
    expect(m.lookup).not.toHaveBeenCalled();
    expect(details(r)).toEqual(before);
    expect(box(r)).toBeNull();
  });

  it("starting an edit while a lookup is running drops its answer; the box of the entry before is gone", async () => {
    S.seedRow();
    const answer = slow();
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    fireEvent.click(await r.findByTestId(id("row-edit"))); // straight from the open entry
    await waitFor(() => expect(r.getByTestId(id("confirm")).getAttribute("data-editing")).toBe("1"));
    const before = details(r);
    await answer(found(rec("a")));
    expect(details(r)).toEqual(before);
    expect(box(r)).toBeNull();
    // and with the saved parcel's own username put back by a scan: still nothing
    await scan(r, "saved", "saved");
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(details(r)).toEqual(before);
  });

  it("a box on the open entry is not shown on a saved parcel being edited, and is gone after the edit is cancelled", async () => {
    S.seedRow();
    m.lookup.mockResolvedValue(found(rec("a"), rec("b", { storeId: "135791" })));
    const r = await open();
    await scan(r, "saved", "saved"); // the same username as the saved parcel that is edited next
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("choose"));
    fireEvent.click(await r.findByTestId(id("row-edit")));
    await waitFor(() => expect(r.getByTestId(id("confirm")).getAttribute("data-editing")).toBe("1"));
    expect(box(r)).toBeNull();
    fireEvent.click(r.getByTestId(id("edit-cancel")));
    if (!r.queryByTestId(id("confirm"))) fireEvent.click(r.getByTestId(id("manual")));
    expect(box(r)).toBeNull();
    expect(details(r)).toEqual(BLANK);
  });

  it("'no handle' was ticked before the scan: after a match the contact is the scanned username and the tick is off", async () => {
    m.lookup.mockResolvedValue(found(rec("a")));
    const r = await open();
    fireEvent.click(r.getByTestId(id("no-handle")));
    expect((r.getByTestId(id("no-handle")) as HTMLInputElement).checked).toBe(true);
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(details(r).name).toBe("Maria Santos"));
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

  it("⇄ and back: the form AND the box return on this screen; a scan of B afterwards still clears A's untouched details", async () => {
    m.lookup.mockResolvedValueOnce(found(rec("a")));
    const r = await open();
    await scan(r, "buyer_a", "buyer_a");
    await waitFor(() => expect(box(r)?.getAttribute("data-kind")).toBe("found"));
    await waitFor(() => expect(readParcelDraft(S.store)?.lookup?.applied?.handle).toBe("buyer_a"));
    r.unmount();
    // the OTHER store's entry never gets any of it
    expect(readParcelDraft(S.store === "711" ? "fm" : "711")).toBeNull();
    const back = mount({ lookupOn: true });
    await waitFor(() => expect(back.getByTestId(id("confirm"))).toBeTruthy());
    expect(details(back)).toEqual({ name: "Maria Santos", phone: "0911222333", store: "246810" });
    expect(back.getByTestId(id("ql-title")).textContent).toBe("Found in Customers: @buyer_a — please check");
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
    expect(box(r)).toBeNull();
    expect(r.getByTestId(id("toast")).textContent).toBe("Filled @username from QR");
    await waitFor(() => expect(readParcelDraft<Record<string, string>>(S.store)).not.toBeNull());
    expect(Object.keys(readParcelDraft(S.store)!).sort()).toEqual(["form", "noHandle", "platform"]); // the draft is what it was before
  });

  it("the words are in the seller's language (Filipino shown), incl. the last-updated date", async () => {
    m.lookup.mockResolvedValue(found(rec("c1")));
    const r = render(<TProvider lang="fil">{S.el({ lookupOn: true })}</TProvider>);
    await waitFor(() => expect((r.getByTestId(id("manual")) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(r.getByTestId(id("manual")));
    await scan(r, "maria_shops", "maria_shops");
    await waitFor(() => expect(r.getByTestId(id("ql-title")).textContent).toBe("Nahanap sa Customers: @maria_shops — pakisuri"));
    expect(r.getByTestId(id("ql-date")).textContent).toMatch(/^huling na-update .*2026/);
  });
});

describe("the ⇄ draft and the lookup mark", () => {
  const mark = { applied: { handle: "a", updatedAt: "2026-11-01T00:00:00+00:00", filled: { name: "N", phone: "1", store: "2" } }, pending: null };
  it("the mark travels with its own screen's entry only; no mark = the draft exactly as before", () => {
    writeParcelDraft("711", { form: { name: "N" }, noHandle: false, platform: "tiktok", lookup: mark });
    expect(readParcelDraft("711")?.lookup).toEqual(mark);
    expect(readParcelDraft("fm")).toBeNull();
    writeParcelDraft("fm", { form: { name: "X" }, noHandle: false, platform: "tiktok" });
    expect(readParcelDraft("fm")).toEqual({ form: { name: "X" }, noHandle: false, platform: "tiktok" });
    writeParcelDraft("fm", { form: { name: "X" }, noHandle: false, platform: "tiktok", lookup: null });
    expect(Object.keys(readParcelDraft("fm")!)).toEqual(["form", "noHandle", "platform"]);
  });
  it("the hold before a Save blanks the mark with the form; a failed save puts both back", () => {
    writeParcelDraft("711", { form: { name: "N" }, noHandle: false, platform: "line", lookup: mark });
    const restore = holdParcelDraftForSave("711");
    expect(readParcelDraft("711")).toEqual({ form: { name: "" }, noHandle: false, platform: "line" });
    restore();
    expect(readParcelDraft("711")).toEqual({ form: { name: "N" }, noHandle: false, platform: "line", lookup: mark });
  });
});
