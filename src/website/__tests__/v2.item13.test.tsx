// Seller Website v2 — item 13: courier + tracking number when marking an order shipped; the buyer sees
// them on the order page. Both are optional; before sql/167 is applied Mark as shipped works as today.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import WebsiteOrders from "../../redesign/screens/WebsiteOrders";
import type { OrdersApi } from "../../redesign/adapters/websiteEditorApi";
import { rowToWebsiteOrder, type WebsiteOrder } from "../../redesign/adapters/websiteSeller";
import { CheckoutFlow } from "../checkoutPages";
import { toOrderView, type OrderApi, type OrderView } from "../orderApi";
import { validLines } from "../cart";
import type { ShopPage } from "../route";
import { DEMO_SHOP } from "./fixtures";

const ORDER = (over: Partial<WebsiteOrder> = {}): WebsiteOrder => ({
  id: "o1", orderNo: 12, token: "f".repeat(64), status: "paid", paymentIssue: false, buyerName: "Maria", buyerPhone: "0912345678", buyerContact: null,
  delivery: "s711", storeId: "123456", storeName: "Xinyi", address: null, payment: "bank", items: [{ pid: 1, vid: null, name: "Dress", price: 350, qty: 1 }],
  subtotal: 350, shipFee: 60, total: 410, note: null, receiptPath: null, receiptAt: null, autoCancelAt: null, paidAt: "2026-11-15T01:00:00Z", shippedAt: null,
  cancelledAt: null, cancelReason: null, seenAt: "2026-11-15T01:00:00Z", createdAt: "2026-11-15T01:00:00Z", ...over,
});
function ordersApi(list: WebsiteOrder[], over: Partial<OrdersApi> = {}): OrdersApi {
  return { load: vi.fn(async () => list), blocked: vi.fn(async () => new Set<string>()), receipt: vi.fn(async () => null), shopSub: vi.fn(async () => "budgetukay"),
    act: vi.fn(async () => ({ ok: true as const, status: "shipped" as const, blocked: false })),
    ship: vi.fn(async (_id: string, c: string, tr: string) => ({ ok: true as const, courier: c.trim() || null, tracking: tr.trim() || null })), ...over };
}
const seller = (api: OrdersApi, toast = vi.fn()) => render(<TProvider lang="en"><WebsiteOrders onToast={toast} api={api} /></TProvider>);

describe("seller: Mark as shipped", () => {
  it("opens a short form; courier + tracking are sent with it", async () => {
    const api = ordersApi([ORDER()]);
    seller(api);
    fireEvent.click(await screen.findByTestId("wor-row"));
    fireEvent.click(screen.getByTestId("wor-act-shipped"));
    expect(api.ship).not.toHaveBeenCalled();
    expect(api.act).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("wor-courier"), { target: { value: "J&T" } });
    fireEvent.change(screen.getByTestId("wor-tracking"), { target: { value: "JT123456789" } });
    fireEvent.click(screen.getByTestId("wor-ship-confirm"));
    await waitFor(() => expect(api.ship).toHaveBeenCalledWith("o1", "J&T", "JT123456789"));
    const info = await screen.findByTestId("wor-ship-info");
    expect(info).toHaveTextContent("J&T");
    expect(info).toHaveTextContent("JT123456789");
    expect(api.act).not.toHaveBeenCalledWith("o1", "shipped");
  });
  it("both fields can stay empty", async () => {
    const api = ordersApi([ORDER()]);
    seller(api);
    fireEvent.click(await screen.findByTestId("wor-row"));
    fireEvent.click(screen.getByTestId("wor-act-shipped"));
    fireEvent.click(screen.getByTestId("wor-ship-confirm"));
    await waitFor(() => expect(api.ship).toHaveBeenCalledWith("o1", "", ""));
    expect(await screen.findByTestId("wor-edit-tracking")).toHaveTextContent("Add tracking");
  });
  it("a shipped order: Edit tracking keeps what was typed and changes it", async () => {
    const api = ordersApi([ORDER({ status: "shipped", shippedAt: "2026-11-15T02:00:00Z", courier: "LBC", tracking: "111" })]);
    seller(api);
    fireEvent.click(await screen.findByTestId("wor-row"));
    fireEvent.click(screen.getByTestId("wor-edit-tracking"));
    expect(screen.getByTestId("wor-courier")).toHaveValue("LBC");
    fireEvent.change(screen.getByTestId("wor-tracking"), { target: { value: "222" } });
    fireEvent.click(screen.getByTestId("wor-ship-confirm"));
    await waitFor(() => expect(api.ship).toHaveBeenCalledWith("o1", "LBC", "222"));
  });
  it("a failure keeps the form open and says so", async () => {
    const toast = vi.fn();
    const api = ordersApi([ORDER()], { ship: vi.fn(async () => ({ ok: false as const })) });
    seller(api, toast);
    fireEvent.click(await screen.findByTestId("wor-row"));
    fireEvent.click(screen.getByTestId("wor-act-shipped"));
    fireEvent.click(screen.getByTestId("wor-ship-confirm"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("Couldn't")));
    expect(screen.getByTestId("wor-ship-form")).toBeInTheDocument();
  });
  it("without the ship call (older api) Mark as shipped is the plain step, as today", async () => {
    const api = ordersApi([ORDER()]); delete api.ship;
    seller(api);
    fireEvent.click(await screen.findByTestId("wor-row"));
    fireEvent.click(screen.getByTestId("wor-act-shipped"));
    await waitFor(() => expect(api.act).toHaveBeenCalledWith("o1", "shipped"));
    expect(screen.queryByTestId("wor-ship-form")).toBeNull();
  });
  it("the order row reads courier + tracking_no (absent columns → nothing added)", () => {
    expect(rowToWebsiteOrder({ id: "x", courier: "J&T", tracking_no: "9" })).toMatchObject({ courier: "J&T", tracking: "9" });
    const old = rowToWebsiteOrder({ id: "x" });
    expect("courier" in old || "tracking" in old).toBe(false);
  });
});

function Buyer({ view }: { view: OrderView }) {
  const [route, go] = useState<ShopPage>({ page: "order", token: "f".repeat(64) });
  const api: OrderApi = { place: vi.fn(), load: vi.fn(async () => view), uploadReceipt: vi.fn() };
  return <TProvider lang="en"><CheckoutFlow shop={DEMO_SHOP} cur="NT$" route={route} go={go} infos={validLines(DEMO_SHOP, [])} preview={false} onPlaced={() => {}} api={api} linkFor={() => "https://x"} /></TProvider>;
}
const VIEW = (over: Partial<OrderView> = {}): OrderView => ({
  orderNo: "W-0012", status: "shipped", paymentIssue: false, items: [{ pid: 1, name: "Dress", price: 350, qty: 1 }], subtotal: 350, shipFee: 60, total: 410,
  delivery: "s711", storeId: "123456", storeName: "Xinyi", payment: "bank", buyerName: "Maria", phoneTail: "678", receipt: false, createdAt: "2026-11-15T01:00:00Z",
  shop: { sub: "budgetukay" }, country: "TW", ...over,
});
describe("buyer: order page", () => {
  it("shipped → courier and tracking number (with copy)", async () => {
    render(<Buyer view={VIEW({ courier: "J&T", tracking: "JT1" })} />);
    expect(await screen.findByTestId("od-courier")).toHaveTextContent("J&T");
    expect(screen.getByTestId("od-tracking")).toHaveTextContent("JT1");
  });
  it("not given → nothing shown (as today)", async () => {
    render(<Buyer view={VIEW()} />);
    await screen.findByTestId("od-total");
    expect(screen.queryByTestId("od-courier")).toBeNull();
    expect(screen.queryByTestId("od-tracking")).toBeNull();
  });
  it("the answer is read defensively", () => {
    const v = toOrderView({ found: true, orderNo: "W-1", courier: "", tracking: 5 });
    expect([v!.courier, v!.tracking]).toEqual([undefined, undefined]);
    expect(toOrderView({ found: true, orderNo: "W-1", courier: "LBC", tracking: "7" })).toMatchObject({ courier: "LBC", tracking: "7" });
  });
});

describe("sql/167 part 13 (contract)", () => {
  const sql = readFileSync("sql/167_seller_website_v2.sql", "utf8");
  it("own orders only; paid/confirmed → shipped, shipped → edit; the buyer sees them only once shipped", () => {
    expect(sql).toMatch(/website_order_ship[\s\S]*?where id = p_id and user_id = me for update/);
    expect(sql).toMatch(/if o\.status in \('paid', 'confirmed'\) then/);
    expect(sql).toMatch(/'courier', case when o\.status = 'shipped' then o\.courier end/);
    expect(sql).toMatch(/revoke all on function public\.website_order_ship\(uuid, text, text\) from public, anon;/);
  });
});
