// Order tracking — the order pages used to prove "an order without a match renders the same before and after".
// The BEFORE html was captured from this file on the commit before any order-page change (item 2) into
// fixtures/order-page-before.json; ot.item2.test.tsx renders the same cases with the current code.
import { render, screen, cleanup } from "@testing-library/react";
import { vi } from "vitest";
import ShopApp from "../ShopApp";
import type { Shop } from "../shopApi";
import type { OrderView } from "../orderApi";
import type { ShopPage } from "../route";
import { DEMO_SHOP } from "./fixtures";

export const NOW = Date.parse("2026-11-20T04:00:00Z");
const SHOP: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en", chats: { line: "budgetukay", messenger: "budgetukay" } } };
const BASE: OrderView = { orderNo: "W-0001", status: "shipped", paymentIssue: false, items: [{ pid: 2, name: "TSHIRT ONEPIECE", price: 7.9, qty: 3 }], subtotal: 23.7, shipFee: 60, total: 83.7,
  delivery: "fm", storeId: "151003", storeName: "Xinyi", payment: "cod", buyerName: "Maria", phoneTail: "782", receipt: false, createdAt: "2026-11-16T14:07:00Z", shippedAt: "2026-11-17T06:15:00Z",
  tracking: "12345678901", shop: { sub: "budgetukay", name: "Budgetukay", chats: { line: "budgetukay", messenger: "budgetukay" } }, country: "TW" };
export const CASES: [string, Partial<OrderView>][] = [
  ["fm shipped cod, no parcel", {}],
  ["s711 shipped cod, no parcel", { delivery: "s711", tracking: "F12345678901" }],
  ["fm shipped bank (paid first), no parcel", { payment: "bank", paidAt: "2026-11-16T15:00:00Z", receipt: true }],
  ["home shipped, courier + tracking", { delivery: "home", storeId: undefined, storeName: undefined, address: "No. 5, Lane 20, Taipei", courier: "Black Cat", tracking: "TW8842001" }],
  ["typed pickup store shipped", { delivery: "store", storeId: undefined, storeName: "Toronto Main", tracking: "CP123" }],
  ["awaiting payment (bank)", { status: "awaiting_payment", payment: "bank", tracking: undefined, shippedAt: undefined, autoCancelAt: "2026-11-21T14:07:00Z", pay: { bank: { bankName: "822 CTBC", accountName: "Budgetukay", accountNumber: "1234" } } }],
  ["receipt sent", { status: "payment_sent", payment: "bank", receipt: true, tracking: undefined, shippedAt: undefined, pay: { bank: { bankName: "822 CTBC" } } }],
  ["paid (packing)", { status: "paid", payment: "bank", receipt: true, tracking: undefined, shippedAt: undefined }],
  ["confirmed cod (packing)", { status: "confirmed", tracking: undefined, shippedAt: undefined }],
  ["cancelled", { status: "cancelled", cancelReason: "seller", tracking: undefined, shippedAt: undefined }],
  ["Canada home shipped", { delivery: "home", country: "CA", storeId: undefined, storeName: undefined, address: "12 King St W, Toronto", courier: "Canada Post", tracking: "CP998", payment: "bank", paidAt: "2026-11-16T15:00:00Z" }],
];
export const viewOf = (p: Partial<OrderView>): OrderView => ({ ...BASE, ...p, shop: { ...BASE.shop, ...(p.shop || {}) } });
/** The order page's html for one case: "sent" = right after checkout, "order" = opened later from the link. */
export async function orderPageHtml(v: OrderView, page: "sent" | "order", shop: Shop = SHOP): Promise<string> {
  const api = { place: vi.fn(), load: vi.fn(async () => v), uploadReceipt: vi.fn() };
  render(<ShopApp preview={shop} nowMs={NOW} orderApi={api} startRoute={{ page, token: "f".repeat(64) } as ShopPage} />);
  const el = await screen.findByTestId("od-page");
  const html = el.outerHTML;
  cleanup();
  return html;
}
