// Invoicing → Facebook ✎ View = the SAME receipt editor as Orders (components/ReceiptEditorFields.tsx), saved per
// receipt in sql/233 fb_receipt_edits (the in-memory fake: adapters/__tests__/invoiceFakeDb.ts — own rows only).
// Pins: the editor's fields and starting values (saved format + the buyer's order lines + the Invoicing shipping
// fee); a change is saved a moment later (once) and the row says "Edited"; read back after the screen is opened
// again; back exactly to the orders = the saved edit goes; Reset to original (asks first); Send saves first, then
// starts the job (never before the save); a failed save = a red line, no Send; a new order after the edit =
// "Edited · new order"; the live picture's input = the shared input the server draws; nothing else is written
// (orders, Sales, stickers, the receipt format, the sent status).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});
const m = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));

import { TProvider, buildT } from "../../i18n";
import Invoicing from "../Invoicing";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";
import { buyerReceipt } from "../../adapters/useReadData";
import { fbPictureInput, originalState } from "../../adapters/fbReceiptEditState";
import { invoiceRows } from "../../adapters/invoicing";
import { FB_EDIT_SAVE_MS } from "../../adapters/fbReceiptEdit";

const SID = "11111111-2222-3333-4444-555555555555";
const t = buildT("en") as unknown as Record<string, string>;
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const fb = (n: number, name: string, product: string, price: number, min = n) =>
  ({ buyer_number: n, handle: name, customer_name: name, platform: "Facebook", product, price, created_at: `2026-11-26T05:${String(min).padStart(2, "0")}:00.000Z`, session_date: "2026-11-26" });
const ROWS = [fb(2, "Ana Cruz", "Dress", 350), fb(2, "Ana Cruz", "Belt", 50, 7), fb(3, "Ben Lee", "Top", 280)];
const buyers = () => rebuildSessionFromRows(ROWS as never).buyers;
const QR = "data:image/png;base64,iVBORw0KGgo=";

const S = { calls: [] as { path: string; body: Record<string, unknown> }[], order: [] as string[] };
const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
  const path = new URL(url).pathname;
  const body = JSON.parse(init.body);
  S.calls.push({ path, body });
  if (path === "/fb/sendall/start") S.order.push(`start:${DB.s.edits.length}`);
  const json = path === "/fb/sendall/status" ? { ok: true, access: true, allowed: true, job: null, needsMessaging: false, buyers: [{ n: 2, tag: "not_sent" }, { n: 3, tag: "sent", at: "2026-11-26T06:05:00.000Z" }] }
    : path === "/fb/sendall/start" ? { ok: true, already: false } : { ok: false };
  return { status: 200, json: async () => json } as unknown as Response;
});
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
const sheet = () => q("ivc-fb-sheet")!;
const inSheet = (id: string) => [...sheet().querySelectorAll(`[data-testid='${id}']`)] as HTMLInputElement[];
const writesOtherThanEdits = () => DB.s.calls.filter((c) => (c.op === "upsert" || c.op === "delete") && c.table !== "fb_receipt_edits");
const hashOf2 = () => invoiceRows(buyers(), "facebook", "60").find((r) => r.num === 2)!.hash;

beforeEach(() => {
  DB.reset(); localStorage.clear();
  DB.s.settings.set("u1", { user_id: "u1", opening: "Hi!", note: "Pay by GCash", qr_image: QR, invoice_shipping_fee: 60 });
  S.calls = []; S.order = [];
  m.render.mockReset();
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  if (typeof URL.createObjectURL !== "function") (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the editor in the Facebook ✎ View", () => {
  it("the same fields as Orders, starting from the saved format + the order lines + the Invoicing shipping fee", async () => {
    await open(); await view(2);
    for (const id of ["rs-opening", "rs-add-line", "rs-shipping", "rs-note", "rs-qr-img"]) expect(inSheet(id), id).toHaveLength(1);
    expect(inSheet("rs-opening")[0].value).toBe("Hi!");
    expect(inSheet("rs-item").map((i) => i.value)).toEqual(["Dress", "Belt"]);
    expect(inSheet("rs-price").map((i) => i.value)).toEqual(["350", "50"]);
    expect(inSheet("rs-shipping")[0].value).toBe("60");
    expect(inSheet("rs-note")[0].value).toBe("Pay by GCash");
    expect(q("ivc-fb-sheet-edited")).toBeNull();
    expect(q("ivc-fb-reset")).toBeNull();               // nothing to reset yet
    await wait(450);
    const receipt = buyerReceipt(buyers(), 2)!;
    const labels = { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc, more: t.rd_rc_pic_more, shipping: t.rd_rc_pic_shipping, howToPay: t.rd_rc_pic_howto, scanToPay: t.rd_rc_pic_scan };
    // the live picture's input = the shared input (the server's Send all builds the same — fbSendAllEdit.server.test.ts)
    expect(m.render.mock.calls.at(-1)![0]).toEqual(fbPictureInput(originalState(receipt, [false, false], { opening: "Hi!", note: "Pay by GCash" }, "60"), { receipt, qrImage: QR, cur: "₱", labels }));
  });
  it("a change is saved a moment later (one save), the row and the sheet say Edited, the picture follows", async () => {
    await open(); await view(2);
    fireEvent.change(inSheet("rs-price")[1], { target: { value: "45" } });
    fireEvent.change(inSheet("rs-note")[0], { target: { value: "Pay by bank" } });
    fireEvent.click(inSheet("rs-add-line")[0]);
    fireEvent.change(inSheet("rs-item")[2], { target: { value: "Gift" } });
    fireEvent.change(inSheet("rs-shipping")[0], { target: { value: "" } });
    expect(DB.s.edits).toEqual([]);                      // not yet: it waits for the last change
    await wait(FB_EDIT_SAVE_MS + 300);
    expect(DB.s.calls.filter((c) => c.table === "fb_receipt_edits" && c.op === "upsert")).toHaveLength(1);
    expect(DB.s.edits).toEqual([expect.objectContaining({
      user_id: "u1", session_id: SID, buyer_number: 2, opening: "Hi!", note: "Pay by bank", shipping_fee: null, based_on: hashOf2(),
      lines: [{ item: "Dress", price: 350 }, { item: "Belt", price: 45 }, { item: "Gift", price: null }],
    })]);
    expect(q("ivc-fb-sheet-edited")!.textContent).toBe(t.rd_ivc_fb_edited);
    expect(q("ivc-fb-save-state")!.textContent).toContain(t.rd_fb_saved);
    expect(rowOf(2).querySelector("[data-testid='ivc-fb-row-edited']")!.textContent).toBe(`✎ ${t.rd_ivc_fb_edited}`);
    expect(rowOf(3).querySelector("[data-testid='ivc-fb-row-edited']")).toBeNull();
    const last = m.render.mock.calls.at(-1)![0];
    expect(last.lines).toEqual([{ item: "Dress", total: 350 }, { item: "Belt", total: 45 }, { item: "Gift", total: 0 }]);
    expect(last.note).toBe("Pay by bank");
    expect(last.shippingFee).toBeUndefined();
    expect(writesOtherThanEdits()).toEqual([]);         // orders, format, sent status: never written
  });
  it("read back: the screen opened again shows the saved edit", async () => {
    DB.s.edits = [{ user_id: "u1", session_id: SID, buyer_number: 2, opening: "Hello Ana", note: "Bank", shipping_fee: 80, lines: [{ item: "Dress (red)", price: 400 }], based_on: hashOf2() }];
    await open();
    expect(rowOf(2).querySelector("[data-testid='ivc-fb-row-edited']")).not.toBeNull();
    await view(2);
    expect(inSheet("rs-opening")[0].value).toBe("Hello Ana");
    expect(inSheet("rs-item").map((i) => i.value)).toEqual(["Dress (red)"]);
    expect(inSheet("rs-shipping")[0].value).toBe("80");
    expect(q("ivc-fb-edit-stale")).toBeNull();
  });
  it("back exactly to the orders → the saved edit goes (no Edited)", async () => {
    await open(); await view(2);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "300" } });
    await wait(FB_EDIT_SAVE_MS + 300);
    expect(DB.s.edits).toHaveLength(1);
    fireEvent.change(inSheet("rs-price")[0], { target: { value: "350" } });
    await wait(FB_EDIT_SAVE_MS + 300);
    expect(DB.s.edits).toEqual([]);
    expect(rowOf(2).querySelector("[data-testid='ivc-fb-row-edited']")).toBeNull();
  });
  it("Reset to original asks first; Keep = nothing changes; Reset = the edit goes and the fields are the orders again", async () => {
    DB.s.edits = [{ user_id: "u1", session_id: SID, buyer_number: 2, opening: "Hello", note: "", shipping_fee: null, lines: [{ item: "X", price: 1 }], based_on: hashOf2() }];
    await open(); await view(2);
    fireEvent.click(q("ivc-fb-reset")!);
    expect(q("ivc-fb-reset-ask")!.textContent).toContain(t.rd_ivc_fb_reset_q);
    fireEvent.click(q("ivc-fb-reset-no")!);
    expect(DB.s.edits).toHaveLength(1);
    fireEvent.click(q("ivc-fb-reset")!);
    fireEvent.click(q("ivc-fb-reset-yes")!); await flush();
    expect(DB.s.edits).toEqual([]);
    expect(inSheet("rs-item").map((i) => i.value)).toEqual(["Dress", "Belt"]);
    expect(inSheet("rs-opening")[0].value).toBe("Hi!");
    expect(rowOf(2).querySelector("[data-testid='ivc-fb-row-edited']")).toBeNull();
  });
  it("Send right after a change: the edit is saved FIRST, then the job starts", async () => {
    await open(); await view(2);
    fireEvent.change(inSheet("rs-item")[0], { target: { value: "Dress XL" } });
    fireEvent.click(q("ivc-fb-sheet-send")!); await flush(); await flush();
    expect(S.order).toEqual(["start:1"]);               // the edit row existed when the start went out
    expect(DB.s.edits[0]).toMatchObject({ lines: [{ item: "Dress XL", price: 350 }, { item: "Belt", price: 50 }] });
  });
  it("a save that fails → a red line, Send does NOT start; tapping the line saves again", async () => {
    await open(); await view(2);
    DB.s.failEditWrites = true;
    fireEvent.change(inSheet("rs-item")[0], { target: { value: "Dress XL" } });
    fireEvent.click(q("ivc-fb-sheet-send")!); await flush(); await flush();
    expect(q("ivc-fb-save-failed")!.textContent).toBe(t.rd_fb_save_failed);
    expect(S.calls.filter((c) => c.path === "/fb/sendall/start")).toEqual([]);
    DB.s.failEditWrites = false;
    fireEvent.click(q("ivc-fb-save-failed")!); await flush();
    expect(DB.s.edits).toHaveLength(1);
  });
  it("closing the sheet saves what is left (no wait)", async () => {
    await open(); await view(2);
    fireEvent.change(inSheet("rs-note")[0], { target: { value: "Closed fast" } });
    fireEvent.click(q("ivc-fb-sheet-close")!); await flush();
    expect(q("ivc-fb-sheet")).toBeNull();
    expect(DB.s.edits[0]).toMatchObject({ note: "Closed fast" });
  });
  it("a new order after the edit → 'Edited · new order' on the row and a line in the sheet", async () => {
    DB.s.edits = [{ user_id: "u1", session_id: SID, buyer_number: 2, opening: "Hi!", note: "", shipping_fee: null, lines: [{ item: "Dress", price: 350 }], based_on: "oldhash1" }];
    await open();
    const tag = rowOf(2).querySelector("[data-testid='ivc-fb-row-edited']")!;
    expect(tag.textContent).toBe(`✎ ${t.rd_ivc_fb_edited_new}`);
    expect(tag.getAttribute("data-stale")).toBe("1");
    await view(2);
    expect(q("ivc-fb-edit-stale")!.textContent).toBe(t.rd_ivc_fb_edit_new_note);
  });
  it("a buyer already sent: the editor and Reset are there, the save works, still no Send (today's one-message rule)", async () => {
    await open(); await view(3);
    expect(q("ivc-fb-editor")).not.toBeNull();
    expect(q("ivc-fb-sheet-send")).toBeNull();
    fireEvent.change(inSheet("rs-item")[0], { target: { value: "Top (white)" } });
    await wait(FB_EDIT_SAVE_MS + 300);
    expect(DB.s.edits[0]).toMatchObject({ buyer_number: 3 });
    expect(q("ivc-fb-sheet-send")).toBeNull();
  });
  it("every line emptied → 'no lines' instead of Send", async () => {
    await open(); await view(2);
    for (const el of inSheet("rs-item")) fireEvent.change(el, { target: { value: "" } });
    await flush();
    expect(q("ivc-fb-sheet-send")).toBeNull();
    expect(q("ivc-fb-no-lines")!.textContent).toBe(t.rd_rs_no_lines);
  });
  it("the edits cannot be read → the list's load error + Try again; the table not there yet = no edits", async () => {
    DB.s.failEditReads = true;
    await open();
    expect(q("ivc-fb-error")).not.toBeNull();
    DB.s.failEditReads = false;
    fireEvent.click(q("ivc-fb-retry")!); await flush();
    expect(q("ivc-fb-list")).not.toBeNull();
    cleanup(); DB.s.noEditsTable = true;
    await open();
    expect(q("ivc-fb-list")).not.toBeNull();
    expect(q("ivc-fb-row-edited")).toBeNull();
  });
});
