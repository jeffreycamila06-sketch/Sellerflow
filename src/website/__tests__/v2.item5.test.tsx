// Seller Website v2 — item 5: cart, checkout and order page as the preview. Free-shipping progress,
// one-page guest checkout with the summary always in view, the order's status timeline, receipt upload,
// auto-cancel countdown, chat with the shop. Everything that protects orders is unchanged (one server
// call; prices + stock checked there).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import ShopApp from "../ShopApp";
import { TProvider, buildT } from "../../redesign/i18n";
import { CheckoutFlow } from "../checkoutPages";
import { orderTimeline } from "../orderText";
import type { OrderApi, OrderView } from "../orderApi";
import type { ShopPage } from "../route";
import type { Shop } from "../shopApi";
import { validLines } from "../cart";
import { DEMO_SHOP } from "./fixtures";

const t = buildT("en") as unknown as Record<string, string>;
const EN: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } };
beforeEach(() => localStorage.clear());

describe("cart", () => {
  it("steps bar, free-shipping progress, lines, Goes well with, summary + phone bar", () => {
    render(<ShopApp preview={EN} />);
    fireEvent.click(within(screen.getAllByTestId("shop-item")[1]).getByTestId("card-quick"));
    fireEvent.click(screen.getByTestId("shop-cart-btn"));
    expect(screen.getByTestId("shop-steps-bar")).toHaveTextContent("1 Cart");
    expect(screen.getByTestId("cart-free")).toHaveTextContent("NT$1,220");
    expect(screen.getAllByTestId("cart-line")).toHaveLength(1);
    expect(within(screen.getByTestId("cart-goes-with")).getAllByTestId("shop-item").length).toBeGreaterThan(0);
    expect(screen.getByTestId("cart-summary")).toHaveTextContent("from NT$60");
    expect(screen.getByTestId("cart-checkout-phone")).toHaveTextContent("Checkout (1)");
    fireEvent.click(screen.getByTestId("cart-remove"));
    expect(screen.getByTestId("cart-empty")).toBeInTheDocument();
  });
});

describe("checkout", () => {
  function H({ api }: { api: OrderApi }) {
    const [r, go] = useState<ShopPage>({ page: "checkout" });
    return <TProvider lang="en"><CheckoutFlow shop={EN} cur="NT$" route={r} go={go} infos={validLines(EN, [{ pid: 2, vid: null, qty: 1 }])} preview={false} onPlaced={() => {}} api={api} linkFor={() => "x"} /></TProvider>;
  }
  it("one page: details (no account), delivery, payment with its note, summary always shown", () => {
    render(<H api={{ place: vi.fn(), load: vi.fn(), uploadReceipt: vi.fn() }} />);
    expect(screen.getByTestId("shop-steps-bar")).toHaveTextContent("2 Details");
    expect(screen.getByText("No account needed")).toBeInTheDocument();
    expect(screen.getByTestId("co-pay-note")).toHaveTextContent("Pay within 24 hours");
    fireEvent.click(screen.getByTestId("co-pay-cod"));
    expect(screen.getByTestId("co-pay-note")).toHaveTextContent("You pay NT$340 when you get your order");
    expect(screen.getByTestId("co-total")).toHaveTextContent("NT$340");
    expect(screen.getByTestId("co-place")).toHaveTextContent("NT$340");
  });
});

describe("order page", () => {
  const V: OrderView = { orderNo: "W-0012", status: "awaiting_payment", paymentIssue: false, items: [{ pid: 2, name: "Linen", price: 280, qty: 1 }], subtotal: 280, shipFee: 60, total: 340,
    delivery: "s711", storeId: "123456", storeName: "Xinyi", payment: "bank", buyerName: "Maria", phoneTail: "678", receipt: false, createdAt: "2026-11-16T00:00:00Z", autoCancelAt: "2026-11-17T00:00:00Z",
    shop: { sub: "budgetukay", chats: { line: "budgetukay" } }, country: "TW", pay: { bank: { accountNumber: "0123" } } };
  it("the timeline follows the status (pay first and pay on delivery)", () => {
    const st = (v: Partial<OrderView>) => orderTimeline(t, { ...V, ...v }).map((x) => `${x.label}:${x.st || "-"}`);
    expect(st({})).toEqual(["Order placed:dn", "Waiting for payment:nw", "The shop is packing your order:-", "Shipped:-"]);
    expect(st({ status: "payment_sent" })[1]).toBe("Receipt sent — waiting for the shop to confirm:nw");
    expect(st({ status: "paid" })).toEqual(["Order placed:dn", "Payment received:dn", "The shop is packing your order:nw", "Shipped:-"]);
    expect(st({ status: "shipped", courier: "J&T", tracking: "JT1" })[3]).toBe("Shipped · J&T · JT1:nw");
    expect(st({ payment: "cod", status: "confirmed" })).toEqual(["Order placed:dn", "The shop is packing your order:nw", "Shipped:-"]);
  });
  it("the page: steps bar, timeline, pay box with receipt upload, chat, summary", async () => {
    function H() { const [r, go] = useState<ShopPage>({ page: "order", token: "f".repeat(64) }); return <TProvider lang="en"><CheckoutFlow shop={EN} cur="NT$" route={r} go={go} infos={[]} preview={false} onPlaced={() => {}} api={{ place: vi.fn(), load: vi.fn(async () => V), uploadReceipt: vi.fn() }} linkFor={() => "https://x/o/1"} /></TProvider>; }
    render(<H />);
    expect(await screen.findByTestId("od-steps")).toHaveTextContent("Waiting for payment");
    expect(screen.getByTestId("shop-steps-bar")).toHaveTextContent("3 Done");
    expect(screen.getByTestId("od-upload")).toBeInTheDocument();
    expect(screen.getByTestId("od-chat-line")).toBeInTheDocument();
    expect(screen.getByTestId("od-total")).toHaveTextContent("NT$340");
  });
});
