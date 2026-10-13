// "Send to TikTok" (admin-only preview): the gate, the message, the open/copy rule, and the
// "no writes" rule (every edit is message-only; nothing reaches Supabase or db.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } }));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));
const ios = vi.hoisted(() => ({ v: false }));
vi.mock("../../adapters/platform", async (orig) => ({ ...(await orig<object>()), isIOS: () => ios.v }));

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";
import { tiktokSendAllowed, buildSendMessage, initialSendLines, messageTotal, sessionDateLabel, noteKey } from "../../adapters/tiktokSend";
import { buyerReceipt } from "../../adapters/useReadData";
import { setFeatureAccess, hasFeature, FEATURE_KEYS } from "../../adapters/featureAccess";
import { readFileSync } from "node:fs";
import type { Buyer } from "../../../lib/orderTypes";

const ORDER_NUM = Date.UTC(2026, 9, 13, 5, 0, 0); // 2026-10-13 13:00 Taipei
const buyer = (platform: string, handle = "@ann.reyes", qty3 = false): Buyer => ({
  handle, name: "Ann Reyes", platform, num: 3, totalSpent: 630, totalOrders: 3,
  orders: [
    { item: "A1 dress", total: 350, orderNum: ORDER_NUM, qty: 1 },
    { item: "freebie", total: 0, orderNum: ORDER_NUM + 1, qty: 1 },
    { item: "B2 top", total: 280, orderNum: ORDER_NUM + 2, qty: qty3 ? 3 : 1 },
  ] as never,
});
const open = (b: Buyer) => { renderOrders(b, true); fireEvent.click(q("tt-send-btn")!); };
const renderOrders = (b: Buyer, tiktokSend: boolean) => {
  const r = render(<TProvider lang="fil"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[b]} todayId="2026-10-13" tiktokSend={tiktokSend} sellerId="seller-1" /></TProvider>);
  fireEvent.change(r.container.querySelector("input")!, { target: { value: "3" } });
  return r;
};
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLInputElement[];
const preview = () => q("tts-preview")!.textContent || "";

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); ios.v = false; });

describe("Send button gate", () => {
  it("admin + TikTok buyer → Send button", () => {
    renderOrders(buyer("TikTok"), true);
    expect(q("tt-send-btn")).not.toBeNull();
  });
  it("non-admin → no button, card HTML identical to an admin-less render", () => {
    const a = renderOrders(buyer("TikTok"), false).container.querySelector("[data-testid='buyer-receipt']")!.outerHTML;
    expect(q("tt-send-btn")).toBeNull();
    const b = render(<TProvider lang="fil"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[buyer("TikTok")]} todayId="2026-10-13" /></TProvider>);
    fireEvent.change(b.container.querySelector("input")!, { target: { value: "3" } });
    expect(b.container.querySelector("[data-testid='buyer-receipt']")!.outerHTML).toBe(a);
  });
  it("admin + Facebook buyer → no Send button", () => {
    renderOrders(buyer("Facebook"), true);
    expect(q("tt-send-btn")).toBeNull();
  });
});

describe("the message", () => {
  it("default: every line incl. NT$0, the total, the session date", () => {
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    expect(preview()).toBe([
      "Hi Ann Reyes! 😊",
      "Order mo sa live (10/13):",
      "1. A1 dress — NT$350",
      "2. freebie — NT$0",
      "3. B2 top — NT$280",
      "Total: NT$630",
    ].join("\n"));
  });
  it("edited price, removed line, added line, total override and note all reach the message", () => {
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.change(qa("tts-price")[0], { target: { value: "300" } });           // edit A1
    fireEvent.click(qa("tts-remove")[2]);                                           // remove B2
    fireEvent.click(q("tts-add")!);                                                 // + Dagdag item
    expect(q("tts-line-added")).not.toBeNull();                                     // highlighted row
    fireEvent.change(qa("tts-text")[0], { target: { value: "shipping" } });
    fireEvent.change(qa("tts-price")[2], { target: { value: "60" } });
    expect(preview()).toContain("1. A1 dress — NT$300\n2. freebie — NT$0\n3. shipping — NT$60\nTotal: NT$360");
    expect(preview()).not.toContain("B2 top");
    fireEvent.change(q("tts-total")!, { target: { value: "350" } });
    expect(q("tts-edited")).not.toBeNull();
    fireEvent.change(q("tts-note")!, { target: { value: "GCash 0917…" } });
    expect(preview()).toMatch(/Total: NT\$350\nGCash 0917…$/);
  });
  it("an added line can be removed again", () => {
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.click(q("tts-add")!);
    fireEvent.change(qa("tts-text")[0], { target: { value: "extra" } });
    fireEvent.change(qa("tts-price")[3], { target: { value: "10" } });
    expect(preview()).toContain("Total: NT$640");
    fireEvent.click(qa("tts-remove")[3]);
    expect(preview()).not.toContain("extra");
    expect(preview()).toContain("Total: NT$630");
  });
  it("pure helpers: total override vs sum, date label", () => {
    const lines = initialSendLines([{ item: "x", total: 5 }, { item: "y", total: 0 }]);
    expect(messageTotal(lines, null)).toBe(5);
    expect(messageTotal(lines, "")).toBe(5);
    expect(messageTotal(lines, "9")).toBe(9);
    expect(sessionDateLabel([], "2026-10-12")).toBe("10/12");
    expect(buildSendMessage({ name: "A", date: "10/13", lines, total: 5, cur: "₱", note: "  ", labels: { hi: "Hi {name}!", order: "({date})", total: "T {total}" } }))
      .toBe("Hi A!\n(10/13)\n1. x — ₱5\n2. y — ₱0\nT ₱5");
  });
});

describe("copy + open (same rule as Chase)", () => {
  it("valid handle → anchor to the profile; tap copies the full message and shows the hint", async () => {
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.change(q("tts-note")!, { target: { value: "Pay via GCash" } });
    const a = q("tts-copy-open") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("https://www.tiktok.com/@ann.reyes");
    await act(async () => { fireEvent.click(a); });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText.mock.calls[0][0]).toContain("Hi Ann Reyes!");
    expect(copyText.mock.calls[0][0]).toContain("Pay via GCash");
    expect(q("tts-status")!.textContent).toBe("Na-copy na. Sa TikTok: Message → Paste → Send.");
    expect(localStorage.getItem(noteKey("seller-1"))).toBe("Pay via GCash"); // note remembered on copy
  });
  it("numeric (Facebook-id-like) handle → no link, copy only + find-the-buyer note", async () => {
    renderOrders(buyer("TikTok", "123456789012345678"), true);
    fireEvent.click(q("tt-send-btn")!);
    expect(q("tts-copy-open")).toBeNull();
    expect(document.querySelector("[data-testid='tts-sheet'] a")).toBeNull();
    await act(async () => { fireEvent.click(q("tts-copy-find")!); });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(q("tts-status")!.textContent).toContain("Hanapin ang buyer sa TikTok");
  });
  it("iOS: the clipboard gets the MESSAGE (never '@handle'); the handle is shown big and selectable", async () => {
    ios.v = true;
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    expect(q("tts-handle-big")!.textContent).toBe("@ann.reyes");
    await act(async () => { fireEvent.click(q("tts-copy-open")!); });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText.mock.calls[0][0]).not.toBe("@ann.reyes");
    expect(copyText.mock.calls[0][0]).toContain("Total:");
  });
  it("the note is prefilled from the last one this seller used", () => {
    localStorage.setItem(noteKey("seller-1"), "Bayad sa loob ng 3 araw");
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    expect((q("tts-note") as HTMLTextAreaElement).value).toBe("Bayad sa loob ng 3 araw");
  });
});

describe("read-only", () => {
  it("the whole flow writes nothing (no Supabase insert/update/delete, no db.ts write)", async () => {
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.change(qa("tts-price")[0], { target: { value: "1" } });
    fireEvent.click(qa("tts-remove")[1]);
    fireEvent.click(q("tts-add")!);
    fireEvent.change(q("tts-total")!, { target: { value: "5" } });
    fireEvent.change(q("tts-note")!, { target: { value: "n" } });
    await act(async () => { fireEvent.click(q("tts-copy-only")!); });
    await act(async () => { fireEvent.click(q("tts-copy-open")!); });
    fireEvent.click(q("tts-close")!);
    expect(q("tts-sheet")).toBeNull();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(saveOrderToDatabase).not.toHaveBeenCalled();
    expect(saveLiveSessionOrder).not.toHaveBeenCalled();
    expect(saveCustomerToDatabase).not.toHaveBeenCalled();
  });
  it("closing discards edits — reopening shows the card's lines again", () => {
    renderOrders(buyer("TikTok"), true);
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.click(qa("tts-remove")[0]);
    fireEvent.click(q("tts-close")!);
    fireEvent.click(q("tt-send-btn")!);
    expect(qa("tts-line").length).toBe(3);
  });
});

describe("FIX 1 — the Total override resets when the items' money changes", () => {
  const editTotal = () => { fireEvent.change(q("tts-total")!, { target: { value: "999" } }); expect(q("tts-edited")).not.toBeNull(); expect(preview()).toContain("Total: NT$999"); };
  it("edit total → remove a line → total = new sum, (edited) gone", () => {
    open(buyer("TikTok"));
    editTotal();
    fireEvent.click(qa("tts-remove")[0]);                       // drop A1 (350)
    expect(q("tts-edited")).toBeNull();
    expect(preview()).toContain("Total: NT$280");
    expect((q("tts-total") as HTMLInputElement).value).toBe("280");
  });
  it("edit total → change a line price → total = new sum, (edited) gone", () => {
    open(buyer("TikTok"));
    editTotal();
    fireEvent.change(qa("tts-price")[1], { target: { value: "20" } });
    expect(q("tts-edited")).toBeNull();
    expect(preview()).toContain("Total: NT$650");
  });
  it("edit total → + Dagdag item → total = sum, (edited) gone", () => {
    open(buyer("TikTok"));
    editTotal();
    fireEvent.click(q("tts-add")!);
    expect(q("tts-edited")).toBeNull();
    expect(preview()).toContain("Total: NT$630");
  });
  it("edit total → type the TEXT of an added line → override kept", () => {
    open(buyer("TikTok"));
    fireEvent.click(q("tts-add")!);
    fireEvent.change(q("tts-total")!, { target: { value: "999" } });
    fireEvent.change(qa("tts-text")[0], { target: { value: "gift wrap" } });
    expect(q("tts-edited")).not.toBeNull();
    expect(preview()).toContain("Total: NT$999");
  });
});

describe("FIX 2 — quantity in the message", () => {
  it("qty 3 → 'x3' after the item; qty 1 → no 'x1'; added line → no 'x'", () => {
    open(buyer("TikTok", "@ann.reyes", true));
    fireEvent.click(q("tts-add")!);
    fireEvent.change(qa("tts-text")[0], { target: { value: "shipping" } });
    fireEvent.change(qa("tts-price")[3], { target: { value: "60" } });
    const m = preview();
    expect(m).toContain("3. B2 top x3 — NT$280");
    expect(m).toContain("1. A1 dress — NT$350");
    expect(m).not.toContain("x1");
    expect(m).toContain("4. shipping — NT$60");
    expect(q("tts-qty")!.textContent).toBe("x3");            // read-only marker in the sheet
    expect(qa("tts-qty").length).toBe(1);
  });
  it("pure: buildSendMessage prints x{qty} only when qty > 1", () => {
    const lines = initialSendLines([{ item: "A12 Pink blouse", total: 750, qty: 3 }, { item: "B", total: 5, qty: 1 }, { item: "C", total: 1 }]);
    expect(buildSendMessage({ name: "A", date: "10/14", lines, total: 756, cur: "NT$", note: "", labels: { hi: "Hi {name}!", order: "({date})", total: "Total: {total}" } }))
      .toBe("Hi A!\n(10/14)\n1. A12 Pink blouse x3 — NT$750\n2. B — NT$5\n3. C — NT$1\nTotal: NT$756");
  });
  it("non-admin: the receipt box shows no Send button and no quantity", () => {
    const { container } = renderOrders(buyer("TikTok", "@ann.reyes", true), false);
    const box = container.querySelector("[data-testid='buyer-receipt']")!;
    expect(q("tt-send-btn")).toBeNull();
    expect(box.textContent).not.toMatch(/x3/);
    expect(box.textContent).toContain("B2 top");
  });
  it("buyerReceipt(): same item/total values as before, plus qty", () => {
    const r = buyerReceipt([buyer("TikTok", "@ann.reyes", true)], 3)!;
    expect(r.lines.map((l) => ({ item: l.item, total: l.total }))).toEqual([
      { item: "A1 dress", total: 350 }, { item: "freebie", total: 0 }, { item: "B2 top", total: 280 },
    ]);
    expect(r.lines.map((l) => l.qty)).toEqual([1, 1, 3]);
    expect(r.total).toBe(630);
    expect(r.count).toBe(3);
  });
});

describe("FIX 3 — who sees Send: admin OR the tiktok_send preview list", () => {
  const allowedFor = (isAdmin: boolean, listed: boolean) => {
    setFeatureAccess(Object.fromEntries(FEATURE_KEYS.map((k) => [k, k === "tiktok_send" && listed])) as never);
    return tiktokSendAllowed(isAdmin, hasFeature("tiktok_send"), true);
  };
  for (const [label, isAdmin, listed, sees] of [
    ["admin (not listed)", true, false, true],
    ["listed non-admin", false, true, true],
    ["unlisted non-admin", false, false, false],
  ] as const) {
    it(`${label} → ${sees ? "sees Send" : "sees nothing"}`, () => {
      const allowed = allowedFor(isAdmin, listed);
      expect(allowed).toBe(sees);
      renderOrders(buyer("TikTok"), allowed);
      expect(!!q("tt-send-btn")).toBe(sees);
    });
  }
  it("tiktok_send is a feature key; RedesignApp passes ONE boolean from admin || the key", () => {
    expect(FEATURE_KEYS).toContain("tiktok_send");
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain('tiktokSend={tiktokSendAllowed(isAdmin, hasFeature("tiktok_send"), featureSw.tiktokSend)}');
    expect(app).not.toMatch(/<Orders[^>]*\bisAdmin=/);
  });
});
