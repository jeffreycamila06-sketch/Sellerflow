// Invoicing → Facebook ✎ View — the save fix (2026-11-28, Jeff's buyer #1: edited, closed, reopened → the orders
// again, and Send all would have sent the old receipt). Pins:
//   • buyer #1's own start lines ("99" ₱99, "200" ₱0): a change is saved, the row says Edited, it is read back;
//   • the Save button: off with nothing to save, saves AT ONCE, "✓ Saved" only after the server's yes;
//   • a save with no answer → after the wait it counts as failed (red line, Save on again), never "Saved";
//   • the list drawn again (a tab switch / a new order) while a save is on its way: the new list shows Edited when
//     it lands, and Send all / that buyer's Send WAIT meanwhile (on main the new list missed it → the orders again);
//   • a save that fails after the sheet is gone: Send all stops with "#N" until the seller looks at it;
//   • the page reloading with a change not saved → the browser asks first;
//   • "I sent it by hand" only after a failed send — also for "unknown".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
const m = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));

import { TProvider, buildT, tpl } from "../../i18n";
import Invoicing from "../Invoicing";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";
import { FB_EDIT_SAVE_MS, _resetReceiptEditSaves } from "../../adapters/fbReceiptEdit";

const SID = "11111111-2222-3333-4444-555555555555";
const t = buildT("en") as unknown as Record<string, string>;
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const fb = (n: number, name: string, product: string, price: number, min = n) =>
  ({ buyer_number: n, handle: name, customer_name: name, platform: "Facebook", product, price, created_at: `2026-11-26T05:${String(min).padStart(2, "0")}:00.000Z`, session_date: "2026-11-26" });
// #1 = Jeff's buyer: two lines, "99" for ₱99 and "200" for ₱0
const ROWS = [fb(1, "Jeff Buyer", "99", 99, 1), fb(1, "Jeff Buyer", "200", 0, 2), fb(2, "Ana Cruz", "Dress", 350, 3), fb(6, "Mia Go", "Cap", 90, 6)];
const buyers = () => rebuildSessionFromRows(ROWS as never).buyers;
const STATUS = { ok: true, access: true, allowed: true, job: null, needsMessaging: false,
  buyers: [{ n: 1, tag: "not_sent" }, { n: 2, tag: "not_sent" }, { n: 6, tag: "unknown" }] };
const S = { calls: [] as { path: string; body: Record<string, unknown> }[] };
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const path = new URL(url).pathname;
  S.calls.push({ path, body: JSON.parse(init.body) });
  const json = path === "/fb/sendall/status" ? STATUS : path === "/fb/sendall/start" ? { ok: true, already: false } : { ok: false };
  return { status: 200, json: async () => json } as unknown as Response;
});
const starts = () => S.calls.filter((c) => c.path === "/fb/sendall/start");
const writes = () => DB.s.calls.filter((c) => c.table === "fb_receipt_edits" && (c.op === "upsert" || c.op === "delete"));
async function open() {
  render(
    <TProvider lang="en">
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={buyers()} sessionKey={SID} sessionId={SID} sellerId="u1" todayId="2026-11-26" tapGuardMs={0}
          onReceiptFormat={() => {}} fbSendAll={{ lang: "en" }} />
      </div>
    </TProvider>,
  );
  await flush();
  fireEvent.click(q("ivc-tab-facebook")!);
  await flush();
}
const rowOf = (n: number) => [...document.querySelectorAll("[data-testid='ivc-fb-row']")].find((r) => r.getAttribute("data-buyer") === String(n))! as HTMLElement;
const view = async (n: number) => { fireEvent.click(rowOf(n).querySelector("[data-testid='ivc-fb-row-view']")!); await flush(); };
const inSheet = (id: string) => [...q("ivc-fb-sheet")!.querySelectorAll(`[data-testid='${id}']`)] as HTMLInputElement[];
const editedTag = (n: number) => rowOf(n).querySelector("[data-testid='ivc-fb-row-edited']");
const btn = (id: string) => q(id) as HTMLButtonElement;
const toTikTokAndBack = async () => { fireEvent.click(q("ivc-tab-tiktok")!); await flush(); fireEvent.click(q("ivc-tab-facebook")!); await flush(); };

beforeEach(() => {
  _resetReceiptEditSaves();
  DB.reset(); localStorage.clear();
  DB.s.settings.set("u1", { user_id: "u1", opening: "Hi!", note: "Pay by GCash", qr_image: null, invoice_shipping_fee: 60 });
  S.calls = [];
  m.render.mockReset();
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  if (typeof URL.createObjectURL !== "function") (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); _resetReceiptEditSaves(); });

describe("buyer #1's own receipt (\"99\" ₱99 and \"200\" ₱0)", () => {
  it("starts from the orders, a change is saved, Edited, and the edit is what a reopened sheet shows", async () => {
    await open(); await view(1);
    expect(inSheet("rs-item").map((i) => i.value)).toEqual(["99", "200"]);
    expect(inSheet("rs-price").map((i) => i.value)).toEqual(["99", "0"]);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "150" } });
    fireEvent.change(inSheet("rs-price")[1], { target: { value: "200" } });
    await wait(FB_EDIT_SAVE_MS + 300);
    expect(DB.s.edits).toEqual([expect.objectContaining({ buyer_number: 1, lines: [{ item: "99", price: 150 }, { item: "200", price: 200 }], shipping_fee: 60 })]);
    expect(q("ivc-fb-sheet-edited")!.textContent).toBe(t.rd_ivc_fb_edited);
    fireEvent.click(q("ivc-fb-sheet-close")!); await flush();
    expect(q("ivc-fb-sheet")).toBeNull();
    expect(editedTag(1)!.textContent).toBe(`✎ ${t.rd_ivc_fb_edited}`);
    await view(1);
    expect(inSheet("rs-price").map((i) => i.value)).toEqual(["150", "200"]);
    cleanup(); await open();                                     // the screen opened again: read back
    expect(editedTag(1)).not.toBeNull();
    await view(1);
    expect(inSheet("rs-price").map((i) => i.value)).toEqual(["150", "200"]);
  });
});

describe("the Save button", () => {
  it("off with nothing to save; a change → Save saves AT ONCE (before the auto-save) → ✓ Saved, off again", async () => {
    await open(); await view(1);
    expect(btn("ivc-fb-save").textContent).toBe(t.rd_rc_save);
    expect(btn("ivc-fb-save").disabled).toBe(true);
    fireEvent.change(inSheet("rs-item")[1], { target: { value: "200 bag" } });
    expect(btn("ivc-fb-save").disabled).toBe(false);
    fireEvent.click(btn("ivc-fb-save")); await flush();
    expect(writes()).toHaveLength(1);
    expect(btn("ivc-fb-save").textContent).toBe(`✓ ${t.rd_fb_saved}`);
    expect(btn("ivc-fb-save").disabled).toBe(true);
    await wait(FB_EDIT_SAVE_MS + 300);
    expect(writes()).toHaveLength(1);                            // the auto-save had nothing left to do
    fireEvent.change(inSheet("rs-item")[1], { target: { value: "200 bag!" } });
    expect(btn("ivc-fb-save").textContent).toBe(t.rd_rc_save);   // a new change: no "Saved" any more
  });
  it("while the save is on its way: Saving…, no Send; ✓ Saved only after the server's yes", async () => {
    let land!: () => void;
    DB.s.editWriteGate = new Promise<void>((r) => { land = r; });
    await open(); await view(1);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "120" } });
    fireEvent.click(btn("ivc-fb-save")); await flush();
    expect(btn("ivc-fb-save").textContent).toBe(t.rd_fb_saving);
    expect(btn("ivc-fb-sheet-send").disabled).toBe(true);
    expect(q("ivc-fb-sheet-edited")).toBeNull();
    land(); await flush();
    expect(btn("ivc-fb-save").textContent).toBe(`✓ ${t.rd_fb_saved}`);
    expect(q("ivc-fb-sheet-edited")).not.toBeNull();
    expect(btn("ivc-fb-sheet-send").disabled).toBe(false);
  });
  it("a save with no answer counts as failed after the wait: red line, Save on again, never Saved / Edited", async () => {
    _resetReceiptEditSaves(300);
    DB.s.hangEditWrites = true;
    await open(); await view(1);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "120" } });
    fireEvent.click(btn("ivc-fb-save")); await flush();
    expect(btn("ivc-fb-save").textContent).toBe(t.rd_fb_saving);
    await wait(500);
    expect(q("ivc-fb-save-failed")!.textContent).toBe(t.rd_ivc_fb_save_err);
    expect(btn("ivc-fb-save").textContent).toBe(t.rd_rc_save);
    expect(btn("ivc-fb-save").disabled).toBe(false);
    expect(q("ivc-fb-sheet-edited")).toBeNull();
    fireEvent.click(btn("ivc-fb-sheet-send")); await flush(); await wait(500);
    expect(starts()).toEqual([]);                                // Send never draws the old receipt
    DB.s.hangEditWrites = false;
    fireEvent.click(btn("ivc-fb-save")); await flush();
    expect(DB.s.edits).toHaveLength(1);
    expect(btn("ivc-fb-save").textContent).toBe(`✓ ${t.rd_fb_saved}`);
  });
});

describe("a save that outlives the sheet", () => {
  it("the list drawn again while the save is on its way: Send all waits, then the new list says Edited (main: it missed it)", async () => {
    let land!: () => void;
    DB.s.editWriteGate = new Promise<void>((r) => { land = r; });
    await open(); await view(1);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "150" } });
    await wait(FB_EDIT_SAVE_MS + 100);                           // the auto-save is on its way
    await toTikTokAndBack();                                     // the sheet is gone, the list is read again
    expect(q("ivc-fb-sheet")).toBeNull();
    expect(btn("ivc-fb-send-all").disabled).toBe(true);
    expect(q("ivc-fb-edits-saving")!.textContent).toBe(t.rd_ivc_fb_wait_save);
    expect(rowOf(1).querySelector("[data-testid='ivc-fb-row-send']")).toBeNull();
    fireEvent.click(btn("ivc-fb-send-all")); await flush();
    expect(starts()).toEqual([]);
    land(); await flush(); await flush();
    expect(editedTag(1)!.textContent).toBe(`✎ ${t.rd_ivc_fb_edited}`);
    expect(q("ivc-fb-edits-saving")).toBeNull();
    expect(btn("ivc-fb-send-all").disabled).toBe(false);
    await view(1);
    expect(inSheet("rs-price").map((i) => i.value)).toEqual(["150", "0"]);
  });
  it("it fails after the sheet is gone: Send all stops and names #1 until the seller looks at it", async () => {
    let land!: () => void;
    DB.s.editWriteGate = new Promise<void>((r) => { land = r; });
    await open(); await view(1);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "150" } });
    await wait(FB_EDIT_SAVE_MS + 100);
    await toTikTokAndBack();
    DB.s.failEditWrites = true;
    land(); await flush(); await flush();
    expect(q("ivc-fb-edits-failed")!.textContent).toBe(tpl(t.rd_ivc_fb_unsaved_n, { n: "#1" }));
    expect(btn("ivc-fb-send-all").disabled).toBe(true);
    fireEvent.click(btn("ivc-fb-send-all")); await flush();
    expect(starts()).toEqual([]);
    expect(editedTag(1)).toBeNull();
    DB.s.failEditWrites = false;
    await view(1);
    expect(q("ivc-fb-last-unsaved")!.textContent).toBe(t.rd_ivc_fb_last_unsaved);
    expect(inSheet("rs-price").map((i) => i.value)).toEqual(["99", "0"]);   // what the server has: the orders
    fireEvent.click(q("ivc-fb-sheet-close")!); await flush();               // looked at it
    expect(q("ivc-fb-edits-failed")).toBeNull();
    expect(btn("ivc-fb-send-all").disabled).toBe(false);
  });
  it("Send from the sheet after such a failure sends what the sheet shows (and clears the warning)", async () => {
    let land!: () => void;
    DB.s.editWriteGate = new Promise<void>((r) => { land = r; });
    await open(); await view(1);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "150" } });
    await wait(FB_EDIT_SAVE_MS + 100);
    await toTikTokAndBack();
    DB.s.failEditWrites = true; land(); await flush(); await flush();
    DB.s.failEditWrites = false; DB.s.editWriteGate = null;
    await view(1);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "150" } });
    fireEvent.click(btn("ivc-fb-sheet-send")); await flush(); await flush();
    expect(DB.s.edits).toEqual([expect.objectContaining({ buyer_number: 1, lines: [{ item: "99", price: 150 }, { item: "200", price: 0 }] })]);
    expect(starts()).toHaveLength(1);
    expect(starts()[0].body).toMatchObject({ buyerNumber: 1 });
  });
});

describe("leaving the page", () => {
  it("a change not saved yet → the browser asks before the page reloads; saved → it does not", async () => {
    await open(); await view(1);
    const ask = () => { const e = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent; window.dispatchEvent(e); return e.defaultPrevented; };
    expect(ask()).toBe(false);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "150" } });
    expect(ask()).toBe(true);
    await wait(FB_EDIT_SAVE_MS + 300);
    expect(ask()).toBe(false);
  });
});

describe("I sent it by hand", () => {
  it("only after a failed send — 'unknown' too — with its line; not before", async () => {
    await open(); await view(1);
    expect(q("ivc-fb-sheet-hand")).toBeNull();
    expect(q("ivc-fb-sheet-send")).not.toBeNull();
    expect(q("ivc-fb-sheet-cancel")).not.toBeNull();
    fireEvent.click(q("ivc-fb-sheet-close")!); await flush();
    await view(6);
    expect(q("ivc-fb-hand-note")!.textContent).toBe(t.rd_ivc_fb_hand_note);
    expect(q("ivc-fb-sheet-hand")).not.toBeNull();
    expect(q("ivc-fb-sheet-cancel")).not.toBeNull();
  });
});
