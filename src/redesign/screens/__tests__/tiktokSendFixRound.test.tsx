// Send to TikTok — fix round (2026-10-14): duplicate buyer # chooser, past-session mode, the
// "may be incomplete" note, the Send total = printed lines, one-dot prices, the off switch, the
// list reload on every open, and the multi-day message date.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";

const S = vi.hoisted(() => ({ rpcCalls: 0, bySession: {} as Record<string, unknown[]>, summaries: [] as unknown[] }));
function builder() {
  const filters: Record<string, unknown> = {};
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { filters[k] = v; return q; },
    not: () => q,
    order: () => q,
    range: async () => ({ data: S.bySession[String(filters.session_id)] || [], error: null }),
  };
  return q;
}
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => builder(), rpc: async () => { S.rpcCalls++; return { data: S.summaries, error: null }; }, auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }) } },
}));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const copyText = vi.hoisted(() => vi.fn(async (_s: string) => true));
vi.mock("../../components/inviteShare", async (orig) => ({ ...(await orig<object>()), copyText }));

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import { tiktokSendAllowed, priceInput, sumLines, messageTotal, buildSendMessage, currentSessionDate, type SendLine } from "../../adapters/tiktokSend";
import { buyerReceipt, buyerReceipts } from "../../adapters/useReadData";
import { mayBeIncomplete, RETENTION_V2_SINCE } from "../../adapters/pastSessions";
import { parseSwitches, FEATURE_SWITCH_KEYS } from "../../adapters/featureSwitches";
import type { Buyer } from "../../../lib/orderTypes";
import type { Order } from "../../data";

const ON = Date.UTC(2026, 9, 14, 5);
const mk = (num: number, handle: string, name: string, items: [string, number][]): Buyer => ({
  handle, name, platform: "TikTok", num, totalSpent: items.reduce((a, [, p]) => a + p, 0), totalOrders: items.length,
  orders: items.map(([item, total], i) => ({ item, total, qty: 1, orderNum: ON + i })) as never,
});
const ANN = mk(3, "@ann", "Ann", [["A1 dress", 350], ["B2 top", 280]]);
const BEA = mk(3, "@bea", "Bea", [["C3 skirt", 120]]);
const row = (sid: string, day: string, n: number, handle: string, name: string, product: string, price: number) =>
  ({ session_id: sid, session_date: day, created_at: `${day}T05:00:00.000Z`, buyer_number: n, handle, customer_name: name, platform: "TikTok", product, price, qty: 1, comment_msg_id: null, auto_code: null });
const sum = (session_id: string, first_day: string, last_day: string, orders: number) => ({ session_id, first_day, last_day, orders, latest: `${last_day}T05:00:00.000Z` });

const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLInputElement[];
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const todayOrder = { id: "#7", buyer: "Today Row Buyer", handle: "@row", items: "Z9", total: 10, time: "13:00", platform: "TikTok", status: "New", date: "2026-10-14", orderNum: ON } as unknown as Order;

const renderOrders = (buyers: Buyer[], extra: Record<string, unknown> = {}) => {
  const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={buyers} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" {...extra} /></TProvider>);
  const search = r.container.querySelectorAll("input")[0] as HTMLInputElement;
  return { ...r, type: (v: string) => fireEvent.change(search, { target: { value: v } }) };
};
const pickSession = async (idx: number) => {
  fireEvent.click(q("ord-session-btn")!);
  await settle();
  fireEvent.click(qa("ord-session-item")[idx]);
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); S.rpcCalls = 0;
  S.summaries = [sum("old", "2026-10-08", "2026-10-10", 3), sum("older", "2026-09-28", "2026-09-30", 1)];
  S.bySession = {
    old: [row("old", "2026-10-08", 1, "@oldann", "Old Ann", "P1", 200), row("old", "2026-10-09", 1, "@oldbea", "Old Bea", "P2", 90), row("old", "2026-10-10", 2, "@x", "X", "P3", 50)],
    older: [row("older", "2026-09-28", 1, "@olderbuyer", "Older Buyer", "Q1", 40)],
  };
});

describe("1 — duplicate buyer # (B1)", () => {
  it("buyerReceipts returns every exact match; buyerReceipt (first match) is unchanged", () => {
    expect(buyerReceipts([ANN, BEA, mk(30, "@c", "C", [["x", 1]])], 3).map((r) => r.handle)).toEqual(["@ann", "@bea"]);
    expect(buyerReceipt([ANN, BEA], 3)!.handle).toBe("@ann");
    expect(buyerReceipts([ANN], 3)).toHaveLength(1);
  });
  it("current session: a chooser (name + @handle + items + total); card and Send only after a pick", () => {
    const r = renderOrders([ANN, BEA]);
    r.type("3");
    expect(q("buyer-receipt")).toBeNull();
    expect(q("tt-send-btn")).toBeNull();
    const opts = qa("dup-option").map((e) => e.textContent);
    expect(opts).toEqual(["Ann@ann2 itemsNT$630", "Bea@bea1 itemsNT$120"]);
    fireEvent.click(qa("dup-option")[1]);
    expect(q("buyer-receipt")!.textContent).toContain("Bea");
    expect(q("buyer-receipt")!.textContent).not.toContain("Ann");
    fireEvent.click(q("tt-send-btn")!);
    expect(q("tts-preview")!.textContent).toContain("Hi Bea!");
    fireEvent.click(q("dup-back")!);                      // back to the chooser
    expect(q("buyer-receipt")).toBeNull();
    expect(qa("dup-option")).toHaveLength(2);
  });
  it("the pick follows the buyer, not the list position, when the live list reorders", () => {
    const r = renderOrders([ANN, BEA]);
    r.type("3");
    fireEvent.click(qa("dup-option")[1]);                 // Bea
    r.rerender(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={[BEA, ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" /></TProvider>);
    expect(q("buyer-receipt")!.textContent).toContain("Bea");
    expect(q("buyer-receipt")!.textContent).not.toContain("Ann");
  });
  it("a single match is the card exactly as before (no chooser, no back link)", () => {
    const r = renderOrders([ANN, mk(4, "@d", "D", [["y", 5]])]);
    r.type("3");
    expect(q("dup-chooser")).toBeNull();
    expect(q("dup-back")).toBeNull();
    expect(q("buyer-receipt")!.textContent).toContain("Ann");
  });
  it("past session: two buyers with #1 → chooser, then that buyer's card", async () => {
    const r = renderOrders([ANN]);
    await pickSession(0);
    r.type("1");
    expect(q("buyer-receipt")).toBeNull();
    expect(qa("dup-option").map((e) => e.textContent)).toEqual(["Old Ann@oldann1 itemsNT$200", "Old Bea@oldbea1 itemsNT$90"]);
    fireEvent.click(qa("dup-option")[0]);
    expect(q("buyer-receipt")!.textContent).toContain("Old Ann");
  });
});

describe("5 — 'may be incomplete' (A10)", () => {
  it("first day before RETENTION_V2_SINCE − 10 → note; on or after → none", () => {
    expect(RETENTION_V2_SINCE).toBe("2026-10-14");
    expect(mayBeIncomplete({ first: "2026-10-03" })).toBe(true);
    expect(mayBeIncomplete({ first: "2026-10-04" })).toBe(false);
  });
  it("shown in the list and on the card for an old session only", async () => {
    const r = renderOrders([ANN]);
    fireEvent.click(q("ord-session-btn")!);
    await settle();
    const items = qa("ord-session-item");
    expect(items[0].querySelector("[data-testid='ord-session-incomplete']")).toBeNull();
    expect(items[1].querySelector("[data-testid='ord-session-incomplete']")!.textContent).toBe("May be incomplete — older days were removed");
    fireEvent.click(items[1]);
    await settle();
    r.type("1");
    expect(q("receipt-incomplete")!.textContent).toBe("May be incomplete — older days were removed");
  });
});

describe("6 — Send total = the printed lines (A11)", () => {
  const L = (text: string, price: string): SendLine => ({ key: text + price, text, price, added: true, qty: 1 });
  it("an added line with a price but no text is not printed and not in the total", () => {
    const lines = [L("A1", "100"), L("", "50"), L("  ", "7")];
    expect(sumLines(lines)).toBe(100);
    expect(messageTotal(lines, null)).toBe(100);
    const msg = buildSendMessage({ name: "Ann", date: "10/14", lines, total: messageTotal(lines, null), cur: "NT$", note: "", labels: { hi: "Hi {name}", order: "({date})", total: "Total: {total}" } });
    expect(msg).toBe(["Hi Ann", "(10/14)", "1. A1 — NT$100", "Total: NT$100"].join("\n"));
  });
  it("in the sheet: + Add item with a price only leaves the total at the printed sum", () => {
    const r = renderOrders([ANN]);
    r.type("3");
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.click(q("tts-add")!);
    fireEvent.change(qa("tts-price")[2], { target: { value: "500" } });
    expect((q("tts-total") as HTMLInputElement).value).toBe("630");
    expect(q("tts-preview")!.textContent).toContain("Total: NT$630");
  });
});

describe("7 — past-session mode (B2/B3)", () => {
  it("amber banner; the current list and non-numeric results are hidden → 'Type a buyer #'", async () => {
    const r = renderOrders([ANN]);
    expect(document.body.textContent).toContain("Today Row Buyer");
    await pickSession(0);
    expect(q("ord-past-banner")!.textContent).toBe("Past session · 10/08 → 10/10 — buyer # only");
    expect(document.body.textContent).not.toContain("Today Row Buyer");
    expect(q("orders-summary")).toBeNull();
    expect(q("ord-past-type")!.textContent).toBe("Type a buyer #");
    r.type("Today");
    expect(document.body.textContent).not.toContain("Today Row Buyer");
    expect(q("ord-past-type")!.textContent).toBe("Type a buyer #");
  });
  it("Send sheet says 'Past session 10/08 → 10/10' and asks ONE confirm before any copy", async () => {
    const r = renderOrders([ANN]);
    await pickSession(0);
    r.type("2");
    fireEvent.click(q("tt-send-btn")!);
    expect(q("tts-past")!.textContent).toBe("Past session 10/08 → 10/10");
    expect(q("tts-copy-open")).toBeNull();
    expect(q("tts-copy-only")).toBeNull();
    expect(q("tts-old-confirm")!.textContent).toContain("This is an OLD session (10/08 → 10/10). Send anyway?");
    fireEvent.click(q("tts-old-yes")!);
    expect(q("tts-old-confirm")).toBeNull();
    await act(async () => { fireEvent.click(q("tts-copy-only")!); });
    await act(async () => { fireEvent.click(q("tts-copy-only")!); });
    expect(copyText).toHaveBeenCalledTimes(2);           // one confirm, then copies freely
  });
  it("the current session asks nothing", () => {
    const r = renderOrders([ANN]);
    r.type("3");
    fireEvent.click(q("tt-send-btn")!);
    expect(q("tts-past")).toBeNull();
    expect(q("tts-old-confirm")).toBeNull();
    expect(q("tts-copy-only")).not.toBeNull();
  });
});

describe("8 — off switch tiktok_send_enabled (B7)", () => {
  it("off → nobody, admin included; on → admin or listed", () => {
    expect(tiktokSendAllowed(true, true, false)).toBe(false);
    expect(tiktokSendAllowed(true, false, true)).toBe(true);
    expect(tiktokSendAllowed(false, true, true)).toBe(true);
    expect(tiktokSendAllowed(false, false, true)).toBe(false);
  });
  it("read like the other switches: only the exact 'true' is on; missing row = off", () => {
    expect(FEATURE_SWITCH_KEYS.tiktokSend).toBe("tiktok_send_enabled");
    expect(parseSwitches([{ key: "tiktok_send_enabled", value: "true" }]).tiktokSend).toBe(true);
    expect(parseSwitches([{ key: "tiktok_send_enabled", value: "false" }]).tiktokSend).toBe(false);
    expect(parseSwitches([]).tiktokSend).toBe(false);
  });
  it("off → no Send button and no session picker", () => {
    const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[ANN]} todayId="2026-10-14" tiktokSend={tiktokSendAllowed(true, true, false)} /></TProvider>);
    fireEvent.change(r.container.querySelectorAll("input")[0], { target: { value: "3" } });
    expect(q("buyer-receipt")).not.toBeNull();
    expect(q("tt-send-btn")).toBeNull();
    expect(q("ord-session-btn")).toBeNull();
  });
  it("sql/128 seeds the key 'true' in the same file as my_session_summaries()", () => {
    const sql = readFileSync("sql/128_tiktok_send_support.sql", "utf8");
    expect(sql).toContain("('tiktok_send_enabled', 'true')");
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/grant execute on function public\.my_session_summaries\(\) to authenticated/);
  });
});

describe("9 — small items", () => {
  it("A13 — prices take one dot only", () => {
    expect(priceInput("12.5.0")).toBe("12.50");
    expect(priceInput("1..2")).toBe("1.2");
    expect(priceInput("a1b2")).toBe("12");
    const r = renderOrders([ANN]);
    r.type("3");
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.change(qa("tts-price")[0], { target: { value: "12.5.0" } });
    expect(qa("tts-price")[0].value).toBe("12.50");
    fireEvent.change(q("tts-total")!, { target: { value: "9.9.9" } });
    expect((q("tts-total") as HTMLInputElement).value).toBe("9.99");
  });
  it("A19 — the session list reloads every time the picker opens", async () => {
    renderOrders([ANN]);
    fireEvent.click(q("ord-session-btn")!);
    await settle();
    expect(qa("ord-session-item")).toHaveLength(2);
    fireEvent.click(q("ord-session-btn")!);              // close
    S.summaries = [sum("new", "2026-10-13", "2026-10-13", 4), ...S.summaries];
    fireEvent.click(q("ord-session-btn")!);              // open again
    await settle();
    expect(S.rpcCalls).toBe(2);
    expect(qa("ord-session-item")).toHaveLength(3);
  });
  it("A16 — current multi-day session → the session range; 1-day → a single date", () => {
    const started = "2026-10-12T02:00:00.000Z"; // 10/12 Taipei
    expect(currentSessionDate(started, 3, [ON], "2026-10-14")).toBe("10/12 → 10/14");
    expect(currentSessionDate(started, 1, [ON], "2026-10-14")).toBe("10/14");
    expect(currentSessionDate(null, 3, [ON], "2026-10-14")).toBe("10/14");
    const r = renderOrders([ANN], { sessionStartedAt: started, sessionWindowDays: 3 });
    r.type("3");
    fireEvent.click(q("tt-send-btn")!);
    expect(q("tts-preview")!.textContent).toContain("Order mo sa live (10/12 → 10/14):");
  });
});
