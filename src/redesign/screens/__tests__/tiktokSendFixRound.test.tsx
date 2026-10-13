// Send to TikTok — fix round (2026-10-14): duplicate buyer # chooser, past-session mode, the
// "may be incomplete" note, the Send total = printed lines, one-dot prices, the off switch, the
// list reload on every open, and the multi-day message date.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";

const S = vi.hoisted(() => ({ rpcCalls: 0, bySession: {} as Record<string, unknown[]>, summaries: [] as unknown[], writes: [] as string[] }));
function builder() {
  const filters: Record<string, unknown> = {};
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { filters[k] = v; return q; },
    not: () => q,
    order: () => q,
    range: async () => ({ data: S.bySession[String(filters.session_id)] || [], error: null }),
    insert: () => { S.writes.push("insert"); return q; },
    update: () => { S.writes.push("update"); return q; },
    upsert: () => { S.writes.push("upsert"); return q; },
    delete: () => { S.writes.push("delete"); return q; },
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
// Paid flags: every order "has a row" so Mark paid would show wherever paid UI is allowed.
const setPaid = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../adapters/ordersPaid", async (orig) => ({ ...(await orig<object>()), usePaidFlags: (on: boolean) => ({ map: on ? { get: () => ({ id: 1, paidAt: null, createdAt: "2026-10-14T00:00:00Z" }) } : new Map(), setPaid }) }));
const exported = vi.hoisted(() => ({ last: null as null | { rows: unknown[][]; filename: string } }));
vi.mock("../../adapters/brandedExport", async (orig) => ({ ...(await orig<object>()), exportBrandedXlsx: async (i: { rows: unknown[][]; filename: string }) => { exported.last = i; }, exportBrandedPdf: (i: { rows: unknown[][]; filename: string }) => { exported.last = i; } }));

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import { tiktokSendAllowed, priceInput, sumLines, messageTotal, buildSendMessage, currentSessionDate, type SendLine } from "../../adapters/tiktokSend";
import { buyerReceipt, buyerReceipts } from "../../adapters/useReadData";
import { reprintBuyer } from "../../adapters/reprint";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";
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
let nextRowId = 1000;
const row = (sid: string, day: string, n: number, handle: string, name: string, product: string, price: number, id: number | null = nextRowId++) =>
  ({ id, session_id: sid, session_date: day, created_at: `${day}T05:00:00.000Z`, buyer_number: n, handle, customer_name: name, platform: "TikTok", product, price, qty: 1, comment_msg_id: null, auto_code: null });
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
  fireEvent.click(q("ord-range")!);
  await settle();
  fireEvent.click(qa("ord-session-item")[idx]);
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); S.rpcCalls = 0; S.writes = []; exported.last = null;
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
    fireEvent.click(q("ord-range")!);
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
  it("amber button + banner; the list is THAT session's orders only; search works inside it", async () => {
    const r = renderOrders([ANN]);
    expect(document.body.textContent).toContain("Today Row Buyer");
    await pickSession(0);
    expect(q("ord-range")!.textContent).toBe("🗓 Past session · 10/08 → 10/10 ▾");
    expect(q("ord-past-banner")!.textContent).toBe("Past session · 10/08 → 10/10");
    const text = document.body.textContent || "";
    expect(text).not.toContain("Today Row Buyer");
    expect(text).toContain("Old Ann");
    expect(text).toContain("Old Bea");
    expect(text).toContain("P3");
    r.type("Bea");
    expect(document.body.textContent).toContain("Old Bea");
    expect(document.body.textContent).not.toContain("Old Ann");
    r.type("Today");
    expect(q("ord-past-empty")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Today Row Buyer");
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
    fireEvent.click(q("ord-range")!);
    expect(q("ord-past-heading")).toBeNull();
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
    fireEvent.click(q("ord-range")!);
    await settle();
    expect(qa("ord-session-item")).toHaveLength(2);
    fireEvent.click(q("ord-range")!);                    // close
    S.summaries = [sum("new", "2026-10-13", "2026-10-13", 4), ...S.summaries];
    fireEvent.click(q("ord-range")!);                    // open again
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

describe("10 — one 🗓 menu: This session + past sessions (tiktokSend only)", () => {
  const menuIds = () => Array.from(document.querySelectorAll("[role='menu'] [data-testid]")).map((e) => e.getAttribute("data-testid"));
  it("gated: This session + 'Past sessions' + one row per past session; no Today / 7 days / Custom", async () => {
    renderOrders([ANN]);
    fireEvent.click(q("ord-range")!);
    await settle();
    expect(menuIds()).toEqual(["ord-range-session", "ord-past-heading", "ord-session-item", "ord-session-item", "ord-session-incomplete"]);
    expect(q("ord-past-heading")!.textContent).toBe("Past sessions");
    expect(qa("ord-session-item")[0].textContent).toBe("Past session · 10/08 → 10/10 · 3 days");
    expect(qa("ord-session-item")[1].textContent).toContain("Past session · 09/28 → 09/30 · 3 days");
  });
  it("ungated: the 4 options exactly as before, no past sessions, no reads", async () => {
    const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={[ANN]} todayId="2026-10-14" /></TProvider>);
    fireEvent.click(q("ord-range")!);
    await settle();
    expect(menuIds()).toEqual(["ord-range-session", "ord-range-today", "ord-range-7days", "ord-range-custom"]);
    expect(S.rpcCalls).toBe(0);
    r.unmount();
  });
  it("a 1-day past session reads 'Past session · 10/07 · 1 day'", async () => {
    S.summaries = [sum("one", "2026-10-07", "2026-10-07", 2)];
    renderOrders([ANN]);
    fireEvent.click(q("ord-range")!);
    await settle();
    expect(qa("ord-session-item")[0].textContent).toBe("Past session · 10/07 · 1 day");
  });
  it("Export of a past session = that session's orders only", async () => {
    renderOrders([ANN]);
    await pickSession(0);
    fireEvent.click(q("orders-export")!);
    await act(async () => { fireEvent.click(q("orders-export-xlsx")!); });
    const buyers = exported.last!.rows.map((r) => r[1]);
    expect(buyers.sort()).toEqual(["Old Ann", "Old Bea", "X"]);
    expect(exported.last!.filename).toBe("sellerflow-orders-session-2026-10-08_2026-10-10");
  });
  it("Reprint in a past session prints the STORED row: same handle #3 there, #12 now → sticker says #3", async () => {
    S.bySession.old = [row("old", "2026-10-09", 3, "@ann", "Ann", "OLD-ITEM", 150)];
    const now = mk(12, "@ann", "Ann", [["NOW-ITEM", 99]]);
    const nowOrder = { ...todayOrder, id: "#12", buyer: "Ann", handle: "@ann", items: "NOW-ITEM", orderNum: Date.parse("2026-10-09T05:00:00.000Z") } as unknown as Order;
    const onReprintRow = vi.fn(), onReprintOrder = vi.fn();
    render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[nowOrder]} state="live" buyers={[now]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" onReprintRow={onReprintRow} onReprintOrder={onReprintOrder} /></TProvider>);
    await pickSession(0);
    fireEvent.click(document.querySelector("[aria-label='Reprint']")!);
    fireEvent.click(q("reprint-old-ok")!);
    expect(onReprintOrder).not.toHaveBeenCalled();
    expect(onReprintRow).toHaveBeenCalledTimes(1);
    const stored = onReprintRow.mock.calls[0][0];
    expect(stored).toMatchObject({ buyer_number: 3, handle: "@ann", product: "OLD-ITEM", price: 150 });
    expect(reprintBuyer(stored)!.num).toBe(3);
    expect(reprintBuyer(stored)!.orders[0].item).toBe("OLD-ITEM");
  });
  it("no paid UI in a past session (no Mark paid, no Unpaid filter); it is back on This session", async () => {
    const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={[ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" paidFlag /></TProvider>);
    expect(q("ord-unpaid-pill")).not.toBeNull();
    expect(r.container.textContent).toContain("Mark paid");
    await pickSession(0);
    expect(q("ord-unpaid-pill")).toBeNull();
    expect(r.container.textContent).not.toContain("Mark paid");
    fireEvent.click(q("ord-range")!);
    fireEvent.click(q("ord-range-session")!);
    await settle();
    expect(q("ord-unpaid-pill")).not.toBeNull();
  });
  it("zero writes in a past session: browsing, search, card, Send copy and Reprint", async () => {
    const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={[ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" paidFlag onReprintRow={vi.fn()} /></TProvider>);
    await pickSession(0);
    fireEvent.click(document.querySelector("[aria-label='Reprint']")!);
    fireEvent.click(q("reprint-old-ok")!);
    fireEvent.change(r.container.querySelectorAll("input")[0], { target: { value: "2" } });
    fireEvent.click(q("tt-send-btn")!);
    fireEvent.click(q("tts-old-yes")!);
    await act(async () => { fireEvent.click(q("tts-copy-only")!); });
    expect(S.writes).toEqual([]);
    expect(setPaid).not.toHaveBeenCalled();
    expect(saveOrderToDatabase).not.toHaveBeenCalled();
    expect(saveLiveSessionOrder).not.toHaveBeenCalled();
    expect(saveCustomerToDatabase).not.toHaveBeenCalled();
  });
  it("back to This session = the original screen", async () => {
    const r = renderOrders([ANN]);
    const before = r.container.innerHTML;
    await pickSession(0);
    fireEvent.click(q("ord-range")!);
    fireEvent.click(q("ord-range-session")!);
    await settle();
    expect(q("ord-past-banner")).toBeNull();
    expect(q("ord-range")!.textContent).toBe("🗓 This session ▾");
    expect(r.container.innerHTML).toBe(before);
  });
});

describe("11 — fix round 3", () => {
  const renderWith = (props: Record<string, unknown> = {}, buyers: Buyer[] = [ANN]) =>
    render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={buyers} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" {...props} /></TProvider>);
  const reprintBtns = () => Array.from(document.querySelectorAll("[aria-label='Reprint']")) as HTMLElement[];
  const rowsDrawn = () => document.querySelectorAll("[data-testid='ord-row-foot']").length;

  it("A1 — two rows with the SAME created_at ms: each Reprint prints its own row (looked up by id)", async () => {
    const same = "2026-10-09T05:00:00.123Z";
    const mkRow = (id: number, n: number, handle: string, product: string) => ({ ...row("old", "2026-10-09", n, handle, handle, product, 100, id), created_at: same });
    for (const pickIdx of [0, 1]) {
      S.bySession.old = [mkRow(11, 3, "@aa", "ITEM-A"), mkRow(12, 4, "@bb", "ITEM-B")];
      const onReprintRow = vi.fn();
      const r = renderWith({ onReprintRow });
      await pickSession(0);
      const btns = reprintBtns();
      expect(btns).toHaveLength(2);
      // the list is newest first: index 0 = row 12, index 1 = row 11
      fireEvent.click(btns[pickIdx]);
      fireEvent.click(q("reprint-old-ok")!);
      const stored = onReprintRow.mock.calls[0][0];
      expect(stored.id).toBe(pickIdx === 0 ? 12 : 11);
      expect(reprintBuyer(stored)!.num).toBe(pickIdx === 0 ? 4 : 3);
      expect(reprintBuyer(stored)!.orders[0].item).toBe(pickIdx === 0 ? "ITEM-B" : "ITEM-A");
      r.unmount();
    }
  });

  it("B1 — one confirm per past session; Cancel prints nothing; current session never asks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onReprintRow = vi.fn(), onReprintOrder = vi.fn();
      renderWith({ onReprintRow, onReprintOrder });
      fireEvent.click(reprintBtns()[0]);                   // current session: prints directly
      expect(q("reprint-old-confirm")).toBeNull();
      expect(onReprintOrder).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(2100); });
      await pickSession(0);
      fireEvent.click(reprintBtns()[0]);
      expect(q("reprint-old-confirm")!.textContent).toContain("Reprint an OLD order?");
      expect(q("reprint-old-confirm")!.textContent).toContain("This order is from Past session · 10/08 → 10/10. The sticker will be the same as the original.");
      fireEvent.click(q("reprint-old-cancel")!);
      expect(onReprintRow).not.toHaveBeenCalled();
      fireEvent.click(reprintBtns()[0]);                   // still asks after a Cancel
      fireEvent.click(q("reprint-old-ok")!);
      expect(onReprintRow).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(2100); });
      fireEvent.click(reprintBtns()[1]);                   // same past session: prints directly
      expect(q("reprint-old-confirm")).toBeNull();
      expect(onReprintRow).toHaveBeenCalledTimes(2);
      await act(async () => { vi.advanceTimersByTime(2100); });
      await pickSession(1);                                // another past session → asks again
      fireEvent.click(reprintBtns()[0]);
      expect(q("reprint-old-confirm")).not.toBeNull();
      expect(onReprintRow).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("B1 — the fil wording", async () => {
    render(<TProvider lang="fil"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" onReprintRow={vi.fn()} /></TProvider>);
    await pickSession(0);
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").startsWith("↻"))!);
    const box = q("reprint-old-confirm")!.textContent || "";
    expect(box).toContain("I-reprint ang LUMANG order?");
    expect(box).toContain("Galing ang order na ito sa Past session · 10/08 → 10/10. Pareho ang sticker sa orihinal.");
    expect(box).toContain("Cancel");
    expect(box).toContain("I-reprint");
  });

  it("A5 — a past row with no stored id has no Reprint button", async () => {
    S.bySession.old = [row("old", "2026-10-08", 1, "@a", "A", "P1", 10, null), row("old", "2026-10-09", 2, "@b", "B", "P2", 20, 77)];
    renderWith({ onReprintRow: vi.fn() });
    await pickSession(0);
    expect(rowsDrawn()).toBe(2);
    expect(reprintBtns()).toHaveLength(1);
  });

  it("A8 — past-session export title is 'Past session · {range}'; current export title unchanged", async () => {
    renderWith();
    fireEvent.click(q("orders-export")!);
    await act(async () => { fireEvent.click(q("orders-export-xlsx")!); });
    expect((exported.last as unknown as { title: string }).title).toBe("Orders");
    await pickSession(0);
    fireEvent.click(q("orders-export")!);
    await act(async () => { fireEvent.click(q("orders-export-pdf")!); });
    expect((exported.last as unknown as { title: string }).title).toBe("Past session · 10/08 → 10/10");
  });

  it("A11 — past mode draws 150 rows + Show more; search / Export use every row", async () => {
    S.bySession.old = Array.from({ length: 320 }, (_, i) => ({ ...row("old", "2026-10-09", i + 1, `@h${i}`, `Buyer${i}`, `ITEM${i}`, 10), created_at: new Date(Date.UTC(2026, 9, 9, 5, 0, i)).toISOString() }));
    const r = renderWith();
    await pickSession(0);
    expect(rowsDrawn()).toBe(150);
    expect(q("ord-past-more")!.textContent).toBe("Show more (150 of 170 left)");
    fireEvent.click(q("orders-export")!);
    await act(async () => { fireEvent.click(q("orders-export-xlsx")!); });
    expect(exported.last!.rows).toHaveLength(320);
    fireEvent.click(q("ord-past-more")!);
    expect(rowsDrawn()).toBe(300);
    fireEvent.click(q("ord-past-more")!);
    expect(rowsDrawn()).toBe(320);
    expect(q("ord-past-more")).toBeNull();
    fireEvent.click(q("ord-range")!);                    // another session resets the page
    await settle();
    fireEvent.click(qa("ord-session-item")[0]);
    await settle();
    expect(rowsDrawn()).toBe(150);
    fireEvent.change(r.container.querySelectorAll("input")[0], { target: { value: "ITEM5" } }); // the oldest row (ITEM5) is beyond the first 150
    expect(r.container.textContent).toContain("ITEM5");
  }, 20_000); // renders 320 rows several times — ~1.3 s alone, can pass 5 s under full-suite load

  it("A11 — the current session is not capped", () => {
    const many = Array.from({ length: 160 }, (_, i) => ({ ...todayOrder, id: `#${i}`, orderNum: ON + i })) as Order[];
    render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={many} state="live" buyers={[ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" /></TProvider>);
    expect(rowsDrawn()).toBe(160);
    expect(q("ord-past-more")).toBeNull();
  });

  it("A9 — tiktokSend turning on after Today was picked → back to This session", () => {
    const view = (on: boolean) => <TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={[ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend={on} sellerId="me" /></TProvider>;
    const r = render(view(false));
    fireEvent.click(q("ord-range")!);
    fireEvent.click(q("ord-range-today")!);
    expect(q("ord-range")!.textContent).toBe("🗓 Today ▾");
    r.rerender(view(true));
    expect(q("ord-range")!.textContent).toBe("🗓 This session ▾");
  });

  it("A13 — no 'Print slip' tooltip on past rows (current rows keep it)", async () => {
    renderWith();
    expect(document.querySelector("[title='Print slip']")).not.toBeNull();
    await pickSession(0);
    expect(document.querySelector("[title='Print slip']")).toBeNull();
  });
});

describe("12 — fix round 4: past rows show their own date + time", () => {
  it("past rows: '10/08 · 1:00 PM' (Taipei), no 'ago'; current rows unchanged", async () => {
    S.bySession.old = [row("old", "2026-10-08", 1, "@a", "A", "P1", 10)]; // created 05:00Z = 1:00 PM Taipei
    const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="empty" buyers={[ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" /></TProvider>);
    expect(r.container.textContent).toContain("13:00 ago");          // current session, state not live: unchanged
    await pickSession(0);
    expect(r.container.textContent).toContain("10/08 · 1:00 PM");
    expect(r.container.textContent).not.toContain("ago");
    const late = { ...row("old", "2026-10-08", 2, "@b", "B", "P2", 10), created_at: "2026-10-08T16:05:00.000Z" };
    S.bySession.old = [late];
    fireEvent.click(q("ord-range")!);
    await settle();
    fireEvent.click(qa("ord-session-item")[0]);
    await settle();
    expect(r.container.textContent).toContain("10/09 · 12:05 AM");   // its own Taipei day
  });
});
