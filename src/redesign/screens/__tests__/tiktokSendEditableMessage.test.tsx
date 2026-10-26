// "Send to TikTok" — the EDITABLE message box (Jeff, Oct 26): buyers abroad don't read Tagalog,
// so the default is the same English invoice in every app language and the seller can rewrite
// it. Auto mode rebuilds the text from items / total / note until the seller types in the box;
// then it is theirs ("↺ Reset message" returns to auto). Every buyer opens fresh in auto mode.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

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
const buyer = (num: number, name: string, handle: string): Buyer => ({
  handle, name, platform: "TikTok", num, totalSpent: 630, totalOrders: 2,
  orders: [
    { item: "A1 dress", total: 350, orderNum: ORDER_NUM, qty: 1 },
    { item: "B2 top", total: 280, orderNum: ORDER_NUM + 2, qty: 1 },
  ] as never,
});
const ANN = buyer(3, "Ann Reyes", "@ann.reyes");
const BEN = buyer(4, "Ben Cruz", "@ben.cruz");
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLInputElement[];
const box = () => q("tts-preview") as HTMLTextAreaElement;
const renderOrders = (lang = "fil") => {
  const r = render(<TProvider lang={lang}><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[ANN, BEN]} todayId="2026-10-13" tiktokSend sellerId="seller-1" /></TProvider>);
  const pick = (num: number) => fireEvent.change(r.container.querySelector("input")!, { target: { value: String(num) } });
  pick(3);
  return { ...r, pick };
};
const openSheet = () => fireEvent.click(q("tt-send-btn")!);
const DEFAULT_ANN = [
  "Hi Ann Reyes! 😊",
  "Here's your invoice (10/13):",
  "1. A1 dress — NT$350",
  "2. B2 top — NT$280",
  "Total: NT$630",
].join("\n");

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe("default message", () => {
  it.each(["en", "fil", "zh-TW"])("%s: 'Here's your invoice' — the same English text in every app language", (lang) => {
    renderOrders(lang);
    openSheet();
    expect(box().value).toBe(DEFAULT_ANN);
    expect(box().value).not.toMatch(/Order mo sa live/);
    expect(q("tts-reset")).toBeNull(); // auto mode: no reset button
  });
  it("every supported language carries the invoice line, and the note comes after a blank line", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) expect(buildT(lang).rd_tts_msg_order).toBe("Here's your invoice ({date}):");
    const t = buildT("en");
    const labels = { hi: t.rd_tts_msg_hi, order: t.rd_tts_msg_order, total: t.rd_tts_msg_total };
    const lines = [{ key: "l0", text: "A1 dress", price: "350", added: false, qty: 1, orig: "A1 dress" }];
    expect(buildSendMessage({ name: "Ann", date: "10/13", lines, total: 350, cur: "NT$", note: "Pay within 3 days", labels }))
      .toBe("Hi Ann! 😊\nHere's your invoice (10/13):\n1. A1 dress — NT$350\nTotal: NT$350\n\nPay within 3 days");
    expect(buildSendMessage({ name: "Ann", date: "10/13", lines, total: 350, cur: "NT$", note: "  ", labels })).not.toMatch(/\n\n/);
  });
  it("auto mode follows the fields: a price change, the total and the note rebuild the box", () => {
    renderOrders();
    openSheet();
    fireEvent.change(qa("tts-price")[0], { target: { value: "300" } });
    expect(box().value).toContain("1. A1 dress — NT$300");
    expect(box().value).toContain("Total: NT$580");
    fireEvent.change(q("tts-note")!, { target: { value: "GCash 0917…" } });
    expect(box().value.endsWith("\n\nGCash 0917…")).toBe(true);
    expect(q("tts-reset")).toBeNull();
  });
});

describe("the seller's own text", () => {
  it("an edit survives changing an item and the total; Copy copies exactly the box; Reset restores the auto text and resumes auto-updates", async () => {
    renderOrders();
    openSheet();
    fireEvent.change(box(), { target: { value: "Hi Ann! Your order is ready. Please pay NT$630 today." } });
    expect(box().value).toBe("Hi Ann! Your order is ready. Please pay NT$630 today.");
    expect(q("tts-reset")).not.toBeNull();
    fireEvent.change(qa("tts-price")[0], { target: { value: "1" } });            // item change
    fireEvent.change(q("tts-total")!, { target: { value: "999" } });             // total change
    fireEvent.change(q("tts-note")!, { target: { value: "note" } });             // note change
    expect(box().value).toBe("Hi Ann! Your order is ready. Please pay NT$630 today."); // untouched
    await act(async () => { fireEvent.click(q("tts-copy-only")!); });
    expect(copyText).toHaveBeenCalledWith("Hi Ann! Your order is ready. Please pay NT$630 today.");
    fireEvent.click(q("tts-reset")!);
    expect(q("tts-reset")).toBeNull();
    expect(box().value).toBe(["Hi Ann Reyes! 😊", "Here's your invoice (10/13):", "1. A1 dress — NT$1", "2. B2 top — NT$280", "Total: NT$999", "", "note"].join("\n"));
    fireEvent.change(qa("tts-price")[1], { target: { value: "2" } });            // auto-updates again (the total override drops with a price change)
    expect(box().value).toContain("2. B2 top — NT$2");
    expect(box().value).toContain("Total: NT$3");
    await act(async () => { fireEvent.click(q("tts-copy-only")!); });
    expect(copyText).toHaveBeenLastCalledWith(box().value);
  });
  it("a new buyer opens in auto mode (the previous buyer's edit is gone)", () => {
    const r = renderOrders();
    openSheet();
    fireEvent.change(box(), { target: { value: "custom for Ann" } });
    fireEvent.click(q("tts-close")!);
    r.pick(4);
    openSheet();
    expect(box().value).toBe(DEFAULT_ANN.replace("Ann Reyes", "Ben Cruz"));
    expect(q("tts-reset")).toBeNull();
    fireEvent.change(qa("tts-price")[0], { target: { value: "5" } });
    expect(box().value).toContain("1. A1 dress — NT$5"); // still auto
  });
  it("the box is a real textarea that grows with the text (same field look), not a fixed preview", () => {
    renderOrders();
    openSheet();
    expect(box().tagName).toBe("TEXTAREA");
    expect(box().style.resize).toBe("none");
    expect(box().style.overflow).toBe("hidden");
  });
});
