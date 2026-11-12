// Parcel Scan bridge (Jeff 2026-11-11, Option A). UI only:
//  1. "⇄ 全家" on the 7-11 screen / "⇄ 7-11" on the FamilyMart screen, top right, ≥ 44 px, ONLY when
//     the seller may use BOTH (parcelAllowed and fmScanAllowed).
//  2. A small store badge after each title ("7-11" / "全家").
//  3. The manual entry typed but not saved is kept PER SCREEN and comes back; the two stores never mix.
//  4. The bridge swaps the screen in place (no history) — leaving still lands on Settings.
//  5. FamilyMart Batch row "Batch N / CAP": N = FamilyMart parcels not exported, CAP = the SAME
//     per-account limit as 7-11 (maxPendingParcels → 40 / 50 / 70). At the limit: red, "export first",
//     no NEW save; edit and delete stay open.
//  6. No "All OK" / "need attention" on FamilyMart; the 7-11 row is untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import { clearParcelDrafts, parcelBridgeVisible, readParcelDraft } from "../../adapters/parcelDrafts";
import { setFeatureAccess } from "../../adapters/featureAccess";

const m = vi.hoisted(() => ({
  saveFmScan: vi.fn(), loadFmScans: vi.fn(), deleteFmScan: vi.fn(), loadFmGlobalFee: vi.fn(),
  saveParcelScan: vi.fn(), loadParcelScans: vi.fn(),
}));
vi.mock("../../adapters/fmScan", async (orig) => ({
  ...(await orig<typeof import("../../adapters/fmScan")>()),
  saveFmScan: m.saveFmScan, loadFmScans: m.loadFmScans, deleteFmScan: m.deleteFmScan, loadFmGlobalFee: m.loadFmGlobalFee,
}));
vi.mock("../../adapters/fmCustomers", () => ({
  loadRecentFmCustomers: async () => ({ ok: true, rows: [] }), searchFmCustomers: async () => ({ ok: true, rows: [] }),
  countFmCustomers: async () => ({ ok: true, count: 0 }), updateFmCustomer: async () => ({ ok: true }), deleteFmCustomer: async () => ({ ok: true }),
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

import ParcelScan from "../ParcelScan";
import FmParcelScan from "../FmParcelScan";
import { maxPendingParcels } from "../../adapters/parcelScan";

const fmRow = (id: string, extra = {}) => ({ id, recipientName: "Jeffrey", phone: "0958704782", storeId: "022131", amount: 500, shippingFee: 39, orderDate: "2026-11-11", buyerUsername: "@x", createdAt: "2026-11-11T03:00:00Z", exportedAt: null, exportBatchId: null, ...extra });
const fmRows = (pending: number, exported = 0) => [
  ...Array.from({ length: pending }, (_, i) => fmRow(`p${i}`)),
  ...Array.from({ length: exported }, (_, i) => fmRow(`e${i}`, { exportedAt: "2026-11-10T03:00:00Z", exportBatchId: "b1" })),
];

const fm = (p: { onBridge?: () => void; pendingCap?: number; contactOn?: boolean } = {}) => render(<TProvider lang="en"><FmParcelScan {...p} /></TProvider>);
const seven = (p: { onBridge?: () => void; pendingCap?: number } = {}) => render(<TProvider lang="en"><ParcelScan cur="NT$" manualOnly {...p} /></TProvider>);
const fmLoaded = async (r: ReturnType<typeof fm>) => { await waitFor(() => expect(r.getByTestId("fms-saved-list")).toBeTruthy()); await waitFor(() => expect(m.loadFmGlobalFee).toHaveBeenCalled()); };
const val = (r: ReturnType<typeof render>, id: string) => (r.getByTestId(id) as HTMLInputElement).value;
const type = (r: ReturnType<typeof render>, id: string, v: string) => fireEvent.change(r.getByTestId(id), { target: { value: v } });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.loadFmScans.mockResolvedValue({ ok: true, rows: [] });
  m.loadFmGlobalFee.mockResolvedValue(39);
  m.loadParcelScans.mockResolvedValue({ ok: true, rows: [] });
  m.saveParcelScan.mockResolvedValue({ ok: true, id: "srv-1" });
});
afterEach(() => { cleanup(); clearParcelDrafts(); setFeatureAccess(null, false); });

describe("1 — the ⇄ button shows only when BOTH Parcel Scans are allowed", () => {
  it("rule: both → yes; only one (or none) → no", () => {
    expect(parcelBridgeVisible(true, true)).toBe(true);
    expect(parcelBridgeVisible(true, false)).toBe(false);
    expect(parcelBridgeVisible(false, true)).toBe(false);
    expect(parcelBridgeVisible(false, false)).toBe(false);
  });
  it("RedesignApp passes onBridge to both screens only through that rule; the bridge swaps the screen (no history)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("const parcelBridge = parcelBridgeVisible(parcelAllowed, fmScanAllowed);");
    expect(src).toContain('onBridge={parcelBridge ? () => setScreen("fmparcelscan") : undefined} lookupOn={scanQrLookupOn} />'); // + the Scan QR lookup gate (sql/149)
    expect(src).toContain('<FmParcelScan onBack={() => goBack()} cur={cur} contactOn={buyerContactOn} pendingCap={parcelPendingCap} onBridge={parcelBridge ? openParcelScan : undefined} lookupOn={scanQrLookupOn} />');
    expect(src).not.toMatch(/pushState/); // no history entries → leaving goes to Settings, never back and forth
  });
  it("7-11: no onBridge → no button; with it → '⇄ 全家', ≥ 44 px, opens FamilyMart", async () => {
    let r = seven();
    expect(r.queryByTestId("parcel-bridge")).toBeNull();
    r.unmount();
    const onBridge = vi.fn();
    r = seven({ onBridge });
    const b = r.getByTestId("parcel-bridge");
    expect(b.textContent).toBe("⇄ 全家");
    expect(b.getAttribute("aria-label")).toBe("Open FamilyMart Parcel Scan");
    expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(b);
    expect(onBridge).toHaveBeenCalledTimes(1);
  });
  it("FamilyMart: no onBridge → no button; with it → '⇄ 7-11', ≥ 44 px", async () => {
    let r = fm();
    expect(r.queryByTestId("parcel-bridge")).toBeNull();
    r.unmount();
    const onBridge = vi.fn();
    r = fm({ onBridge });
    const b = r.getByTestId("parcel-bridge");
    expect(b.textContent).toBe("⇄ 7-11");
    expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(b);
    expect(onBridge).toHaveBeenCalledTimes(1);
  });
});

describe("2 — store badge after the title", () => {
  it("'7-11' on the 7-11 screen, '全家' on the FamilyMart screen (with or without the bridge)", () => {
    let r = seven();
    expect(r.getByTestId("parcel-store-badge").textContent).toBe("7-11");
    r.unmount();
    r = fm();
    expect(r.getByTestId("parcel-store-badge").textContent).toBe("全家");
  });
});

describe("3 — typed but not saved comes back; the two stores never mix", () => {
  it("FamilyMart → ⇄ 7-11 → ⇄ 全家: every field and the contact app come back; 7-11 starts blank", async () => {
    let r = fm({ contactOn: true });
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    type(r, "fms-name", "陳小美"); type(r, "fms-phone", "0912345678"); type(r, "fms-store", "022131"); type(r, "fms-amount", "350");
    fireEvent.click(r.getByTestId("fms-bc-pick-line"));
    type(r, "fms-bc-input", "amy.line");
    r.unmount(); // ⇄ 7-11

    let s = seven();
    expect(s.queryByTestId("ps-name")).toBeNull(); // 7-11 manual not open: FamilyMart typing never shows here
    fireEvent.click(await s.findByTestId("ps-manual"));
    expect(val(s, "ps-name")).toBe("");
    s.unmount(); // ⇄ 全家

    r = fm({ contactOn: true });
    expect(r.getByTestId("fms-confirm").getAttribute("data-manual")).toBe("1");
    expect([val(r, "fms-name"), val(r, "fms-phone"), val(r, "fms-store"), val(r, "fms-amount"), val(r, "fms-bc-input")]).toEqual(["陳小美", "0912345678", "022131", "350", "amy.line"]);
    expect(r.getByTestId("fms-bc-pick-line").getAttribute("data-selected")).toBe("1");
    expect(m.saveFmScan).not.toHaveBeenCalled(); // nothing was saved on the way
    expect(m.saveParcelScan).not.toHaveBeenCalled();
    r.unmount();
    s = seven(); // the 7-11 entry opened above comes back open and still blank — nothing of FamilyMart in it
    expect(val(s, "ps-name")).toBe("");
    expect(val(s, "ps-store")).toBe("");
  });
  it("7-11 → ⇄ 全家 → ⇄ 7-11: the 7-11 entry comes back; FamilyMart is its own", async () => {
    let s = seven();
    fireEvent.click(await s.findByTestId("ps-manual"));
    type(s, "ps-name", "Juan"); type(s, "ps-phone", "0958704782"); type(s, "ps-store", "151003"); type(s, "ps-amount", "500"); type(s, "ps-notes", "@juan");
    s.unmount();
    const r = fm();
    await fmLoaded(r);
    expect(r.queryByTestId("fms-confirm")).toBeNull();
    r.unmount();
    s = seven();
    expect([val(s, "ps-name"), val(s, "ps-phone"), val(s, "ps-store"), val(s, "ps-amount"), val(s, "ps-notes")]).toEqual(["Juan", "0958704782", "151003", "500", "@juan"]);
    expect(readParcelDraft("fm")).toBeNull();
  });
  it("'no social handle' comes back ticked", async () => {
    let r = fm();
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    type(r, "fms-name", "Amy");
    fireEvent.click(r.getByTestId("fms-no-handle"));
    r.unmount();
    r = fm();
    expect((r.getByTestId("fms-no-handle") as HTMLInputElement).checked).toBe(true);
  });
  it("Cancel forgets it; a saved parcel is never brought back (no double save)", async () => {
    let r = fm();
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    type(r, "fms-name", "Amy");
    fireEvent.click(r.getByTestId("fms-manual-cancel"));
    r.unmount();
    r = fm();
    expect(r.queryByTestId("fms-confirm")).toBeNull();
    r.unmount();
    // ⇄ while the save is still running: when it lands, the kept entry is blank
    let land!: (v: unknown) => void;
    m.saveFmScan.mockReturnValue(new Promise((res) => { land = res; }));
    r = fm();
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    type(r, "fms-name", "Jeffrey"); type(r, "fms-phone", "0958704782"); type(r, "fms-store", "022131"); type(r, "fms-amount", "500"); type(r, "fms-username", "@jeff");
    fireEvent.click(r.getByTestId("fms-save"));
    r.unmount();
    land({ ok: true, row: fmRow("n1") });
    await waitFor(() => expect(readParcelDraft<{ name: string }>("fm")?.form.name).toBe(""));
    r = fm();
    expect(val(r, "fms-name")).toBe("");
  });
  it("7-11: a save that lands after ⇄ also leaves a blank entry", async () => {
    let land!: (v: unknown) => void;
    m.saveParcelScan.mockReturnValue(new Promise((res) => { land = res; }));
    let s = seven();
    fireEvent.click(await s.findByTestId("ps-manual"));
    type(s, "ps-name", "Juan"); type(s, "ps-phone", "0958704782"); type(s, "ps-store", "151003"); type(s, "ps-amount", "500"); type(s, "ps-notes", "@juan");
    await waitFor(() => expect((s.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(s.getByTestId("ps-save"));
    s.unmount();
    land({ ok: true, id: "srv-1" });
    await waitFor(() => expect(readParcelDraft<{ name: string }>("711")?.form.name).toBe(""));
    s = seven();
    expect(val(s, "ps-name")).toBe("");
  });
  it("an edit of a saved parcel is not kept as a draft", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: [fmRow("a")] });
    const r = fm();
    await waitFor(() => expect(r.getAllByTestId("fms-row")).toHaveLength(1));
    fireEvent.click(r.getByTestId("fms-row-edit"));
    type(r, "fms-name", "Changed");
    expect(readParcelDraft("fm")).toBeNull();
  });
  it("drafts are dropped when the seller changes (RedesignApp)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toMatch(/if \(auth\.status === "anon"\) \{ clearParcelDrafts\(\);/);
    expect(src).toContain("if (draftOwnerRef.current !== null && draftOwnerRef.current !== authUserId) clearParcelDrafts();");
  });
});

describe("5 — FamilyMart Batch N / CAP (its own count, the 7-11 per-account cap)", () => {
  it("N = FamilyMart parcels not exported; exported ones don't count", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: fmRows(3, 2) });
    const r = fm({ pendingCap: 40 });
    await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe("3 / 40"));
    expect(r.getByTestId("fms-batch").getAttribute("data-full")).toBeNull();
    expect(r.queryByTestId("fms-batch-full")).toBeNull();
  });
  it("CAP = maxPendingParcels for the 40 / 50 / 70 accounts, passed to BOTH screens", async () => {
    setFeatureAccess({}, true);
    expect(maxPendingParcels("seller@x.com", "seller")).toBe(40);
    setFeatureAccess({ parcel_cap_tester: true }, true);
    expect(maxPendingParcels("tester@x.com", "seller")).toBe(50);
    setFeatureAccess({ parcel_cap_70: true }, true);
    expect(maxPendingParcels("big@x.com", "seller")).toBe(70);
    for (const cap of [40, 50, 70]) {
      m.loadFmScans.mockResolvedValue({ ok: true, rows: fmRows(1) });
      const r = fm({ pendingCap: cap });
      await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe(`1 / ${cap}`));
      r.unmount();
    }
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("const parcelPendingCap = maxPendingParcels(auth.profile?.email, auth.profile?.role);");
    expect(src).toContain("pendingCap={parcelPendingCap} contactOn={buyerContactOn} frozenCheckOn");
    expect(src).toContain("<FmParcelScan onBack={() => goBack()} cur={cur} contactOn={buyerContactOn} pendingCap={parcelPendingCap}");
    expect(readFileSync("src/redesign/screens/FmParcelScan.tsx", "utf8")).not.toMatch(/pendingCap = \d/); // no written number
  });
  it("at the limit: red pill + 'export first'; no new parcel (button off, Save off, From customers off)", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: fmRows(50, 4) });
    const r = fm({ pendingCap: 50 });
    await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe("50 / 50"));
    expect(r.getByTestId("fms-batch").getAttribute("data-full")).toBe("1");
    expect(r.getByTestId("fms-batch-n").style.color).toBe("var(--danger)");
    expect(r.getByTestId("fms-batch-full").textContent).toBe("Batch full (50) — export your parcels first to add more.");
    const add = r.getByTestId("fms-manual") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(r.queryByTestId("fms-confirm")).toBeNull();
  });
  it("at the limit a kept entry comes back but cannot be saved", async () => {
    let r = fm({ pendingCap: 40 });
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    type(r, "fms-name", "Jeffrey"); type(r, "fms-phone", "0958704782"); type(r, "fms-store", "022131"); type(r, "fms-amount", "500"); type(r, "fms-username", "@jeff");
    expect((r.getByTestId("fms-save") as HTMLButtonElement).disabled).toBe(false);
    r.unmount();
    m.loadFmScans.mockResolvedValue({ ok: true, rows: fmRows(40) }); // the batch filled up meanwhile (another phone)
    r = fm({ pendingCap: 40 });
    await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe("40 / 40"));
    expect(val(r, "fms-name")).toBe("Jeffrey");
    expect((r.getByTestId("fms-save") as HTMLButtonElement).disabled).toBe(true);
    expect((r.getAllByTestId("fms-open-customers")[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("fms-save"));
    expect(m.saveFmScan).not.toHaveBeenCalled();
  });
  it("at the limit, edit and delete of saved parcels still work", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: fmRows(40) });
    m.saveFmScan.mockResolvedValue({ ok: true, row: fmRow("p0", { recipientName: "Edited" }) });
    m.deleteFmScan.mockResolvedValue(true);
    const r = fm({ pendingCap: 40 });
    await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe("40 / 40"));
    fireEvent.click(r.getAllByTestId("fms-row-edit")[0]);
    type(r, "fms-name", "Edited");
    const save = r.getByTestId("fms-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(m.saveFmScan).toHaveBeenCalledWith(expect.objectContaining({ recipientName: "Edited" }), "p0"));
    fireEvent.click(r.getAllByTestId("fms-row-delete")[1]);
    fireEvent.click(r.getByTestId("fms-confirm-delete"));
    await waitFor(() => expect(m.deleteFmScan).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe("39 / 40"));
    expect(r.queryByTestId("fms-batch-full")).toBeNull();
    expect((r.getByTestId("fms-manual") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("6 — FamilyMart has no All OK / attention; 7-11's row is unchanged", () => {
  it("FamilyMart top row = the Batch pill only", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: fmRows(2) });
    const r = fm({ onBridge: () => {} });
    await waitFor(() => expect(r.getByTestId("fms-batch")).toBeTruthy());
    const top = r.getByTestId("fms-topbar");
    expect(Array.from(top.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid"))).toEqual(["fms-batch", "fms-batch-n"]);
    expect(r.queryByTestId("ps-attn")).toBeNull();
    expect(top.textContent).not.toMatch(/All OK|attention/i);
  });
  it("7-11: Batch N / CAP and the All OK pill are still there", async () => {
    const s = seven({ pendingCap: 50, onBridge: () => {} });
    await waitFor(() => expect(s.getByTestId("ps-attn").getAttribute("data-state")).toBe("ok"));
    expect(s.getByTestId("ps-batch-n").textContent).toBe("0 / 50");
  });
});

describe("3b — Save → ⇄ → back BEFORE the save finishes: never a second save", () => {
  const fillFm = (r: ReturnType<typeof fm>) => { type(r, "fms-name", "Jeffrey"); type(r, "fms-phone", "0958704782"); type(r, "fms-store", "022131"); type(r, "fms-amount", "500"); type(r, "fms-username", "@jeff"); };
  const fill711 = (s: ReturnType<typeof seven>) => { type(s, "ps-name", "Juan"); type(s, "ps-phone", "0958704782"); type(s, "ps-store", "151003"); type(s, "ps-amount", "500"); type(s, "ps-notes", "@juan"); };

  it("FamilyMart: back while saving → blank form, Save off; when it lands → 1 save only", async () => {
    let land!: (v: unknown) => void;
    m.saveFmScan.mockReturnValue(new Promise((res) => { land = res; }));
    let r = fm();
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    fillFm(r);
    fireEvent.click(r.getByTestId("fms-save"));
    r.unmount(); // ⇄ 7-11 while the save runs
    r = fm();    // ⇄ 全家 — the save has NOT landed yet
    await fmLoaded(r);
    expect(r.getByTestId("fms-confirm").getAttribute("data-manual")).toBe("1");
    expect([val(r, "fms-name"), val(r, "fms-phone"), val(r, "fms-store"), val(r, "fms-amount"), val(r, "fms-username")]).toEqual(["", "", "", "", ""]);
    const save = r.getByTestId("fms-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    land({ ok: true, row: fmRow("n1") });
    await waitFor(() => expect(readParcelDraft<{ name: string }>("fm")?.form.name).toBe(""));
    expect(m.saveFmScan).toHaveBeenCalledTimes(1);
  });
  it("7-11: back while saving → blank form, Save off; when it lands → 1 save only", async () => {
    let land!: (v: unknown) => void;
    m.saveParcelScan.mockReturnValue(new Promise((res) => { land = res; }));
    let s = seven();
    fireEvent.click(await s.findByTestId("ps-manual"));
    fill711(s);
    await waitFor(() => expect((s.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(s.getByTestId("ps-save"));
    s.unmount();
    s = seven();
    expect([val(s, "ps-name"), val(s, "ps-phone"), val(s, "ps-store"), val(s, "ps-amount"), val(s, "ps-notes")]).toEqual(["", "", "", "", ""]);
    const save = s.getByTestId("ps-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    land({ ok: true, id: "srv-1" });
    await waitFor(() => expect(m.saveParcelScan).toHaveBeenCalledTimes(1));
    await new Promise((res) => setTimeout(res, 50));
    expect(m.saveParcelScan).toHaveBeenCalledTimes(1);
  });
  it("a save that FAILS after ⇄ puts the typed entry back (FamilyMart and 7-11)", async () => {
    let landFm!: (v: unknown) => void;
    m.saveFmScan.mockReturnValue(new Promise((res) => { landFm = res; }));
    let r = fm();
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    fillFm(r);
    fireEvent.click(r.getByTestId("fms-save"));
    r.unmount();
    landFm({ ok: false });
    await waitFor(() => expect(readParcelDraft<{ name: string }>("fm")?.form.name).toBe("Jeffrey"));
    r = fm();
    expect(val(r, "fms-name")).toBe("Jeffrey");
    expect(val(r, "fms-username")).toBe("@jeff");

    let land7!: (v: unknown) => void;
    m.saveParcelScan.mockReturnValue(new Promise((res) => { land7 = res; }));
    let s = seven();
    fireEvent.click(await s.findByTestId("ps-manual"));
    fill711(s);
    await waitFor(() => expect((s.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(s.getByTestId("ps-save"));
    s.unmount();
    land7({ ok: false, error: "x" });
    await waitFor(() => expect(readParcelDraft<{ name: string }>("711")?.form.name).toBe("Juan"));
    s = seven();
    expect(val(s, "ps-name")).toBe("Juan");
  });
  it("a new parcel typed while the old save runs is kept, even if the old save fails", async () => {
    let land!: (v: unknown) => void;
    m.saveFmScan.mockReturnValue(new Promise((res) => { land = res; }));
    let r = fm();
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    fillFm(r);
    fireEvent.click(r.getByTestId("fms-save"));
    r.unmount();
    r = fm();
    await fmLoaded(r);
    type(r, "fms-name", "Next Buyer");
    land({ ok: false });
    await new Promise((res) => setTimeout(res, 20));
    expect(readParcelDraft<{ name: string }>("fm")?.form.name).toBe("Next Buyer");
  });
});

describe("5b — FamilyMart: no NEW parcel until the saved list loaded OK", () => {
  const blockedNew = (r: ReturnType<typeof fm>) => {
    expect((r.getByTestId("fms-manual") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("fms-manual"));
    expect(r.queryByTestId("fms-confirm")).toBeNull();
  };
  it("load FAILED → no Batch row, a short 'open again' note, Add parcel off", async () => {
    m.loadFmScans.mockResolvedValue({ ok: false, rows: [] });
    const r = fm();
    await waitFor(() => expect(r.getByTestId("fms-load-err").textContent).toBe("Couldn't load your FamilyMart parcels. Close this screen and open it again."));
    expect(r.queryByTestId("fms-batch")).toBeNull(); // never a fake "0 / 40"
    blockedNew(r);
  });
  it("load threw → same", async () => {
    m.loadFmScans.mockRejectedValue(new Error("network"));
    const r = fm();
    await waitFor(() => expect(r.getByTestId("fms-load-err")).toBeTruthy());
    blockedNew(r);
  });
  it("load still PENDING → Add parcel off; a kept entry comes back but Save and From customers are off", async () => {
    let r = fm({ contactOn: false });
    await fmLoaded(r);
    fireEvent.click(r.getByTestId("fms-manual"));
    type(r, "fms-name", "Jeffrey"); type(r, "fms-phone", "0958704782"); type(r, "fms-store", "022131"); type(r, "fms-amount", "500"); type(r, "fms-username", "@jeff");
    r.unmount();
    let finish!: (v: unknown) => void;
    m.loadFmScans.mockReturnValue(new Promise((res) => { finish = res; }));
    r = fm();
    expect(r.queryByTestId("fms-batch")).toBeNull();
    expect(r.queryByTestId("fms-load-err")).toBeNull();
    expect(val(r, "fms-name")).toBe("Jeffrey");
    expect((r.getByTestId("fms-save") as HTMLButtonElement).disabled).toBe(true);
    expect((r.getAllByTestId("fms-open-customers")[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("fms-save"));
    expect(m.saveFmScan).not.toHaveBeenCalled();
    finish({ ok: true, rows: fmRows(2) });
    await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe("2 / 40"));
    expect((r.getByTestId("fms-save") as HTMLButtonElement).disabled).toBe(false); // load OK → normal
  });
  it("load OK → normal: Batch shows, Add parcel on, no note", async () => {
    m.loadFmScans.mockResolvedValue({ ok: true, rows: fmRows(1) });
    const r = fm();
    await waitFor(() => expect(r.getByTestId("fms-batch-n").textContent).toBe("1 / 40"));
    expect(r.queryByTestId("fms-load-err")).toBeNull();
    expect((r.getByTestId("fms-manual") as HTMLButtonElement).disabled).toBe(false);
    expect(r.getByTestId("fms-manual").textContent).toBe("✏️ Manual add parcel"); // Nov 11 2026: same name as 7-11
  });
  it("load failed: edit / delete of rows already on screen are not blocked by it (pinned in code)", () => {
    const src = readFileSync("src/redesign/screens/FmParcelScan.tsx", "utf8");
    expect(src).toContain("(newBlocked && !editing)");
    expect(src).toContain("const newBlocked = !listOk || batchFull;");
  });
});
