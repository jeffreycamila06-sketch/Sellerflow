// Seller Website v2 — item 7: saved items and "your orders" live on THIS device only (no account).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { parsePage, pagePath } from "../route";
import { addDeviceOrder, loadDeviceOrders, storeDeviceOrders, MAX_DEVICE_ORDERS } from "../saved";
import type { OrderApi } from "../orderApi";
import { DEMO_SHOP } from "./fixtures";

beforeEach(() => localStorage.clear());
const T = "f".repeat(64);

describe("routes + storage", () => {
  it("/saved and /orders", () => {
    expect([parsePage("saved"), parsePage("orders"), parsePage("saved/x")]).toEqual([{ page: "saved" }, { page: "orders" }, { page: "missing" }]);
    expect([pagePath("/s/x", { page: "saved" }), pagePath("", { page: "orders" })]).toEqual(["/s/x/saved", "/orders"]);
  });
  it("device orders: newest first, one per token, capped, junk dropped", () => {
    const a = { token: T, no: "W-0001", at: "2026-11-16T00:00:00Z", total: 100 };
    expect(addDeviceOrder([a], { ...a, total: 200 })).toEqual([{ ...a, total: 200 }]);
    expect(addDeviceOrder(Array.from({ length: MAX_DEVICE_ORDERS }, (_, i) => ({ ...a, token: String(i).padStart(32, "a") })), a)).toHaveLength(MAX_DEVICE_ORDERS);
    storeDeviceOrders("s", [a, { token: "bad", no: "x" } as never]);
    expect(loadDeviceOrders("s")).toEqual([a]);
  });
});

describe("pages", () => {
  it("saved page in the shop (preview data): hearts → header count → the page", () => {
    render(<ShopApp preview={DEMO_SHOP} />);
    fireEvent.click(within(screen.getAllByTestId("shop-item")[2]).getByTestId("card-heart"));
    expect(screen.getByTestId("shop-saved-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByTestId("shop-saved-btn"));
    const page = screen.getByTestId("saved-page");
    expect(within(page).getAllByTestId("shop-item")).toHaveLength(1);
    fireEvent.click(within(page).getByTestId("card-heart"));
    expect(screen.getByTestId("saved-empty")).toBeInTheDocument();
  });
  it("orders: empty first; after placing an order its link is on this device (Orders tab)", async () => {
    const api: OrderApi = { place: vi.fn(async () => ({ ok: true as const, orderNo: "W-0042", token: T, total: 410 })), load: vi.fn(async () => null), uploadReceipt: vi.fn() };
    // a real (non-preview) shop so the device is written to: give it the demo data through a loaded result
    const { unmount } = render(<ShopApp preview={DEMO_SHOP} startRoute={{ page: "orders" }} orderApi={api} />);
    expect(screen.getByTestId("orders-empty")).toBeInTheDocument();
    unmount();
    storeDeviceOrders("budgetukay", [{ token: T, no: "W-0042", at: "2026-11-16T00:00:00Z", total: 410 }]);
    expect(loadDeviceOrders("budgetukay")).toHaveLength(1);
  });
  it("the bottom bar has Home · Shop · Cart · Orders · Chat", () => {
    render(<ShopApp preview={DEMO_SHOP} />);
    expect(within(screen.getByTestId("shop-bottom-nav")).getAllByRole("button").map((b) => b.getAttribute("data-testid"))).toEqual(["bnav-home", "bnav-shop", "bnav-cart", "bnav-orders", "bnav-chat"]);
    fireEvent.click(screen.getByTestId("bnav-orders"));
    expect(screen.getByTestId("orders-page")).toBeInTheDocument();
    expect(screen.getByTestId("bnav-orders")).toHaveAttribute("aria-current", "page");
  });
});

describe("a real shop remembers on the device", () => {
  it("after placing: the order is listed under Orders", async () => {
    vi.resetModules();
    vi.doMock("../shopApi", async (orig) => {
      const m = await orig<typeof import("../shopApi")>();
      return { ...m, loadShop: vi.fn(async () => DEMO_SHOP) };
    });
    const { default: App } = await import("../ShopApp");
    localStorage.setItem("sfl_shop_cart_budgetukay", JSON.stringify([{ pid: 2, vid: null, qty: 1 }]));
    localStorage.setItem("sfl_shop_buyer", JSON.stringify({ name: "Maria", phone: "0912345678", contact: "", address: "", stores: { s711: [{ id: "123456", name: "Xinyi" }] } }));
    const api: OrderApi = { place: vi.fn(async () => ({ ok: true as const, orderNo: "W-0042", token: T, total: 340 })), load: vi.fn(async () => null), uploadReceipt: vi.fn() };
    render(<App host="www.sellerflowlive.com" path="/s/budgetukay/checkout" orderApi={api} />);
    fireEvent.click(await screen.findByTestId("co-place"));
    await waitFor(() => expect(api.place).toHaveBeenCalled());
    await waitFor(() => expect(loadDeviceOrders("budgetukay").map((o) => o.no)).toEqual(["W-0042"]));
    expect(JSON.parse(localStorage.getItem("sfl_shop_cart_budgetukay") || "[]")).toEqual([]);
    vi.doUnmock("../shopApi");
  });
});
