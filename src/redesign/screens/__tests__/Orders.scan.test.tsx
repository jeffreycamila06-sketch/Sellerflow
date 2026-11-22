// Orders — the new Scan button next to the search box (2026-11-22). A sticker QR → "@username" in the box
// WITHOUT the 7-day history load → that TikTok buyer's card for the session open here (all items + total).
// Strict parser (a TikTok profile link or @name). No buyer → "No orders for @username in this session".
// A past session still loading → wait. Typing afterwards = the normal search again.
// Laptop / older app → the photo picker + today's reader; a new app build → the live scanner.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { Order } from "../../data";
import type { Buyer, LiveOrder } from "../../../lib/orderTypes";
import { setNativeQrScannerOn } from "../../adapters/nativeQrScanner";

const m = vi.hoisted(() => ({
  decode: vi.fn(async (_f: File): Promise<string | null | string[]> => null),
  past: { current: null as null | Record<string, unknown> },
}));
vi.mock("../../adapters/qrDecode", async () => (await import("./qrReaderMock")).qrReaderModule((f: File) => m.decode(f)));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
vi.mock("../../adapters/pastSessions", async (orig) => {
  const actual = await orig<typeof import("../../adapters/pastSessions")>();
  return { ...actual, usePastSessions: (enabled: boolean, sid: string | null) => (m.past.current ?? actual.usePastSessions(enabled, sid)) };
});

import Orders from "../Orders";

const order = (over: Partial<Order>): Order => ({
  id: "#23", buyer: "Mei Lin", handle: "@meidolltw", items: "korean dress D", qty: 1,
  total: 899, status: "New", platform: "TikTok", time: "1:24:49 PM", orderNum: 111, date: "2026-11-22", ...over,
});
const lo = (bNum: number, handle: string, item: string, total: number, platform = "TikTok"): LiveOrder => ({
  orderNum: 1_700_000_000_000 + bNum * 10 + total, item, qty: 1, price: total, total, time: "1:00 PM", handle, name: handle, bNum, platform, status: "New", date: "2026-11-22",
});
const buyer = (num: number, handle: string, name: string, lines: [string, number][], platform = "TikTok"): Buyer => {
  const orders = lines.map(([item, total]) => lo(num, handle, item, total, platform));
  return { handle, name, platform, num, orders, totalSpent: lines.reduce((s, [, t]) => s + t, 0), totalOrders: orders.length };
};
const BUYERS: Buyer[] = [
  buyer(23, "@meidolltw", "Mei Lin", [["korean dress D", 899], ["150", 150]]),
  buyer(7, "@yushan_tw", "Yu Shan", [["tumbler B", 350]]),
  buyer(9, "Ana Reyes", "Ana Reyes", [["200", 200]], "Facebook"),
];
const ORDERS_ = [order({}), order({ id: "#7", buyer: "Yu Shan", handle: "@yushan_tw", items: "tumbler B", total: 350, orderNum: 222 })];
const HISTORY = [order({ id: "#4", buyer: "Ben Wu", handle: "@benwu", items: "korean jacket", total: 1200, orderNum: 333, date: "2026-11-18" })];

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const view = (over: Record<string, unknown> = {}) => {
  const onEnsureHistory = vi.fn();
  const r = render(
    <TProvider lang="en">
      <Orders onGoPrint={vi.fn()} cur="NT$" orders={ORDERS_} state="live" todayId="2026-11-22" buyers={BUYERS}
        historyOrders={HISTORY} historyState="live" onEnsureHistory={onEnsureHistory} onReprintOrder={vi.fn()} {...over} />
    </TProvider>,
  );
  return { ...r, onEnsureHistory };
};
const search = (c: HTMLElement) => c.querySelector("input") as HTMLInputElement;
const scanPhoto = async (r: ReturnType<typeof view>, qr: string | null | string[]) => {
  m.decode.mockResolvedValue(qr);
  fireEvent.click(r.getByTestId("ord-scan"));
  fireEvent.change(r.getByTestId("ord-scan-file"), { target: { files: [new File(["x"], "s.jpg", { type: "image/jpeg" })] } });
  await flush();
};

type W = { Capacitor?: unknown };
let fileClicks: ReturnType<typeof vi.spyOn>;
beforeEach(() => { m.decode.mockReset(); m.decode.mockResolvedValue(null); m.past.current = null; fileClicks = vi.spyOn(HTMLInputElement.prototype, "click"); });
afterEach(() => { cleanup(); fileClicks.mockRestore(); setNativeQrScannerOn(false); delete (window as unknown as W).Capacitor; });

describe("Orders Scan — photo flow (laptop / older app)", () => {
  it("the Scan button sits in the search row and opens the photo picker", () => {
    const r = view();
    const btn = r.getByTestId("ord-scan");
    expect(btn.textContent).toContain("Scan");
    expect(btn.parentElement).toBe(search(r.container).parentElement);
    fireEvent.click(btn);
    expect(fileClicks.mock.contexts.some((el) => (el as HTMLElement).dataset?.testid === "ord-scan-file")).toBe(true);
  });
  it("a sticker link → @username in the box, the buyer's card (all items + total), no 7-day load", async () => {
    const r = view();
    await scanPhoto(r, "https://tiktok.com/@MeiDollTW");
    expect(search(r.container).value).toBe("@MeiDollTW");
    const card = r.getByTestId("buyer-receipt");
    expect(card.textContent).toContain("#23");
    expect(card.textContent).toContain("korean dress D");
    expect(card.textContent).toContain("150");
    expect(card.textContent).toContain("NT$1,049");
    expect(r.onEnsureHistory).not.toHaveBeenCalled();
    expect(r.container.textContent).not.toContain("Ben Wu");
  });
  it("no buyer with that username in this session → the message, no history rows", async () => {
    const r = view();
    await scanPhoto(r, "https://tiktok.com/@benwu");
    expect(r.getByTestId("ord-scan-none").textContent).toBe("No orders for @benwu in this session");
    expect(r.container.textContent).not.toContain("Ben Wu");
    expect(r.queryByTestId("buyer-receipt")).toBeNull();
    expect(r.onEnsureHistory).not.toHaveBeenCalled();
  });
  it("a Facebook buyer with the same name never matches (TikTok only)", async () => {
    const r = view();
    await scanPhoto(r, "@Ana");
    expect(r.getByTestId("ord-scan-none")).toBeTruthy();
  });
  it("strict parser: a QR that is not a TikTok link or @name → 'This QR has no buyer', box unchanged", async () => {
    const r = view();
    fireEvent.change(search(r.container), { target: { value: "dress" } });
    await scanPhoto(r, "meidolltw");
    expect(r.getByTestId("ord-scan-toast").textContent).toContain("This QR has no buyer");
    expect(search(r.container).value).toBe("dress");
  });
  it("2 stickers in the photo / no QR → today's messages", async () => {
    const r = view();
    await scanPhoto(r, ["https://tiktok.com/@a", "https://tiktok.com/@b"]);
    expect(r.getByTestId("ord-scan-toast").textContent).toContain("2 stickers in the photo");
    await scanPhoto(r, null);
    expect(r.getByTestId("ord-scan-toast").textContent).toContain("No QR found");
  });
  it("typing afterwards = the normal search (rows, the history load)", async () => {
    const r = view();
    await scanPhoto(r, "https://tiktok.com/@meidolltw");
    expect(r.getByTestId("buyer-receipt")).toBeTruthy();
    fireEvent.change(search(r.container), { target: { value: "@meidolltw " } });
    expect(r.queryByTestId("buyer-receipt")).toBeNull();
    expect(r.onEnsureHistory).toHaveBeenCalled();
    expect(r.container.textContent).toContain("Mei Lin");
  });
  it("two buyers with the same name in different capitals → the usual chooser, then the card", async () => {
    const twins = [...BUYERS, buyer(31, "@MeiDollTW", "Mei 2", [["300", 300]])];
    const r = view({ buyers: twins });
    await scanPhoto(r, "https://tiktok.com/@meidolltw");
    const ch = r.getByTestId("dup-chooser");
    expect(ch.textContent).toContain("2 buyers have @meidolltw — pick one");
    fireEvent.click(r.getAllByTestId("dup-option")[1]);
    expect(r.getByTestId("buyer-receipt").textContent).toContain("#31");
    expect(r.getByTestId("dup-back").textContent).toContain("2 buyers have @meidolltw");
  });
  it("this session still loading → wait instead of 'no orders'", async () => {
    const r = view({ state: "loading", buyers: [] });
    await scanPhoto(r, "https://tiktok.com/@meidolltw");
    expect(r.getByTestId("ord-scan-wait")).toBeTruthy();
    expect(r.queryByTestId("ord-scan-none")).toBeNull();
  });
});

describe("Orders Scan — a picked past session", () => {
  const past = (buyersState: string, buyers: Buyer[]) => ({
    list: [], listState: "ready", ensureList: vi.fn(), rowFor: () => null, pick: vi.fn(async () => {}),
    selected: { id: "s-old", first: "2026-11-01", last: "2026-11-02", days: 2, orders: 3, latest: "2026-11-02T10:00:00Z", current: false },
    buyers, orders: [], buyersState,
  });
  it("still loading → wait; then the card from THAT session's buyers", async () => {
    m.past.current = past("loading", []);
    const r = view({ pastSessions: true, sessionId: "s-now" });
    await scanPhoto(r, "https://tiktok.com/@oldbuyer");
    expect(r.getByTestId("ord-scan-wait").textContent).toContain("Loading");
    expect(r.queryByTestId("ord-scan-none")).toBeNull();
    m.past.current = past("ready", [buyer(5, "@oldbuyer", "Old Buyer", [["500", 500]])]);
    r.rerender(
      <TProvider lang="en">
        <Orders onGoPrint={vi.fn()} cur="NT$" orders={ORDERS_} state="live" todayId="2026-11-22" buyers={BUYERS}
          historyOrders={HISTORY} historyState="live" onEnsureHistory={r.onEnsureHistory} onReprintOrder={vi.fn()} pastSessions sessionId="s-now" />
      </TProvider>,
    );
    const card = r.getByTestId("buyer-receipt");
    expect(card.textContent).toContain("#5");
    expect(card.textContent).toContain("NT$500");
  });
  it("ready and no such buyer → the message", async () => {
    m.past.current = past("ready", [buyer(5, "@oldbuyer", "Old Buyer", [["500", 500]])]);
    const r = view({ pastSessions: true, sessionId: "s-now" });
    await scanPhoto(r, "@someoneelse");
    expect(r.getByTestId("ord-scan-none").textContent).toBe("No orders for @someoneelse in this session");
  });
});

describe("Orders Scan — new app build (live scanner)", () => {
  it("the live read fills the box and shows the card; no photo picker", async () => {
    const scanStickerQr = vi.fn(async () => ({ status: "read", text: "https://tiktok.com/@yushan_tw" }));
    (window as unknown as W).Capacitor = { Plugins: { SellerFlowScanner: { scanStickerQr } } };
    setNativeQrScannerOn(true);
    const r = view();
    fireEvent.click(r.getByTestId("ord-scan"));
    await flush();
    expect(scanStickerQr).toHaveBeenCalledTimes(1);
    expect(fileClicks.mock.contexts.some((el) => (el as HTMLElement).dataset?.testid === "ord-scan-file")).toBe(false);
    expect(search(r.container).value).toBe("@yushan_tw");
    expect(r.getByTestId("buyer-receipt").textContent).toContain("#7");
    expect(m.decode).not.toHaveBeenCalled();
  });
});
