// Free-button orders on the Orders screen: the row, the buyer card line, the export and the
// "Send to TikTok" line show the Free word instead of a 0 amount. A normal comment order at
// price 0 (and every priced order) shows exactly what it showed before.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } }));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const X = vi.hoisted(() => ({ rows: null as unknown[][] | null }));
vi.mock("../../adapters/brandedExport", async (orig) => {
  const real = await orig<typeof import("../../adapters/brandedExport")>();
  return { ...real, exportBrandedXlsx: async (i: Parameters<typeof real.exportBrandedXlsx>[0]) => { X.rows = i.rows as unknown[][]; } };
});

import { TProvider, buildT } from "../../i18n";
import Orders from "../Orders";
import { buildSendMessage, initialSendLines, lineAmount, type SendLine } from "../../adapters/tiktokSend";
import type { Buyer } from "../../../lib/orderTypes";
import type { Order } from "../../data";

const ON = Date.UTC(2026, 10, 19, 5);
const o = (id: string, buyer: string, items: string, total: number, n: number): Order =>
  ({ id, buyer, handle: `@${buyer.toLowerCase()}`, items, qty: 1, total, time: "13:00", platform: "TikTok", status: "New", date: "2026-11-19", orderNum: ON + n } as unknown as Order);
const ROWS = [o("#1", "Ana", "FREE", 0, 1), o("#2", "Ben", "mine po", 0, 2), o("#3", "Cara", "150", 150, 3), o("#4", "Dan", "free", 0, 4)];
const CARD: Buyer = { handle: "@ann", name: "Ann", platform: "TikTok", num: 3, totalSpent: 150, totalOrders: 3,
  orders: [{ item: "FREE", total: 0, orderNum: ON, qty: 1 }, { item: "mine po", total: 0, orderNum: ON + 1, qty: 1 }, { item: "150", total: 150, orderNum: ON + 2, qty: 1 }] as never };
const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLElement[];
const settle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const show = (lang = "en", orders: Order[] = ROWS, buyers: Buyer[] = []) =>
  render(<TProvider lang={lang}><Orders onGoPrint={vi.fn()} cur="NT$" orders={orders} state="live" buyers={buyers} todayId="2026-11-19" sessionId="cur" tiktokSend sellerId="me" /></TProvider>);

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); X.rows = null; });

describe("Orders row", () => {
  it("a Free order shows the Free word (green) instead of NT$0; the other rows are as before", () => {
    const { container } = show();
    const free = qa("ord-free");
    expect(free).toHaveLength(1);
    expect(free[0].textContent).toBe("Free");
    expect(free[0].style.color).toBe("var(--ok)");
    const text = container.textContent || "";
    expect(text).toContain("mine po");
    expect((text.match(/NT\$0/g) || []).length).toBeGreaterThanOrEqual(2);  // Ben's comment order and Dan's lower-case "free" comment
    expect(text).toContain("NT$150");
  });
  it("the word follows the app language (the item text FREE does not)", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const r = show(lang, [ROWS[0]]);
      expect(q("ord-free")!.textContent).toBe(buildT(lang).rd_cpp_free);
      expect(r.container.textContent).toContain("FREE");
      r.unmount();
    }
    expect(new Set(["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"].map((l) => buildT(l).rd_cpp_free)).size).toBe(8);
  });
  it("no Free order → no Free word anywhere (screen unchanged)", () => {
    show("en", [ROWS[1], ROWS[2], ROWS[3]]);
    expect(q("ord-free")).toBeNull();
  });
});

describe("Orders export", () => {
  it("the Amount cell says Free for a Free order; NT$0 / NT$150 for the others", async () => {
    show();
    fireEvent.click(q("orders-export")!);
    fireEvent.click(q("orders-export-xlsx")!);
    await settle();
    expect(X.rows).not.toBeNull();
    const byBuyer = Object.fromEntries(X.rows!.map((r) => [String(r[1]), r]));
    expect(byBuyer.Ana[3]).toBe("FREE");
    expect(byBuyer.Ana[4]).toBe("Free");
    expect(byBuyer.Ben[4]).toBe("NT$0");
    expect(byBuyer.Dan[4]).toBe("NT$0");
    expect(byBuyer.Cara[4]).toBe("NT$150");
  });
});

describe("buyer card + Send to TikTok", () => {
  const openCard = (lang = "en") => { const r = show(lang, [], [CARD]); fireEvent.change(r.container.querySelector("input")!, { target: { value: "3" } }); return r; };
  it("the card's Free line says Free; the comment line at 0 still says NT$0; the total is the sum as before", () => {
    openCard();
    const card = q("buyer-receipt")!;
    expect(qa("ord-line-free")).toHaveLength(1);
    expect(qa("ord-line-free")[0].textContent).toBe("Free");
    expect(card.textContent).toContain("NT$0");
    expect(card.textContent).toContain("NT$150");
  });
  it("the message: \"1. FREE — Free\", a comment at 0 keeps \"— NT$0\", the total is unchanged", () => {
    openCard();
    fireEvent.click(q("tt-send-btn")!);
    const msg = (q("tts-preview") as HTMLTextAreaElement).value;
    expect(msg).toContain("1. FREE — Free");
    expect(msg).toContain("2. mine po — NT$0");
    expect(msg).toContain("3. 150 — NT$150");
    expect(msg).toContain("NT$150");
    expect(msg).not.toContain("FREE — NT$0");
  });
  it("Filipino app → \"— Libre\"", () => {
    openCard("fil");
    fireEvent.click(q("tt-send-btn")!);
    expect((q("tts-preview") as HTMLTextAreaElement).value).toContain("1. FREE — Libre");
  });
});

describe("message lines (pure)", () => {
  const lines = initialSendLines([{ item: "FREE", total: 0 }, { item: "mine po", total: 0 }, { item: "150", total: 150 }]);
  const labels = { hi: "Hi {name}!", order: "({date})", total: "T {total}", free: "Free" };
  it("only the Free-button line is marked; the other lines are the same objects as before", () => {
    expect(lines[0].free).toBe(true);
    expect(lines[1]).toEqual({ key: "c1", text: "mine po", price: "0", added: false, qty: 1, orig: "mine po" });
    expect(lines[2]).toEqual({ key: "c2", text: "150", price: "150", added: false, qty: 1, orig: "150" });
  });
  it("Free while its price is 0; a price typed on it shows that price; editing its text keeps Free", () => {
    expect(lineAmount(lines[0], "NT$", "Free")).toBe("Free");
    expect(lineAmount({ ...lines[0], price: "20" }, "NT$", "Free")).toBe("NT$20");
    expect(lineAmount({ ...lines[0], text: "Keychain" }, "NT$", "Free")).toBe("Free");
    expect(lineAmount(lines[1], "NT$", "Free")).toBe("NT$0");
    const added: SendLine = { key: "a1", text: "FREE", price: "0", added: true, qty: 1 };   // a line the seller typed by hand
    expect(lineAmount(added, "NT$", "Free")).toBe("NT$0");
  });
  it("no Free word passed (an older caller) → the message is exactly as before", () => {
    const old = { hi: labels.hi, order: labels.order, total: labels.total };
    expect(buildSendMessage({ name: "A", date: "11/19", lines, total: 150, cur: "NT$", note: "", labels: old }))
      .toBe("Hi A!\n(11/19)\n1. FREE — NT$0\n2. mine po — NT$0\n3. 150 — NT$150\nT NT$150");
    expect(buildSendMessage({ name: "A", date: "11/19", lines, total: 150, cur: "NT$", note: "", labels }))
      .toBe("Hi A!\n(11/19)\n1. FREE — Free\n2. mine po — NT$0\n3. 150 — NT$150\nT NT$150");
  });
});
