// Orders — after a Reprint tap the buttons rest for 2 seconds ("Printing…"). That 2 s timer is
// stopped when the screen closes (the same fix as Pickup Status, CI run 1843); while the screen is
// open the rest is exactly as before. Both places that start it are covered: a Reprint in the
// running session, and the "reprint from an old session?" confirm.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const S = vi.hoisted(() => ({ bySession: {} as Record<string, unknown[]>, summaries: [] as unknown[] }));
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
  supabase: { from: () => builder(), rpc: async () => ({ data: S.summaries, error: null }), auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }) } },
}));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import type { Order } from "../../data";
import { expectNothingLate, tick, until } from "../../adapters/__tests__/pageGone";

const ON = Date.UTC(2026, 9, 14, 5);
const order = (over: Partial<Order>): Order => ({
  id: "#7", buyer: "Yu Shan", handle: "@yushan_tw", items: "tumbler B", qty: 1, total: 350, status: "New",
  platform: "TikTok", time: "1:24:49 PM", orderNum: ON, date: "2026-10-14", ...over,
} as Order);
const ORDERS = [order({}), order({ id: "#8", buyer: "Mei Lin", handle: "@meidolltw", items: "dress D", orderNum: ON + 1 })];
const storedRow = (id: number, n: number, handle: string, name: string) =>
  ({ id, session_id: "old", session_date: "2026-10-09", created_at: "2026-10-09T05:00:00.000Z", buyer_number: n, handle, customer_name: name, platform: "TikTok", product: "OLD-ITEM", price: 150, qty: 1, comment_msg_id: null, auto_code: null });

const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const reprintButtons = () => Array.from(document.querySelectorAll("[aria-label='Reprint']")) as HTMLButtonElement[];
const view = (extra: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={ORDERS} state="live" todayId="2026-10-14" sessionId="cur" sellerId="me" tiktokSend {...extra} /></TProvider>);
/** Open the first past session of the list. */
async function openOldSession() {
  const items = () => Array.from(document.querySelectorAll("[data-testid='ord-session-item']")) as HTMLElement[];
  fireEvent.click(q("ord-range")!);
  await until(() => items().length > 0);
  fireEvent.click(items()[0]);
  await until(() => reprintButtons().length === 2 && document.body.textContent?.includes("OLD-ITEM"));
}

beforeEach(() => {
  vi.useFakeTimers();   // the clock moves only when a test moves it
  localStorage.clear();
  S.summaries = [{ session_id: "old", first_day: "2026-10-09", last_day: "2026-10-09", orders: 2, latest: "2026-10-09T05:00:00.000Z" }];
  S.bySession = { old: [storedRow(501, 3, "@ann", "Ann"), storedRow(502, 4, "@bea", "Bea")] };
});
afterEach(() => { vi.useRealTimers(); });

describe("Orders — the screen is closed right after a Reprint", () => {
  it("running session: no timer is left and nothing updates late", async () => {
    const onReprintOrder = vi.fn();
    const r = view({ onReprintOrder });
    fireEvent.click(reprintButtons()[0]);
    expect(onReprintOrder).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);   // the 2 s rest
    r.unmount();
    expectNothingLate();
  });
  it("old session, after the confirm: no timer is left and nothing updates late", async () => {
    const onReprintRow = vi.fn();
    const r = view({ onReprintRow });
    await openOldSession();
    fireEvent.click(reprintButtons()[0]);
    fireEvent.click(q("reprint-old-ok")!);
    expect(onReprintRow).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);   // the 2 s rest
    r.unmount();
    expectNothingLate();
  });
  it("old session, second Reprint (no confirm any more): no timer is left and nothing updates late", async () => {
    const onReprintRow = vi.fn();
    const r = view({ onReprintRow });
    await openOldSession();
    fireEvent.click(reprintButtons()[0]);
    fireEvent.click(q("reprint-old-ok")!);
    await tick(2000);
    fireEvent.click(reprintButtons()[1]);
    expect(onReprintRow).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    r.unmount();
    expectNothingLate();
  });
});

describe("Orders — while the screen is open nothing changed", () => {
  it("running session: every Reprint button rests 2 seconds, a second tap prints nothing, then they work again", async () => {
    const onReprintOrder = vi.fn();
    view({ onReprintOrder });
    const [first, second] = reprintButtons();
    fireEvent.click(first);
    expect(onReprintOrder).toHaveBeenCalledTimes(1);
    expect(first.textContent).toContain("Printing");
    expect(reprintButtons().map((b) => b.disabled)).toEqual([true, true]);
    fireEvent.click(second);
    await tick(1999);
    fireEvent.click(reprintButtons()[1]);
    expect(onReprintOrder).toHaveBeenCalledTimes(1);
    expect(reprintButtons().map((b) => b.disabled)).toEqual([true, true]);
    await tick(1);
    expect(reprintButtons().map((b) => b.disabled)).toEqual([false, false]);
    expect(reprintButtons()[0].textContent).not.toContain("Printing");
    fireEvent.click(reprintButtons()[1]);
    expect(onReprintOrder).toHaveBeenCalledTimes(2);
  });
  it("old session: the confirm prints once, the buttons rest 2 seconds, then work again", async () => {
    const onReprintRow = vi.fn();
    view({ onReprintRow });
    await openOldSession();
    fireEvent.click(reprintButtons()[0]);
    expect(onReprintRow).not.toHaveBeenCalled(); // the question comes first
    fireEvent.click(q("reprint-old-ok")!);
    expect(onReprintRow).toHaveBeenCalledTimes(1);
    expect(reprintButtons().map((b) => b.disabled)).toEqual([true, true]);
    await tick(1999);
    expect(reprintButtons().map((b) => b.disabled)).toEqual([true, true]);
    await tick(1);
    expect(reprintButtons().map((b) => b.disabled)).toEqual([false, false]);
  });
});
