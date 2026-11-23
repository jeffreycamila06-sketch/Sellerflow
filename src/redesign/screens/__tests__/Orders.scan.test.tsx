// Orders — the new Scan button next to the search box (2026-11-22). A sticker QR → "@username" in the box
// WITHOUT the 7-day history load → that TikTok buyer's card for the session open here (all items + total).
// Strict parser (a TikTok profile link or @name). No buyer → "No orders for @username in this session".
// A past session still loading → wait. Typing afterwards = the normal search again.
// The button exists ONLY with the live scanner (the app build has it AND the switch is on: liveScan).
// Laptop / older app build / switch off → no Scan button: today's Orders. "Take a photo instead" in the
// scanner → today's reader (readQrFromFile, faked here by qrReaderMock).
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
        historyOrders={HISTORY} historyState="live" onEnsureHistory={onEnsureHistory} onReprintOrder={vi.fn()} liveScan {...over} />
    </TProvider>,
  );
  return { ...r, onEnsureHistory };
};
const search = (c: HTMLElement) => c.querySelector("input") as HTMLInputElement;
// The phone's scanner answer: a string = the live read of that QR; null / a list = "Take a photo instead"
// with a photo that the reader finds no QR / that many stickers in.
const scanAnswer = vi.fn(async (_o: unknown): Promise<unknown> => ({ status: "cancelled" }));
const scan = async (r: ReturnType<typeof view>, qr: string | null | string[] | { status: string; [k: string]: unknown }) => {
  if (typeof qr === "string") scanAnswer.mockResolvedValueOnce({ status: "read", text: qr });
  else if (qr === null || Array.isArray(qr)) { m.decode.mockResolvedValue(qr as string[] | null); scanAnswer.mockResolvedValueOnce({ status: "photo", data: btoa("jpeg"), mime: "image/jpeg" }); }
  else scanAnswer.mockResolvedValueOnce(qr);
  fireEvent.click(r.getByTestId("ord-scan"));
  await flush();
};

type W = { Capacitor?: unknown };
let fileClicks: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.decode.mockReset(); m.decode.mockResolvedValue(null); m.past.current = null; fileClicks = vi.spyOn(HTMLInputElement.prototype, "click");
  scanAnswer.mockReset(); scanAnswer.mockResolvedValue({ status: "cancelled" });
  (window as unknown as W).Capacitor = { Plugins: { SellerFlowScanner: { scanStickerQr: scanAnswer } } };
  setNativeQrScannerOn(true);
});
afterEach(() => { cleanup(); fileClicks.mockRestore(); setNativeQrScannerOn(false); delete (window as unknown as W).Capacitor; });

describe("Orders Scan — no live scanner = no Scan button (today's Orders)", () => {
  it("laptop / older app build / switch off (liveScan false or absent) → no Scan button, no file picker", () => {
    for (const over of [{ liveScan: false }, { liveScan: undefined }]) {
      const r = view(over);
      expect(r.queryByTestId("ord-scan")).toBeNull();
      expect(r.queryByTestId("ord-scan-file")).toBeNull();
      expect(r.container.querySelector(".sfl-tap44-up")).toBeNull();
      expect(search(r.container).parentElement!.querySelectorAll("button").length).toBe(0); // the search row = just the box
      cleanup();
    }
  });
  it("typing '@name' without a scan = the normal search (rows + the 7-day load), no scan card", () => {
    const r = view({ liveScan: false });
    fireEvent.change(search(r.container), { target: { value: "@meidolltw" } });
    expect(r.onEnsureHistory).toHaveBeenCalled();
    expect(r.queryByTestId("ord-scan-none")).toBeNull();
    expect(r.container.textContent).toContain("Mei Lin");
  });
});

describe("Orders Scan — live scanner (new app build, switch on)", () => {
  it("the Scan button sits in the search row and opens the scanner (never a file picker)", async () => {
    const r = view();
    const btn = r.getByTestId("ord-scan");
    expect(btn.textContent).toContain("Scan");
    expect(btn.parentElement).toBe(search(r.container).parentElement);
    // the row keeps today's height: a 26 px button pulled into the row's padding, the 44 px tap area from .sfl-tap44
    expect(btn.style.height).toBe("26px");
    expect(btn.style.boxSizing).toBe("border-box");
    expect(btn.style.margin).toBe("-5px -6px -5px 0px");
    expect(btn.style.minHeight).toBe("");
    expect(btn.className).toBe("sfl-tap44 sfl-tap44-up");
    expect(r.queryByTestId("ord-scan-file")).toBeNull();
    fireEvent.click(btn);
    await flush();
    expect(scanAnswer).toHaveBeenCalledTimes(1);
    expect(fileClicks).not.toHaveBeenCalled();
  });
  it("a sticker link → @username in the box, the buyer's card (all items + total), no 7-day load", async () => {
    const r = view();
    await scan(r, "https://tiktok.com/@MeiDollTW");
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
    await scan(r, "https://tiktok.com/@benwu");
    expect(r.getByTestId("ord-scan-none").textContent).toBe("No orders for @benwu in this session");
    expect(r.container.textContent).not.toContain("Ben Wu");
    expect(r.queryByTestId("buyer-receipt")).toBeNull();
    expect(r.onEnsureHistory).not.toHaveBeenCalled();
  });
  it("a Facebook buyer with the same name never matches (TikTok only)", async () => {
    const r = view();
    await scan(r, "@Ana");
    expect(r.getByTestId("ord-scan-none")).toBeTruthy();
  });
  it("a Facebook buyer whose name IS the scanned username still never matches", async () => {
    const r = view({ buyers: [...BUYERS, buyer(11, "anareyes", "Ana Reyes", [["300", 300]], "Facebook")] });
    await scan(r, "https://tiktok.com/@AnaReyes");
    expect(r.getByTestId("ord-scan-none").textContent).toBe("No orders for @AnaReyes in this session");
    expect(r.queryByTestId("buyer-receipt")).toBeNull();
  });
  it("strict parser: a QR that is not a TikTok link or @name → 'This QR has no buyer', box unchanged", async () => {
    const r = view();
    fireEvent.change(search(r.container), { target: { value: "dress" } });
    await scan(r, "meidolltw");
    expect(r.getByTestId("ord-scan-toast").textContent).toContain("This QR has no buyer");
    expect(search(r.container).value).toBe("dress");
  });
  it("2 stickers in the photo / no QR → today's messages", async () => {
    const r = view();
    await scan(r, ["https://tiktok.com/@a", "https://tiktok.com/@b"]);
    expect(r.getByTestId("ord-scan-toast").textContent).toContain("2 stickers in the photo");
    await scan(r, null);
    expect(r.getByTestId("ord-scan-toast").textContent).toContain("No QR found");
  });
  it("typing afterwards = the normal search (rows, the history load)", async () => {
    const r = view();
    await scan(r, "https://tiktok.com/@meidolltw");
    expect(r.getByTestId("buyer-receipt")).toBeTruthy();
    fireEvent.change(search(r.container), { target: { value: "@meidolltw " } });
    expect(r.queryByTestId("buyer-receipt")).toBeNull();
    expect(r.onEnsureHistory).toHaveBeenCalled();
    expect(r.container.textContent).toContain("Mei Lin");
  });
  it("two buyers with the same name in different capitals → the usual chooser, then the card", async () => {
    const twins = [...BUYERS, buyer(31, "@MeiDollTW", "Mei 2", [["300", 300]])];
    const r = view({ buyers: twins });
    await scan(r, "https://tiktok.com/@meidolltw");
    const ch = r.getByTestId("dup-chooser");
    expect(ch.textContent).toContain("2 buyers have @meidolltw — pick one");
    fireEvent.click(r.getAllByTestId("dup-option")[1]);
    expect(r.getByTestId("buyer-receipt").textContent).toContain("#31");
    expect(r.getByTestId("dup-back").textContent).toContain("2 buyers have @meidolltw");
  });
  it("the header count while the 2-buyer chooser shows = those buyers' orders together (2 + 1), then the picked one's", async () => {
    const twins = [...BUYERS, buyer(31, "@MeiDollTW", "Mei 2", [["300", 300]])];
    const r = view({ buyers: twins });
    expect(r.getByTestId("ord-badge").textContent).toContain("2"); // Today · 2 before the scan
    await scan(r, "https://tiktok.com/@meidolltw");
    expect(r.getByTestId("dup-chooser")).toBeTruthy();
    expect(r.getByTestId("ord-badge").textContent).toBe("3");
    fireEvent.click(r.getAllByTestId("dup-option")[1]);
    expect(r.getByTestId("ord-badge").textContent).toBe("1");
  });
  it("the header count with no buyer for the scanned name = 0", async () => {
    const r = view();
    await scan(r, "https://tiktok.com/@benwu");
    expect(r.getByTestId("ord-badge").textContent).toBe("0");
  });
  it("this session still loading → wait instead of 'no orders'", async () => {
    const r = view({ state: "loading", buyers: [] });
    await scan(r, "https://tiktok.com/@meidolltw");
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
    await scan(r, "https://tiktok.com/@oldbuyer");
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
    await scan(r, "@someoneelse");
    expect(r.getByTestId("ord-scan-none").textContent).toBe("No orders for @someoneelse in this session");
  });
});

describe("Orders Scan — what the scanner hands back", () => {
  it("a live read fills the box and shows the card; the photo reader is not used", async () => {
    const r = view();
    await scan(r, "https://tiktok.com/@yushan_tw");
    expect(search(r.container).value).toBe("@yushan_tw");
    expect(r.getByTestId("buyer-receipt").textContent).toContain("#7");
    expect(m.decode).not.toHaveBeenCalled();
  });
  it("a photo that can't be opened → today's 'No QR found'; cancelled → nothing", async () => {
    const r = view();
    await scan(r, { status: "error", code: "photo_unreadable" });
    expect(r.getByTestId("ord-scan-toast").textContent).toContain("No QR found");
    cleanup();
    const r2 = view();
    fireEvent.change(search(r2.container), { target: { value: "dress" } });
    await scan(r2, { status: "cancelled" });
    expect(r2.queryByTestId("ord-scan-toast")).toBeNull();
    expect(search(r2.container).value).toBe("dress");
  });
});
