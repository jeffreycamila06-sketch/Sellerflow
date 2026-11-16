// Seller Website v2 — audit fix 2: how to pay stays on the order link. The database keeps a copy of the
// picked method on the order (sql/167 website_orders.pay_copy) and website_order returns it as `pay`; the
// order page shows ONLY what the order says — never the shop's current payment list — so a method the
// seller later edits, turns off or deletes still shows where to pay.
// (Database side: scripts/sql167-behaviour.mjs "AUDIT FIX 2".)
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import { CheckoutFlow } from "../checkoutPages";
import { toOrderView, type OrderView } from "../orderApi";
import type { ShopPage } from "../route";
import type { Shop } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

// the shop's payment list today: EMPTY (the seller deleted every method after the order)
const SHOP: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" }, checkout: { ship: {}, autoCancelHours: 24 },
  checkout2: { options: [{ id: "s711", needs: "store711", fee: 60, cod: false }], methods: [], autoCancelHours: 24 } };
// what website_order answers for the order: the copy kept when it was placed
const ANSWER = { found: true, orderNo: "W-0042", status: "awaiting_payment", paymentIssue: false, items: [{ pid: 2, name: "Linen", price: 280, qty: 1 }],
  subtotal: 280, shipFee: 60, total: 340, delivery: "s711", storeId: "123456", payment: "bank", buyerName: "Maria", phoneTail: "678", receipt: false,
  createdAt: "2026-11-16T00:00:00Z", autoCancelAt: "2026-11-17T00:00:00Z", shop: { sub: "budgetukay" }, country: "TW", payId: "c3xyzw", payName: "Jko Pay",
  pay: { method: { id: "c3xyzw", kind: "first", name: "Jko Pay", info: "Jko: 0912 000 111", bank: { bankName: "CTBC", accountName: "J", accountNumber: "123" } } } };

function Page({ view }: { view: OrderView }) {
  const [r, go] = useState<ShopPage>({ page: "order", token: "f".repeat(64) });
  return <TProvider lang="en"><CheckoutFlow shop={SHOP} cur="NT$" route={r} go={go} infos={[]} preview={false} onPlaced={() => {}} api={{ place: vi.fn(), load: vi.fn(async () => view), uploadReceipt: vi.fn() }} linkFor={() => "x"} /></TProvider>;
}

describe("order link", () => {
  it("the method deleted from the shop after the order → the buyer still sees where to pay", async () => {
    const view = toOrderView(ANSWER)!;
    expect(view.pay?.method?.info).toBe("Jko: 0912 000 111");
    render(<Page view={view} />);
    expect((await screen.findAllByText("Jko Pay")).length).toBeGreaterThan(0);
    expect(screen.getByText("Jko: 0912 000 111")).toBeInTheDocument();
    expect(screen.getByText("123")).toBeInTheDocument();
    expect(screen.getByText("CTBC")).toBeInTheDocument();
  });
});
