import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } }));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));
const ios = vi.hoisted(() => ({ v: false }));
vi.mock("../../adapters/platform", async (orig) => ({ ...(await orig<object>()), isIOS: () => ios.v }));

import { TProvider, REDESIGN_STRINGS } from "../../i18n";
import Orders from "../Orders";
import { readFileSync } from "node:fs";
import type { Buyer } from "../../../lib/orderTypes";

const ORDER_NUM = Date.UTC(2026, 9, 13, 5, 0, 0);
const LONG = "MR SUAVE KUNG WALA PA AKONG GANYAN MINE LARGE PLEASE";
const buyer = (): Buyer => ({
  handle: "@ann.reyes", name: "Ann Reyes", platform: "TikTok", num: 3, totalSpent: 630, totalOrders: 2,
  orders: [
    { item: LONG, total: 350, orderNum: ORDER_NUM, qty: 1 },
    { item: "B2 top", total: 280, orderNum: ORDER_NUM + 2, qty: 3 },
  ] as never,
});
const openSheet = () => {
  const r = render(<TProvider lang="fil"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[buyer()]} todayId="2026-10-13" tiktokSend sellerId="seller-1" /></TProvider>);
  fireEvent.change(r.container.querySelector("input")!, { target: { value: "3" } });
  fireEvent.click(q("tt-send-btn")!);
};
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLTextAreaElement[];
const preview = () => q("tts-preview")!.textContent || "";
const edit = (i: number, value: string) => fireEvent.change(qa("tts-text-order")[i], { target: { value } });

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); ios.v = false; });

describe("Send sheet — order lines are editable (message only)", () => {
  it("order lines are a one-line textarea prefilled with the comment; qty tag still shown", () => {
    openSheet();
    const boxes = qa("tts-text-order");
    expect(boxes.map((b) => b.tagName)).toEqual(["TEXTAREA", "TEXTAREA"]);
    expect(boxes.map((b) => b.value)).toEqual([LONG, "B2 top"]);
    expect(boxes[0].rows).toBe(1);
    expect(qa("tts-qty").map((e) => e.textContent)).toEqual(["x3"]);
    expect(qa("tts-line")[1].contains(q("tts-qty"))).toBe(true);
  });
  it("edited text reaches the preview and the copied message", async () => {
    openSheet();
    edit(0, "Mr Suave L");
    expect(preview()).toContain("1. Mr Suave L — NT$350");
    expect(preview()).toContain("2. B2 top x3 — NT$280");
    await act(async () => { fireEvent.click(q("tts-copy-open")!); });
    expect(copyText.mock.calls[0][0]).toContain("1. Mr Suave L — NT$350");
    expect(copyText.mock.calls[0][0]).not.toContain(LONG);
  });
  it("cleared (empty / spaces) → the message uses the ORIGINAL comment, still counted in the total", () => {
    openSheet();
    edit(0, "   ");
    expect(preview()).toContain(`1. ${LONG} — NT$350`);
    expect(preview()).toContain("Total: NT$630");
    expect(qa("tts-text-order")[0].placeholder).toBe(LONG);
  });
  it("Enter adds no new line; pasted line breaks become spaces", () => {
    openSheet();
    const box = qa("tts-text-order")[1];
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    box.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    edit(1, "B2\ntop\r\nred");
    expect(qa("tts-text-order")[1].value).toBe("B2 top red");
  });
  it("Enter while an IME is composing (zh / th keyboard picking a word) is NOT blocked", () => {
    openSheet();
    const ev = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
    qa("tts-text-order")[0].dispatchEvent(ev);
    expect(ev.isComposing).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
  });
  it("added lines are unchanged (single-line input, accent background)", () => {
    openSheet();
    fireEvent.click(q("tts-add")!);
    const added = q("tts-line-added")!;
    expect(added.querySelector("[data-testid='tts-text']")!.tagName).toBe("INPUT");
    expect(added.style.background).toBe("var(--accent-soft)");
    expect(qa("tts-line").every((l) => l.style.background === "transparent")).toBe(true);
  });
  it("a typed Total survives a text edit", () => {
    openSheet();
    fireEvent.change(q("tts-total")!, { target: { value: "500" } });
    edit(0, "Mr Suave L");
    expect((q("tts-total") as HTMLInputElement).value).toBe("500");
    expect(preview()).toContain("Total: NT$500");
  });
  it("closing and reopening shows the original text again; the no-change note stays", () => {
    openSheet();
    edit(0, "Mr Suave L");
    fireEvent.click(q("tts-close")!);
    fireEvent.click(q("tt-send-btn")!);
    expect(qa("tts-text-order")[0].value).toBe(LONG);
    expect(document.body.textContent).toContain(REDESIGN_STRINGS.fil.rd_tts_hint);
  });
  it("iOS: the 16px input floor covers textareas in the redesign", () => {
    expect(readFileSync("src/redesign/redesign.css", "utf8")).toContain("html.sfl-ios-shell [data-redesign] textarea { font-size: 16px !important; }");
  });
});
