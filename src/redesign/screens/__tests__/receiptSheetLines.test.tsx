// Messenger receipt sheet — add / remove lines. The renderer and the server calls are mocked so we
// can see the exact picture input. Pins: add → in the picture, remove → gone, empty item → left
// out of lines and total, numbering 1..n, all empty → no Send + note, the posted picture uses the
// edited lines, and nothing writes orders / sessions / customers / settings.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const m = vi.hoisted(() => ({ info: vi.fn(), send: vi.fn(), render: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  saveReceiptSettings: m.saveSettings,
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "Hi", note: "Pay", qrImage: null } })),
}));
vi.mock("../../adapters/fbReceipt", async (orig) => ({ ...(await orig<typeof import("../../adapters/fbReceipt")>()), fbReceiptInfo: m.info, fbReceiptSend: m.send }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));

import { TProvider } from "../../i18n";
import ReceiptSheet from "../../components/ReceiptSheet";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";
import type { BuyerReceipt } from "../../adapters/useReadData";

const SID = "11111111-2222-3333-4444-555555555555";
const receipt: BuyerReceipt = { num: 3, name: "Ann", handle: "@ann", lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }], count: 2, total: 630, platform: "Facebook" };
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 420)); }); }; // preview debounce is 350 ms
const lastInput = () => m.render.mock.calls.at(-1)![0];
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const all = (id: string) => [...document.querySelectorAll(`[data-testid='${id}']`)] as HTMLInputElement[];

beforeEach(() => {
  vi.clearAllMocks();
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  m.info.mockResolvedValue({ ok: true, canSend: true, sentCount: 0, lastSentAt: null, remaining: 2 });
  m.send.mockResolvedValue({ ok: true, sentCount: 1, remaining: 1, lastSentAt: "2026-10-05T12:00:00Z" });
});
const open = (props: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} {...props} /></TProvider>);

describe("add / remove lines", () => {
  it("Add line → an empty, focused line; once it has an item it is in the picture input", async () => {
    open(); await settle();
    fireEvent.click(q("rs-add-line")!);
    const items = all("rs-item");
    expect(items).toHaveLength(3);
    expect(items[2].value).toBe("");
    expect(document.activeElement).toBe(items[2]);
    await settle();
    expect(lastInput().lines).toEqual([{ item: "A1", total: 350 }, { item: "B2", total: 280 }]); // empty line not on the picture
    fireEvent.change(items[2], { target: { value: "C3" } });
    fireEvent.change(all("rs-price")[2], { target: { value: "150" } });
    await settle();
    expect(lastInput().lines).toEqual([{ item: "A1", total: 350 }, { item: "B2", total: 280 }, { item: "C3", total: 150 }]);
  });
  it("remove a line → it disappears from the sheet and the picture; the other inputs keep their values", async () => {
    open(); await settle();
    fireEvent.click(all("rs-remove-line")[0]);
    expect(all("rs-item").map((i) => i.value)).toEqual(["B2"]);
    expect(all("rs-price").map((i) => i.value)).toEqual(["280"]);
    await settle();
    expect(lastInput().lines).toEqual([{ item: "B2", total: 280 }]);
  });
  it("an empty (or blank) item is left out of lines and total; numbering on the picture has no gaps", async () => {
    open(); await settle();
    fireEvent.change(all("rs-item")[0], { target: { value: "   " } });   // first line blanked
    await settle();
    expect(lastInput().lines).toEqual([{ item: "B2", total: 280 }]);
    const numbers = [...document.querySelectorAll("[data-testid='rs-line'] > span")].map((s) => s.textContent);
    expect(numbers).toEqual(["–", "1."]);
  });
});

describe("Send gating + the posted picture", () => {
  it("all lines empty → no Send button, the note shows; adding an item brings Send back", async () => {
    open(); await settle();
    for (const b of all("rs-remove-line")) fireEvent.click(b);
    await settle();
    expect(q("rs-send")).toBeNull();
    expect(q("rs-no-lines")!.textContent).toBe("Add at least one item to send this receipt.");
    fireEvent.click(q("rs-add-line")!);
    expect(q("rs-send")).toBeNull();                                      // still empty
    fireEvent.change(all("rs-item")[0], { target: { value: "Z9" } });
    expect(q("rs-send")).not.toBeNull();
    expect(q("rs-no-lines")).toBeNull();
  });
  it("the posted picture is rendered from the edited lines (added, removed, blank left out)", async () => {
    open(); await settle();
    fireEvent.click(all("rs-remove-line")[0]);                            // remove A1
    fireEvent.click(q("rs-add-line")!);
    fireEvent.change(all("rs-item")[1], { target: { value: "D4" } });
    fireEvent.change(all("rs-price")[1], { target: { value: "99" } });
    fireEvent.click(q("rs-add-line")!);                                   // a blank line stays blank
    m.render.mockClear();
    fireEvent.click(q("rs-send")!);
    await settle();
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.render.mock.calls[0][0].lines).toEqual([{ item: "B2", total: 280 }, { item: "D4", total: 99 }]);
  });
});

describe("nothing is written", () => {
  it("add, remove, edit and close write no order, session, customer or settings", async () => {
    const onClose = vi.fn();
    open({ onClose }); await settle();
    fireEvent.click(q("rs-add-line")!);
    fireEvent.change(all("rs-item")[2], { target: { value: "X" } });
    fireEvent.click(all("rs-remove-line")[0]);
    fireEvent.click(q("receipt-sheet-close")!);
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saveOrderToDatabase).not.toHaveBeenCalled();
    expect(saveLiveSessionOrder).not.toHaveBeenCalled();
    expect(saveCustomerToDatabase).not.toHaveBeenCalled();
    expect(m.saveSettings).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });
});
