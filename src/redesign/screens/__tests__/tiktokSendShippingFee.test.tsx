// "Send to TikTok" — the Shipping fee box (Jeff, approved preview): a box LEFT of Total, empty
// every open, never remembered. Total = items + shipping fee; a fee change drops a Total
// override. The message gains ONE "Shipping fee: {fee}" line above Total only when the fee is
// not empty (a typed 0 counts); empty → the message is exactly as it was before shipping.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } }));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));

import { TProvider, buildT } from "../../i18n";
import Orders from "../Orders";
import { buildSendMessage } from "../../adapters/tiktokSend";
import type { Buyer } from "../../../lib/orderTypes";

const ORDER_NUM = Date.UTC(2026, 9, 13, 5, 0, 0); // 2026-10-13 13:00 Taipei
const ANN: Buyer = {
  handle: "@ann.reyes", name: "Ann Reyes", platform: "TikTok", num: 3, totalSpent: 630, totalOrders: 2,
  orders: [
    { item: "A1 dress", total: 350, orderNum: ORDER_NUM, qty: 1 },
    { item: "B2 top", total: 280, orderNum: ORDER_NUM + 2, qty: 1 },
  ] as never,
};
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const box = () => q("tts-preview") as HTMLTextAreaElement;
const ship = () => q("tts-shipping") as HTMLInputElement;
const renderOrders = () => {
  const r = render(<TProvider lang="fil"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[ANN]} todayId="2026-10-13" tiktokSend sellerId="seller-1" /></TProvider>);
  fireEvent.change(r.container.querySelector("input")!, { target: { value: "3" } }); // pick #3 (Ann)
  return r;
};
const openSheet = () => fireEvent.click(q("tt-send-btn")!);
const DEFAULT_ANN = ["Hi Ann Reyes! 😊", "Here's your invoice (10/13):", "1. A1 dress — NT$350", "2. B2 top — NT$280", "Total: NT$630"].join("\n");

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe("buildSendMessage — the shipping line (pure)", () => {
  const t = buildT("en");
  const labels = { hi: t.rd_tts_msg_hi, order: t.rd_tts_msg_order, total: t.rd_tts_msg_total, shipping: t.rd_tts_msg_shipping };
  const lines = [{ key: "l0", text: "A1 dress", price: "350", added: false, qty: 1, orig: "A1 dress" }];

  it("empty shipping fee → the message is identical to today, byte for byte", () => {
    const today = buildSendMessage({ name: "Ann", date: "10/13", lines, total: 350, cur: "NT$", note: "", labels: { hi: labels.hi, order: labels.order, total: labels.total } });
    expect(buildSendMessage({ name: "Ann", date: "10/13", lines, total: 350, cur: "NT$", note: "", labels, shippingFee: "" })).toBe(today);
    expect(buildSendMessage({ name: "Ann", date: "10/13", lines, total: 350, cur: "NT$", note: "", labels, shippingFee: "   " })).toBe(today);
    expect(today).not.toMatch(/Shipping fee/);
  });
  it("38 → a 'Shipping fee: NT$38' line right above Total", () => {
    expect(buildSendMessage({ name: "Ann", date: "10/13", lines, total: 388, cur: "NT$", note: "", labels, shippingFee: "38" }))
      .toBe("Hi Ann! 😊\nHere's your invoice (10/13):\n1. A1 dress — NT$350\nShipping fee: NT$38\nTotal: NT$388");
  });
  it("a typed 0 shows 'Shipping fee: NT$0'", () => {
    expect(buildSendMessage({ name: "Ann", date: "10/13", lines, total: 350, cur: "NT$", note: "", labels, shippingFee: "0" }))
      .toContain("Shipping fee: NT$0\nTotal: NT$350");
  });
  it("the message line stays English in every app language", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) expect(buildT(lang).rd_tts_msg_shipping).toBe("Shipping fee: {fee}");
  });
});

describe("the sheet", () => {
  it("empty every open → the box is exactly today's message", () => {
    renderOrders();
    openSheet();
    expect(ship().value).toBe("");
    expect(box().value).toBe(DEFAULT_ANN);
    expect(box().value).not.toMatch(/Shipping fee/);
  });
  it("38 → the line is added above Total and Total becomes 630 + 38", () => {
    renderOrders();
    openSheet();
    fireEvent.change(ship(), { target: { value: "38" } });
    expect(box().value).toBe([...DEFAULT_ANN.split("\n").slice(0, 4), "Shipping fee: NT$38", "Total: NT$668"].join("\n"));
    expect((q("tts-total") as HTMLInputElement).value).toBe("668");
  });
  it("a typed 0 prints 'Shipping fee: NT$0' and keeps the total", () => {
    renderOrders();
    openSheet();
    fireEvent.change(ship(), { target: { value: "0" } });
    expect(box().value).toContain("Shipping fee: NT$0\nTotal: NT$630");
  });
  it("changing the shipping fee drops a manual Total override", () => {
    renderOrders();
    openSheet();
    fireEvent.change(q("tts-total")!, { target: { value: "999" } }); // manual override
    expect(q("tts-edited")).not.toBeNull();
    expect(box().value).toContain("Total: NT$999");
    fireEvent.change(ship(), { target: { value: "38" } });           // fee change → override gone
    expect(q("tts-edited")).toBeNull();
    expect(box().value).toContain("Shipping fee: NT$38\nTotal: NT$668");
  });
  it("reopening the sheet → the shipping fee is empty again (not remembered)", () => {
    renderOrders();
    openSheet();
    fireEvent.change(ship(), { target: { value: "38" } });
    fireEvent.click(q("tts-close")!);
    openSheet();
    expect(ship().value).toBe("");
    expect(box().value).not.toMatch(/Shipping fee/);
  });
  it("draft mode: the seller's own message is untouched when the shipping fee changes", () => {
    renderOrders();
    openSheet();
    fireEvent.change(box(), { target: { value: "Hi Ann! Please pay NT$630 today." } });
    fireEvent.change(ship(), { target: { value: "38" } });
    expect(box().value).toBe("Hi Ann! Please pay NT$630 today."); // untouched; Reset would rebuild with the fee line
    expect(q("tts-reset")).not.toBeNull();
  });
});
