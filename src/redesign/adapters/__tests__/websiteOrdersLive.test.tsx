// Seller Website audit 5 — website orders arrive by themselves while the app is open (Realtime on
// website_orders, own rows), are folded into one refresh per burst, and the channel is removed on
// sign-out / user change / feature off. The Website tab re-reads quietly (filter + open order kept).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { subscribeWebsiteOrders, WEBSITE_LIVE_DEBOUNCE_MS } from "../websiteOrdersLive";
import { TProvider } from "../../i18n";
import WebsiteOrders from "../../screens/WebsiteOrders";
import type { OrdersApi } from "../websiteEditorApi";
import type { WebsiteOrder } from "../websiteSeller";

afterEach(() => { vi.useRealTimers(); });
function fakeClient() {
  const handlers: (() => void)[] = [];
  const ch = { on: vi.fn((_t: string, _f: unknown, h: () => void) => { handlers.push(h); return ch; }), subscribe: vi.fn(() => ch) };
  return { client: { channel: vi.fn(() => ch), removeChannel: vi.fn() }, ch, emit: () => handlers.forEach((h) => h()) };
}
describe("subscribeWebsiteOrders", () => {
  it("one channel per seller, own rows only (user_id filter), all events on website_orders", () => {
    const f = fakeClient();
    subscribeWebsiteOrders(f.client, "u-1", vi.fn());
    expect(f.client.channel).toHaveBeenCalledWith("website-orders:u-1");
    expect(f.ch.on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "website_orders", filter: "user_id=eq.u-1" }, expect.any(Function));
    expect(f.ch.subscribe).toHaveBeenCalled();
  });
  it("a burst of changes → one callback; unsubscribe removes the channel and drops a pending callback", () => {
    vi.useFakeTimers();
    const f = fakeClient(); const cb = vi.fn();
    const off = subscribeWebsiteOrders(f.client, "u-1", cb);
    f.emit(); f.emit(); f.emit();
    vi.advanceTimersByTime(WEBSITE_LIVE_DEBOUNCE_MS);
    expect(cb).toHaveBeenCalledTimes(1);
    f.emit(); off();
    vi.advanceTimersByTime(WEBSITE_LIVE_DEBOUNCE_MS * 2);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(f.client.removeChannel).toHaveBeenCalledWith(f.ch);
  });
  it("RedesignApp: subscribed only when signed in AND the feature is on (the hook's cleanup unsubscribes otherwise)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("useWebsiteOrdersLive(authed && sellerWebsiteOn, authUserId, () => {");
    expect(src).toContain("<WebsiteOrders cur={cur} liveTick={webLiveTick}");
    const hook = readFileSync("src/redesign/adapters/websiteOrdersLive.ts", "utf8");
    expect(hook).toContain("if (!enabled || !userId || !supabase) return;");
    expect(hook).toContain("}, [enabled, userId]);");
  });
});

const O = (over: Partial<WebsiteOrder>): WebsiteOrder => ({
  id: "o1", orderNo: 12, token: "f".repeat(64), status: "awaiting_payment", paymentIssue: false, buyerName: "Maria", buyerPhone: "0912345678", buyerContact: null,
  delivery: "s711", storeId: "123456", storeName: "Xinyi", address: null, payment: "bank", items: [], subtotal: 100, shipFee: 60, total: 160, note: null, receiptPath: null,
  receiptAt: null, autoCancelAt: null, paidAt: null, shippedAt: null, cancelledAt: null, cancelReason: null, seenAt: "2026-11-15T00:00:00Z", createdAt: "2026-11-15T01:00:00Z", ...over,
});
describe("Website tab — a live change", () => {
  it("re-reads the list, keeps the chosen filter, reports the new count", async () => {
    let list = [O({})];
    const api: OrdersApi = { load: vi.fn(async () => list), blocked: vi.fn(async () => new Set<string>()), shopSub: vi.fn(async () => "s1"), receipt: vi.fn(async () => null), act: vi.fn(async () => ({ ok: false as const })) };
    const onNew = vi.fn();
    const ui = (tick: number) => <TProvider lang="en"><WebsiteOrders onToast={vi.fn()} api={api} onNewCount={onNew} liveTick={tick} /></TProvider>;
    const { rerender } = render(ui(0));
    await screen.findByTestId("wor-row");
    fireEvent.click(screen.getByTestId("wor-f-unpaid"));
    list = [O({ id: "o2", orderNo: 13, seenAt: null }), ...list];
    rerender(ui(1));
    await waitFor(() => expect(screen.getAllByTestId("wor-row")).toHaveLength(2));
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("wor-f-unpaid")).toHaveAttribute("aria-pressed", "true");
    expect(onNew).toHaveBeenLastCalledWith(1);
  });
});
