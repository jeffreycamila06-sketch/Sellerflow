// Seller Website part 3 — checkout and orders: the form checks, the ONE place-order call (no prices
// sent from the browser), store pick, device memory + "Not you?", the order link (payment, receipt
// upload, "Not received"), send-to-chat (order saved first, copied, app opened; prefill only where the
// app supports it), privacy (no buyer data logged), and the SQL contract.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import { CheckoutFlow } from "../checkoutPages";
import { placeFailText, paymentsOf, deliveriesOf } from "../checkoutLogic";
import { placeError, draftErrors, rememberStore, toOrderView, BUYER_KEY, type OrderApi, type OrderView, type PlaceInput } from "../orderApi";
import { orderMessage } from "../orderText";
import { chatHref, CHAT_PREFILL } from "../shopLinks";
import { validLines } from "../cart";
import type { ShopPage } from "../route";
import ShopApp from "../ShopApp";
import { DEMO_SHOP } from "./fixtures";

const TOKEN = "f".repeat(64);
const lines = () => validLines(DEMO_SHOP, [{ pid: 1, vid: 12, qty: 2 }, { pid: 2, vid: null, qty: 1 }]);
const VIEW: OrderView = {
  orderNo: "W-0012", status: "awaiting_payment", paymentIssue: false, items: [{ pid: 1, vid: 12, name: "Floral dress", label: "M · Pink", price: 350, qty: 2 }],
  subtotal: 700, shipFee: 60, total: 760, delivery: "s711", storeId: "123456", storeName: "Xinyi", payment: "bank", buyerName: "Maria", phoneTail: "678",
  receipt: false, createdAt: "2026-11-15T01:00:00Z", autoCancelAt: "2026-11-16T01:00:00Z",
  shop: { sub: "budgetukay", name: "BudgetUkay", chats: { messenger: "budgetukay", line: "budgetukay", whatsapp: "886912000111", instagram: "budgetukay.tw" } }, country: "TW",
  pay: { bank: { bankName: "Cathay (013)", accountName: "BudgetUkay", accountNumber: "0123-4567-8901" } },
};
function fakeApi(over: Partial<OrderApi> = {}): OrderApi & { placed: PlaceInput[] } {
  const placed: PlaceInput[] = [];
  return {
    placed,
    place: vi.fn(async (_s, input) => { placed.push(input); return { ok: true as const, orderNo: "W-0012", token: TOKEN, total: 1040 }; }),
    load: vi.fn(async () => VIEW),
    uploadReceipt: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}
function Harness({ api, start = { page: "checkout" } as ShopPage, preview = false, onPlaced = () => {} }: { api: OrderApi; start?: ShopPage; preview?: boolean; onPlaced?: () => void }) {
  const [route, go] = useState<ShopPage>(start);
  return (
    <TProvider lang="en">
      <div data-testid="route">{route.page}</div>
      <CheckoutFlow shop={DEMO_SHOP} cur="NT$" route={route} go={go} infos={lines()} preview={preview} onPlaced={onPlaced} api={api} linkFor={(r) => `https://www.sellerflowlive.com/s/budgetukay/${r.page === "order" ? `o/${r.token}` : ""}`} />
    </TProvider>
  );
}
const type = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("pure checks", () => {
  it("database errors → the buyer's reason (+ which item, how many left)", () => {
    expect(placeError({ message: "out_of_stock", hint: '{"pid":1,"vid":12,"left":1}' })).toEqual({ ok: false, error: "out_of_stock", pid: 1, vid: 12, left: 1 });
    expect(placeError({ message: "blocked" }).ok === false && (placeError({ message: "blocked" }) as { error: string }).error).toBe("blocked");
    expect((placeError({ message: "something new" }) as { error: string }).error).toBe("network");
    const t = { rd_shop_co_err_stock: "{name}: only {n} left." } as Record<string, string>;
    expect(placeFailText(t, { ok: false, error: "out_of_stock", pid: 1, vid: 12, left: 1 }, lines())).toBe("Floral midi dress, soft chiffon, lined (M · Pink): only 1 left.");
  });
  it("form rules: name, phone 8–15 digits, store 6 digits, address, COD never with Home", () => {
    const allowed = { delivery: deliveriesOf(DEMO_SHOP), payment: paymentsOf(DEMO_SHOP, "s711") };
    const ok = { name: "Maria", phone: "0912-345-678", contact: "", delivery: "s711" as const, storeId: "123456", storeName: "", address: "", payment: "bank" as const, note: "" };
    expect(draftErrors(ok, allowed)).toEqual([]);
    expect(draftErrors({ ...ok, name: " ", phone: "12", storeId: "12" }, allowed)).toEqual(["name", "phone", "store"]);
    expect(draftErrors({ ...ok, delivery: "home", address: "x", payment: "cod" }, allowed)).toEqual(["address", "payment"]);
    expect(paymentsOf(DEMO_SHOP, "home")).toEqual(["bank"]);
    expect(paymentsOf(DEMO_SHOP, "s711")).toEqual(["bank", "cod"]);
  });
  it("recent stores: newest first, no repeats, max 3", () => {
    let m = rememberStore({}, "s711", "111111", "A");
    for (const [id, n] of [["222222", "B"], ["333333", "C"], ["111111", "A2"], ["444444", "D"]]) m = rememberStore(m, "s711", id, n);
    expect(m.s711!.map((s) => s.id)).toEqual(["444444", "111111", "333333"]);
  });
  it("chat links: WhatsApp + LINE Official Account open with the text; Messenger / Instagram don't take it", () => {
    expect(CHAT_PREFILL).toEqual({ whatsapp: true, line: true, messenger: false, instagram: false });
    expect(chatHref("whatsapp", "+886 912 000 111", "Hi #1")).toBe("https://wa.me/886912000111?text=Hi%20%231");
    expect(chatHref("line", "@budgetukay", "Hi")).toBe("https://line.me/R/oaMessage/%40budgetukay/?Hi");
    expect(chatHref("line", "budgetukay")).toBe("https://line.me/R/ti/p/@budgetukay");
    expect(chatHref("messenger", "budgetukay", "Hi")).toBe("https://m.me/budgetukay");
    expect(chatHref("instagram", "@budgetukay.tw", "Hi")).toBe("https://ig.me/m/budgetukay.tw");
  });
  it("the chat message: W number, lines, shipping, total, payment, name, link — never the phone", () => {
    const t = { rd_shop_od_order: "Order {no}", rd_shop_shipping: "Shipping", rd_shop_co_total: "Total", rd_shop_payment: "Payment", rd_shop_msg_name: "Name", rd_shop_msg_link: "Order link", rd_shop_pay_bank: "Bank transfer", rd_shop_co_free: "Free", rd_shop_fm: "FamilyMart", rd_shop_home: "Home" };
    const m = orderMessage(t, VIEW, "NT$", "https://x/o/" + TOKEN);
    expect(m).toBe(["Order W-0012 — BudgetUkay", "• Floral dress (M · Pink) ×2 — NT$700", "Shipping (7-11 Xinyi #123456): NT$60", "Total: NT$760", "Payment: Bank transfer", "Name: Maria", `Order link: https://x/o/${TOKEN}`].join("\n"));
    expect(m).not.toMatch(/678|0912/);
  });
  it("order view parsing: not found → null", () => {
    expect(toOrderView({ found: false })).toBeNull();
    expect(toOrderView({ found: true, orderNo: "W-0001", items: [{ pid: "1", qty: "2", price: "10", name: "x" }], total: "20" })!.items[0]).toEqual({ pid: 1, vid: null, name: "x", label: undefined, code: undefined, price: 10, qty: 2, photo: undefined });
  });
});

describe("checkout", () => {
  it("missing fields → nothing is sent; the fields say why", async () => {
    const api = fakeApi();
    render(<Harness api={api} />);
    fireEvent.click(screen.getByTestId("co-place-phone"));
    await waitFor(() => expect(screen.getByTestId("co-fail")).toHaveTextContent("Please check the fields in red."));
    expect(api.place).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Choose your pickup store.")).toBeInTheDocument();
  });
  it("fill in → store pick → place: ONE call with ids + qty only (no prices); cart cleared; order sent page", async () => {
    const api = fakeApi(); const placed = vi.fn();
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    render(<Harness api={api} onPlaced={placed} />);
    type("co-name", "Maria"); type("co-phone", "0912345678");
    expect(screen.getByTestId("co-total")).toHaveTextContent("NT$1,040"); // 700 + 280 + 7-11 60
    fireEvent.click(screen.getByTestId("co-choose-store"));
    expect(screen.getByTestId("route")).toHaveTextContent("store");
    expect(screen.getByTestId("st-map")).toHaveAttribute("href", "https://emap.pcsc.com.tw/");
    expect(screen.getByTestId("st-use")).toBeDisabled();
    type("st-id", "12a3456"); type("st-name", "Xinyi");
    expect((screen.getByTestId("st-id") as HTMLInputElement).value).toBe("123456");
    fireEvent.click(screen.getByTestId("st-use"));
    expect(screen.getByTestId("co-store")).toHaveTextContent("Xinyi#123456");
    fireEvent.click(screen.getByTestId("co-place-phone"));
    await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("sent"));
    expect(api.place).toHaveBeenCalledTimes(1);
    const input = api.placed[0];
    expect(input.items).toEqual([{ pid: 1, vid: 12, qty: 2 }, { pid: 2, vid: null, qty: 1 }]);
    expect(JSON.stringify(input)).not.toMatch(/price|total|350|280/);
    expect(input).toMatchObject({ name: "Maria", phone: "0912345678", delivery: "s711", storeId: "123456", storeName: "Xinyi", payment: "bank" });
    expect(placed).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(BUYER_KEY)!)).toMatchObject({ name: "Maria", phone: "0912345678", stores: { s711: [{ id: "123456", name: "Xinyi" }] } });
    for (const s of logs) for (const c of s.mock.calls) expect(JSON.stringify(c)).not.toMatch(/Maria|0912345678|123456/);
  });
  it("remembered on this device; Not you? clears it (form + storage)", () => {
    localStorage.setItem(BUYER_KEY, JSON.stringify({ name: "Maria", phone: "0912345678", contact: "", address: "", stores: { s711: [{ id: "123456", name: "Xinyi" }] } }));
    render(<Harness api={fakeApi()} />);
    expect((screen.getByTestId("co-name") as HTMLInputElement).value).toBe("Maria");
    expect(screen.getByTestId("co-store")).toHaveTextContent("#123456");
    fireEvent.click(screen.getByTestId("co-not-you"));
    expect((screen.getByTestId("co-name") as HTMLInputElement).value).toBe("");
    expect(localStorage.getItem(BUYER_KEY)).toBeNull();
    expect(screen.getByTestId("co-choose-store")).toBeInTheDocument();
  });
  it("Home delivery: address needed, COD not allowed (greyed), fee 120", () => {
    render(<Harness api={fakeApi()} />);
    fireEvent.click(screen.getByTestId("co-del-home"));
    expect(screen.getByTestId("co-address")).toBeInTheDocument();
    expect(screen.getByTestId("co-pay-cod")).toBeDisabled();
    expect(screen.getByTestId("co-total")).toHaveTextContent("NT$1,100");
  });
  it("out of stock from the server → which item and how many left; nothing saved", async () => {
    const api = fakeApi({ place: vi.fn(async () => ({ ok: false as const, error: "out_of_stock" as const, pid: 1, vid: 12, left: 1 })) });
    localStorage.setItem(BUYER_KEY, JSON.stringify({ name: "Maria", phone: "0912345678", contact: "", address: "", stores: { s711: [{ id: "123456", name: "Xinyi" }] } }));
    const before = localStorage.getItem(BUYER_KEY);
    render(<Harness api={api} />);
    fireEvent.click(screen.getByTestId("co-place-phone"));
    await waitFor(() => expect(screen.getByTestId("co-fail")).toHaveTextContent("only 1 left"));
    expect(screen.getByTestId("route")).toHaveTextContent("checkout");
    expect(localStorage.getItem(BUYER_KEY)).toBe(before);
  });
  it("seller preview: the Place order buttons are off", () => {
    const api = fakeApi();
    render(<Harness api={api} preview />);
    expect(screen.getByTestId("co-place")).toBeDisabled();
    expect(screen.getByTestId("co-place-phone")).toBeDisabled();
    expect(screen.getByTestId("co-preview")).toBeInTheDocument();
  });
  it("privacy note at checkout", () => {
    render(<Harness api={fakeApi()} />);
    expect(screen.getByTestId("co-privacy")).toHaveTextContent("go only to BudgetUkay for this order");
  });
});

describe("order sent / order link", () => {
  it("pay first: bank details + upload receipt → receipt sent; auto-cancel hours", async () => {
    let view = VIEW;
    const api = fakeApi({ load: vi.fn(async () => view), uploadReceipt: vi.fn(async () => { view = { ...VIEW, status: "payment_sent", receipt: true }; return { ok: true as const }; }) });
    render(<Harness api={api} start={{ page: "sent", token: TOKEN }} />);
    await screen.findByTestId("od-sent");
    expect(screen.getByTestId("od-no")).toHaveTextContent("Order W-0012");
    expect(screen.getByTestId("od-pay")).toHaveTextContent("0123-4567-8901");
    expect(screen.getByTestId("od-pay")).toHaveTextContent("Orders not paid within 24 hours are cancelled.");
    const file = new File([new Uint8Array([1, 2, 3])], "r.jpg", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(screen.getByTestId("od-file"), { target: { files: [file] } }); });
    await waitFor(() => expect(screen.getByTestId("od-receipt-ok")).toBeInTheDocument());
    expect(api.uploadReceipt).toHaveBeenCalledWith(TOKEN, file);
    expect(screen.getByTestId("od-status")).toHaveTextContent("Receipt sent — the seller is checking");
  });
  it("not a picture → refused before any upload", async () => {
    const api = fakeApi();
    render(<Harness api={api} start={{ page: "order", token: TOKEN }} />);
    await screen.findByTestId("od-pay");
    await act(async () => { fireEvent.change(screen.getByTestId("od-file"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } }); });
    expect(api.uploadReceipt).not.toHaveBeenCalled();
    expect(screen.getByText("Please choose a picture (photo or screenshot).")).toBeInTheDocument();
  });
  it("send to chat: real links; tap copies the order and says paste it in <app>; WhatsApp carries the text", async () => {
    const writeText = vi.fn(async (_s: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness api={fakeApi()} start={{ page: "sent", token: TOKEN }} />);
    await screen.findByTestId("od-chat");
    const m = screen.getByTestId("od-chat-messenger");
    expect(m.tagName).toBe("A");
    expect(m).toHaveAttribute("href", "https://m.me/budgetukay");
    expect(m).toHaveAttribute("target", "_blank");
    fireEvent.click(m);
    await waitFor(() => expect(screen.getByTestId("co-toast")).toHaveTextContent("Order copied, paste it in Messenger"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Order W-0012"));
    expect(writeText.mock.calls[0][0]).toContain(`/o/${TOKEN}`);
    expect(screen.getByTestId("od-chat-whatsapp").getAttribute("href")).toMatch(/^https:\/\/wa\.me\/886912000111\?text=Order%20W-0012/);
    expect(screen.getByTestId("od-chat-instagram")).toHaveAttribute("href", "https://ig.me/m/budgetukay.tw");
  });
  it("status steps the seller sets show here: Not received, paid, shipped, cancelled, COD", async () => {
    const cases: [Partial<OrderView>, string][] = [
      [{ paymentIssue: true }, "od-issue"], [{ status: "cancelled", cancelReason: "auto" }, "od-cancelled"],
      [{ status: "confirmed", payment: "cod" }, "od-cod"],
    ];
    for (const [over, id] of cases) {
      const { unmount } = render(<Harness api={fakeApi({ load: vi.fn(async () => ({ ...VIEW, ...over })) })} start={{ page: "order", token: TOKEN }} />);
      await screen.findByTestId(id);
      unmount();
    }
    render(<Harness api={fakeApi({ load: vi.fn(async () => ({ ...VIEW, status: "shipped" as const })) })} start={{ page: "order", token: TOKEN }} />);
    await screen.findByTestId("od-steps");
    expect(screen.getByTestId("od-status")).toHaveTextContent("Shipped");
    expect(screen.queryByTestId("od-pay")).toBeNull();
  });
  it("unknown token → not found", async () => {
    render(<Harness api={fakeApi({ load: vi.fn(async () => null) })} start={{ page: "order", token: TOKEN }} />);
    expect(await screen.findByTestId("od-missing")).toHaveTextContent("We couldn't find this order.");
  });
  it("the whole shop app: preview checkout cannot place an order", async () => {
    const api = fakeApi();
    render(<ShopApp preview={DEMO_SHOP} orderApi={api} startRoute={{ page: "checkout" }} />);
    expect(screen.getByText("購物車是空的。")).toBeInTheDocument(); // TW shop → 繁體中文; the preview cart is in-memory only
    expect(api.place).not.toHaveBeenCalled();
  });
});

describe("SQL contract (sql/163 part 3)", () => {
  const sql = readFileSync("sql/163_seller_website.sql", "utf8");
  const part3 = sql.slice(sql.indexOf("-- ── PART 3"));
  it("website orders never touch the billing ledger or live buyer numbering", () => {
    expect(part3).not.toMatch(/insert into public\.orders|update public\.orders\b|insert into public\.live_session_orders|update public\.live_session_orders/i);
  });
  it("prices + stock from the database under a row lock; the place-order call is public, actions are not", () => {
    expect(part3).toMatch(/for update;\s*\n\s*label := null;/);
    expect(part3).toContain("v_sub := v_sub + prod.price * ln.qty");
    expect(part3).toContain("grant execute on function public.website_place_order(text, jsonb, text) to anon, authenticated");
    expect(part3).toContain("revoke all on function public.website_order_action(uuid, text) from public, anon");
    expect(part3).toMatch(/website-receipts', 'website-receipts', false/);
  });
  it("the order link uses a long random token", () => {
    expect(part3).toContain("token           text not null unique check (token ~ '^[A-Za-z0-9_-]{32,128}$')");
    expect(part3).toMatch(/v_token := replace\(gen_random_uuid\(\)::text, '-', ''\) \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/);
  });
});
