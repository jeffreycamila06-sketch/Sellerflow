// FACEBOOK POST SALES — client. Pins: Orders shows NO Live|Posts segment and nothing new without
// the `posts` prop (every seller without a Facebook Page = the screen exactly as before); with it:
// the segment, Live default, the red dot until Posts is opened once, the empty state with ONE
// button, buyer cards + Print new / My posts; the gate; grouping; the print Buyer (no buyer number,
// "Post" on every line, buyer-number setting OFF); sale status / counts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider, REDESIGN_STRINGS } from "../../i18n";
import Orders from "../../screens/Orders";
import type { PostsUi } from "../../screens/PostSales";
import {
  postSalesGate, groupPostOrders, postBuyerForPrint, postPrintSettings, saleStatus, saleCounts, mapSale, mapOrder, LS_POSTS_SEEN, postItemStock,
  type PostSale, type PostOrder,
} from "../fbPostSales";
import { DEF_SETTINGS } from "../printing";
import { groupWaitlist, type WaitlistRow } from "../fbWaitlist";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sale = (o: Partial<PostSale> = {}): PostSale => ({
  id: 1, pageId: "P1", postId: "P1_777", postMessage: "Weekend sale! Comment the code", postPicture: null, mode: "code",
  startsAt: "2026-10-27T01:00:00Z", endsAt: "2026-11-03T01:00:00Z", status: "selling", createdAt: "2026-10-27T01:00:00Z",
  items: [{ id: 11, saleId: 1, productId: null, name: "Red dress", code: "A", price: 350, stock: 2, sold: 0 }, { id: 12, saleId: 1, productId: null, name: "Blue top", code: "B", price: 200, stock: null, sold: 1 }],
  ...o,
});
const order = (o: Partial<PostOrder> = {}): PostOrder => ({ id: 1, saleId: 1, itemId: 11, buyerFbId: "B1", buyerName: "Ana Cruz", qty: 1, price: 350, commentId: "c1", commentText: "A", createdAt: "2026-10-27T02:00:00Z", printedAt: null, ...o });
const ui = (o: Partial<PostsUi> = {}): PostsUi => ({
  state: "ready", sales: [sale()], orders: [], waitlistCounts: new Map(), pages: [{ pageId: "P1", name: "My Shop" }], products: [], busy: false, note: null,
  onReload: vi.fn(), onPrintNew: vi.fn(), onCreate: vi.fn(async () => ({ ok: true as const, id: 2 })), onEnd: vi.fn(async () => true), onUpdateItem: vi.fn(async () => true),
  loadPosts: vi.fn(async () => ({ ok: true as const, posts: [] })), ...o,
});
const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><Orders onGoPrint={() => {}} cur="NT$" orders={[]} state="live" todayId="2026-10-27" buyers={[]} {...extra} /></TProvider>);

beforeEach(() => { window.localStorage.clear(); });

describe("Orders without a Facebook Page = exactly as before", () => {
  it("no posts prop → no segment, no Posts body, no dot", () => {
    const { container } = view();
    expect(screen.queryByTestId("ord-live-posts")).toBeNull();
    expect(screen.queryByTestId("posts-body")).toBeNull();
    expect(container.innerHTML).not.toContain("Posts");
  });
  it("gate: switch + (admin or key) + a connected Page — ONE place", () => {
    expect(postSalesGate({ switchOn: true, isAdmin: true, hasKey: false, pageCount: 1 })).toBe(true);
    expect(postSalesGate({ switchOn: true, isAdmin: false, hasKey: true, pageCount: 1 })).toBe(true);
    expect(postSalesGate({ switchOn: true, isAdmin: true, hasKey: true, pageCount: 0 })).toBe(false); // no Page → nothing
    expect(postSalesGate({ switchOn: false, isAdmin: true, hasKey: true, pageCount: 1 })).toBe(false); // switch off → nothing
    expect(postSalesGate({ switchOn: true, isAdmin: false, hasKey: false, pageCount: 1 })).toBe(false);
  });
});

describe("Orders with the posts prop", () => {
  it("Live | Posts segment, Live default, red dot until Posts opened once (remembered per device)", () => {
    view({ posts: ui() });
    expect(screen.getByTestId("ord-seg-live").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("ord-posts-dot")).toBeTruthy();
    expect(screen.queryByTestId("posts-body")).toBeNull();
    fireEvent.click(screen.getByTestId("ord-seg-posts"));
    expect(screen.getByTestId("posts-body")).toBeTruthy();
    expect(screen.queryByTestId("ord-posts-dot")).toBeNull();
    expect(window.localStorage.getItem(LS_POSTS_SEEN)).toBe("1");
    expect(screen.queryByTestId("ord-chips")).toBeNull(); // the live filters are gone while Posts shows
    fireEvent.click(screen.getByTestId("ord-seg-live"));
    expect(screen.getByTestId("ord-chips")).toBeTruthy();
  });
  it("empty state (preview B) = tile + title + one line + ONE button", () => {
    view({ posts: ui({ sales: [] }) });
    fireEvent.click(screen.getByTestId("ord-seg-posts"));
    const empty = screen.getByTestId("posts-empty");
    expect(empty.textContent).toContain("Sell from your Facebook posts");
    expect(empty.textContent).toContain("even when you're not live");
    expect(screen.getByTestId("posts-sell-btn").textContent).toBe("+ Sell on a post");
    expect(empty.querySelectorAll("button")).toHaveLength(1);
  });
  it("with orders: Print new (N) + My posts, one card per buyer, New/Printed pill, total", () => {
    const orders = [order(), order({ id: 2, itemId: 12, price: 200, commentId: "c2", createdAt: "2026-10-27T02:05:00Z" }), order({ id: 3, buyerFbId: "B2", buyerName: "Ben", commentId: "c3", printedAt: "2026-10-27T03:00:00Z" })];
    const u = ui({ orders });
    view({ posts: u });
    fireEvent.click(screen.getByTestId("ord-seg-posts"));
    expect(screen.getByTestId("ord-seg-posts").textContent).toContain("Posts · 3"); // the count on the tab (preview C)
    expect(screen.getByTestId("posts-print-new").textContent).toContain("Print new (1)"); // = new BUYERS (Ana), not orders
    const cards = screen.getAllByTestId("posts-buyer-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("AC");                        // round initials avatar
    expect(cards[0].textContent).toContain("Ana Cruz");
    expect(cards[0].textContent).toContain("Weekend sale! Comment the code"); // which post(s)
    expect(cards[0].textContent).toContain("A Red dress");                // code-prefixed line
    expect(cards[0].textContent).toContain("NT$550");
    expect(screen.getAllByTestId("posts-pill").map((p) => p.textContent)).toEqual(["New", "Printed"]);
    fireEvent.click(screen.getByTestId("posts-print-new"));
    expect(u.onPrintNew).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("posts-my-btn"));
    expect(screen.getByTestId("my-posts")).toBeTruthy();
    expect(screen.getByTestId("my-post-status").textContent).toBe("● Selling");
    const my = screen.getByTestId("my-post-card");
    expect(my.textContent).toContain("Ends Nov 3 · 2 items");
    expect(my.textContent).toMatch(/3\s*orders.*2\s*buyers.*0\s*waitlist/);
    expect(screen.queryByTestId("my-post-detail")).toBeNull();           // collapsed = the preview card
    fireEvent.click(screen.getByTestId("my-post-toggle"));
    expect(screen.getByTestId("my-post-detail")).toBeTruthy();           // items + Edit + End now
    expect(screen.getByTestId("my-post-end")).toBeTruthy();
  });
  it("Sell on a post (preview ②): one form — pick the post, mode, items table, Start selling → onCreate", async () => {
    const u = ui({ sales: [], loadPosts: vi.fn(async () => ({ ok: true as const, posts: [{ id: "P1_9", message: "New arrivals", createdTime: "2026-10-26T10:00:00Z", picture: "", url: "" }] })) });
    view({ posts: u });
    fireEvent.click(screen.getByTestId("ord-seg-posts"));
    fireEvent.click(screen.getByTestId("posts-sell-btn"));
    expect(await screen.findByTestId("sell-post-row")).toBeTruthy();
    const start = screen.getByTestId("sell-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("sell-post-row"));
    expect(screen.getByTestId("sell-mode-code").getAttribute("aria-checked")).toBe("true"); // default
    fireEvent.change(screen.getByTestId("sell-item-name"), { target: { value: "Red dress" } });
    fireEvent.change(screen.getByTestId("sell-item-code"), { target: { value: "a" } });
    fireEvent.change(screen.getByTestId("sell-item-price"), { target: { value: "350" } });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await vi.waitFor(() => expect(u.onCreate).toHaveBeenCalledTimes(1));
    expect(u.onCreate).toHaveBeenCalledWith(expect.objectContaining({ pageId: "P1", postId: "P1_9", mode: "code", items: [expect.objectContaining({ name: "Red dress", code: "A", price: 350, stock: null })] }));
  });
});

describe("pure", () => {
  it("groups per buyer, newest first; posts listed; printed only when all printed", () => {
    const g = groupPostOrders([order(), order({ id: 2, buyerFbId: "B2", buyerName: "Ben", commentId: "c2", createdAt: "2026-10-27T03:00:00Z", printedAt: "x" }), order({ id: 3, commentId: "c3", printedAt: "x" })], [sale()]);
    expect(g.map((x) => [x.buyerName, x.orders.length, x.printed, x.total])).toEqual([["Ben", 1, true, 350], ["Ana Cruz", 2, false, 700]]);
    expect(g[1].orders.map((o) => o.id)).toEqual([1, 3]); // lines inside a card: oldest first
    expect(g[1].posts).toEqual(["Weekend sale! Comment the code"]);
  });
  it("print Buyer: no buyer number, Post on every line, Facebook platform, new orders only", () => {
    const g = groupPostOrders([order(), order({ id: 2, itemId: 12, price: 200, qty: 2, commentId: "c2" }), order({ id: 3, commentId: "c3", printedAt: "x" })], [sale()])[0];
    const b = postBuyerForPrint(g, [sale()])!;
    expect(b.num).toBe(0);
    expect(b.platform).toBe("Facebook");
    expect(b.name).toBe("Ana Cruz");
    expect(b.orders.map((o) => o.item)).toEqual(["Post · Red dress", "Post · Blue top ×2"]);
    expect(b.orders.map((o) => o.total)).toEqual([350, 400]);
    expect(b.orders.every((o) => o.bNum === 0 && o.orderNum > 1e12)).toBe(true);
    expect(postBuyerForPrint({ ...g, orders: g.orders.filter((o) => o.printedAt) }, [sale()])).toBeNull();
    expect(postPrintSettings(DEF_SETTINGS).printBuyerNumber).toBe(false);
    expect(DEF_SETTINGS.printBuyerNumber).toBe(true); // the caller's settings object untouched
  });
  it("sale status + counts", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    expect(saleStatus(sale(), now)).toBe("selling");
    expect(saleStatus(sale({ status: "ended" }), now)).toBe("ended");
    expect(saleStatus(sale({ endsAt: "2026-10-27T00:00:00Z" }), now)).toBe("ended");
    expect(saleStatus(sale({ items: [{ id: 11, saleId: 1, productId: null, name: "x", code: "A", price: 1, stock: 2, sold: 2 }] }), now)).toBe("sold_out");
    expect(saleCounts(sale(), [order(), order({ id: 2, buyerFbId: "", commentId: "anon" })], new Map([[1, 3]]))).toEqual({ orders: 2, buyers: 2, waitlist: 3 });
  });
  it("row mappers are defensive", () => {
    expect(mapSale({ id: "5", mode: "weird", status: "x", items: null }).mode).toBe("code");
    expect(mapOrder({ id: 1, qty: "3", printed_at: null })).toMatchObject({ qty: 3, printedAt: null });
  });
  it("waitlist: post rows group apart from live rows of the same code; Give routes to the post RPC, never the live order path", () => {
    const wl = (o: Partial<WaitlistRow>): WaitlistRow => ({ id: 1, sessionId: null, code: "A", productLocalId: null, commentId: "c1", pageId: "P1", liveVideoId: null, commenterId: "B1", commenterName: "Ana", handle: "Ana", createdAt: "2026-10-27T02:00:00Z", status: "waiting", source: "live", ...o });
    const g = groupWaitlist([wl({ id: 1 }), wl({ id: 2, commentId: "c2", source: "post" }), wl({ id: 3, commentId: "c3", code: "a", source: "post" })]);
    expect(g.map((x) => [x.code, x.source, x.rows.map((r) => r.id)])).toEqual([["A", "live", [1]], ["A", "post", [2, 3]]]);
    expect(postItemStock([sale()], "a")).toBe(2);       // stock 2 − sold 0
    expect(postItemStock([sale()], "B")).toBe(1);       // no limit → giveable
    expect(postItemStock([sale({ status: "ended" })], "A")).toBe(0);
    const app = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
    const give = app.slice(app.indexOf("const onWaitlistGive = "), app.indexOf("const onWaitlistSkip = "));
    expect(give.indexOf('r.source === "post"')).toBeGreaterThan(-1);
    expect(give.indexOf("givePostWaitlist(r.id)")).toBeLessThan(give.indexOf("orders.createOrder("));
    expect(give.slice(give.indexOf('r.source === "post"'), give.indexOf("return;"))).not.toContain("createOrder"); // the post branch returns before the live path
  });
  it("every rd_fps_* key is filled in all 8 languages", () => {
    const keys = Object.keys(REDESIGN_STRINGS.en).filter((k) => k.startsWith("rd_fps_"));
    expect(keys.length).toBeGreaterThan(50);
    for (const lang of Object.keys(REDESIGN_STRINGS) as (keyof typeof REDESIGN_STRINGS)[]) for (const k of keys) expect(REDESIGN_STRINGS[lang][k], `${lang}.${k}`).toBeTruthy();
  });
});
