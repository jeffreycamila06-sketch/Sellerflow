// Seller Website v2 — preview difference 2b: while payment is due the order page shows the running
// countdown to auto-cancel ("Auto-cancels in HH:MM:SS"), from the order's REAL auto-cancel time, and
// keeps the sentence under it ("Orders not paid within N hours are cancelled.").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import { CheckoutFlow } from "../checkoutPages";
import type { OrderView } from "../orderApi";
import type { ShopPage } from "../route";
import type { Shop } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

const EN: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } };
const NOW = Date.parse("2026-11-16T10:00:00Z");
const at = (s: number) => new Date(NOW + s * 1000).toISOString();
const V = (v: Partial<OrderView> = {}): OrderView => ({ orderNo: "W-0012", status: "awaiting_payment", paymentIssue: false, items: [{ pid: 2, name: "Linen", price: 280, qty: 1 }], subtotal: 280, shipFee: 60, total: 340,
  delivery: "s711", storeId: "123456", payment: "bank", buyerName: "Maria", phoneTail: "678", receipt: false, createdAt: at(-18), autoCancelAt: at(23 * 3600 + 59 * 60 + 42),
  shop: { sub: "budgetukay" }, country: "TW", pay: { bank: { accountNumber: "0123" } }, ...v });
function Page({ view }: { view: OrderView }) {
  const [r, go] = useState<ShopPage>({ page: "order", token: "f".repeat(64) });
  return <TProvider lang="en"><CheckoutFlow shop={EN} cur="NT$" route={r} go={go} infos={[]} preview={false} onPlaced={() => {}} api={{ place: vi.fn(), load: vi.fn(async () => view), uploadReceipt: vi.fn() }} linkFor={() => "x"} /></TProvider>;
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("order page countdown", () => {
  it("runs down from the order's real auto-cancel time; the sentence stays", async () => {
    render(<Page view={V()} />);
    await flush();
    expect(screen.getByTestId("od-countdown")).toHaveTextContent("Auto-cancels in 23:59:42");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("od-countdown")).toHaveTextContent("Auto-cancels in 23:59:41");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId("od-countdown")).toHaveTextContent("Auto-cancels in 23:58:41");
    expect(screen.getByText("Orders not paid within 24 hours are cancelled.")).toBeInTheDocument();
  });
  it("another order's time → its own countdown (not a fixed 24 h)", async () => {
    render(<Page view={V({ autoCancelAt: at(2 * 3600 + 5) })} />);
    await flush();
    expect(screen.getByTestId("od-countdown")).toHaveTextContent("Auto-cancels in 02:00:05");
  });
  it("stops at 00:00:00, never negative", async () => {
    render(<Page view={V({ autoCancelAt: at(2) })} />);
    await flush();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId("od-countdown")).toHaveTextContent("Auto-cancels in 00:00:00");
  });
  it("only while payment is due: not after the receipt is sent, not for pay on delivery", async () => {
    const { unmount } = render(<Page view={V({ status: "payment_sent", receipt: true })} />);
    await flush();
    expect(screen.queryByTestId("od-countdown")).toBeNull();
    unmount();
    render(<Page view={V({ payment: "cod", status: "confirmed", autoCancelAt: undefined })} />);
    await flush();
    expect(screen.queryByTestId("od-countdown")).toBeNull();
  });
});
