// Seller Website v2 — audit fix 1: the price changed between view and order. The page sends the total it
// showed (shownTotal); the database places NO order when its own total differs and answers 'price_changed'
// with the new total; the page then shows the new prices and the buyer confirms again.
// (Database side: scripts/sql167-behaviour.mjs "AUDIT FIX 1" — flash sale ending between view and order.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import { placeError, toPriceNow, type OrderApi, type PlaceInput, type PlaceResult } from "../orderApi";
import { CheckoutFlow } from "../checkoutPages";
import { validLines } from "../cart";
import { currencyFor, type Shop } from "../shopApi";
import type { ShopPage } from "../route";
import { DEMO_SHOP } from "./fixtures";

const SHOP: Shop = { ...DEMO_SHOP, country: "CA", shop: { ...DEMO_SHOP.shop, lang: "en", currency: undefined },
  checkout: { ship: {}, autoCancelHours: 24 },
  checkout2: { options: [{ id: "pickup", needs: "none", fee: 0, cod: false }, { id: "std", needs: "address", fee: 15, cod: false }],
    methods: [{ id: "interac", kind: "first", info: "Send to pay@shop.ca" }], autoCancelHours: 24 } };
const HINT = JSON.stringify({ total: 300, subtotal: 300, shipFee: 0, items: [{ pid: 2, vid: null, price: 300 }] });

function Flow({ api }: { api: OrderApi }) {
  const [r, go] = useState<ShopPage>({ page: "checkout" });
  return <TProvider lang="en"><div data-testid="route">{r.page}</div><CheckoutFlow shop={SHOP} cur={currencyFor(SHOP)} route={r} go={go} infos={validLines(SHOP, [{ pid: 2, vid: null, qty: 1 }])} preview={false} onPlaced={() => {}} api={api} linkFor={() => "x"} /></TProvider>;
}
const type = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
beforeEach(() => localStorage.clear());

describe("the database's answer", () => {
  it("'price_changed' + its hint → the new total and line prices", () => {
    const r = placeError({ message: "price_changed", hint: HINT });
    expect(r).toEqual({ ok: false, error: "price_changed", priceNow: { total: 300, subtotal: 300, shipFee: 0, items: [{ pid: 2, vid: null, price: 300 }] } });
  });
  it("'price_changed' without a readable total → a plain network error (nothing was placed)", () => {
    expect(placeError({ message: "price_changed" })).toEqual({ ok: false, error: "network" });
    expect(toPriceNow({ total: "x", subtotal: 1, shipFee: 0 })).toBeNull();
  });
  it("other errors still read their hint as before", () => {
    expect(placeError({ message: "out_of_stock", hint: JSON.stringify({ pid: 2, vid: null, left: 1 }) })).toEqual({ ok: false, error: "out_of_stock", pid: 2, vid: null, left: 1 });
  });
});

describe("checkout", () => {
  it("sends the total on the screen; a changed price shows the new total and the buyer confirms again", async () => {
    const placed: PlaceInput[] = [];
    const answers: PlaceResult[] = [placeError({ message: "price_changed", hint: HINT }), { ok: true, orderNo: "W-0001", token: "f".repeat(64), total: 300 }];
    const api: OrderApi = { place: vi.fn(async (_s: string, i: PlaceInput) => { placed.push(i); return answers.shift()!; }), load: vi.fn(async () => null), uploadReceipt: vi.fn() };
    render(<Flow api={api} />);
    type("co-name", "Ann Lee"); type("co-phone", "416 555 0199");
    fireEvent.click(screen.getByTestId("co-del-pickup"));
    expect(screen.getByTestId("co-total")).toHaveTextContent("CA$280");
    fireEvent.click(screen.getByTestId("co-place"));
    await waitFor(() => expect(placed).toHaveLength(1));
    expect(placed[0].shownTotal).toBe(280);
    // nothing placed: the buyer stays on checkout, sees the new price and total
    expect(await screen.findByTestId("co-price-changed")).toHaveTextContent("The price changed since you opened this page. New total: CA$300.");
    expect(screen.getByTestId("route")).toHaveTextContent("checkout");
    expect(screen.getByTestId("co-total")).toHaveTextContent("CA$300");
    expect(screen.getByTestId("co-place")).toHaveTextContent("CA$300");
    expect(screen.queryByTestId("co-fail")).toBeNull();
    // confirms → the new total is what is sent
    fireEvent.click(screen.getByTestId("co-place"));
    await waitFor(() => expect(placed).toHaveLength(2));
    expect(placed[1].shownTotal).toBe(300);
    await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("sent"));
  });
  it("changing the delivery after the answer → the page's own numbers again (and a new check)", async () => {
    const api: OrderApi = { place: vi.fn(async () => placeError({ message: "price_changed", hint: HINT })), load: vi.fn(async () => null), uploadReceipt: vi.fn() };
    render(<Flow api={api} />);
    type("co-name", "Ann Lee"); type("co-phone", "416 555 0199");
    fireEvent.click(screen.getByTestId("co-del-pickup"));
    fireEvent.click(screen.getByTestId("co-place"));
    await screen.findByTestId("co-price-changed");
    fireEvent.click(screen.getByTestId("co-del-std"));
    expect(screen.queryByTestId("co-price-changed")).toBeNull();
    expect(screen.getByTestId("co-total")).toHaveTextContent("CA$295");
  });
});
