// Fix (a): on a phone the fields are far above the "Place order" bar. A missing / wrong field must show its
// message next to the field AND come into view with the cursor in it. (Before: the message was there but off
// the screen and the page did not move.) Nothing is sent while a field is wrong — as before.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import { CheckoutFlow, BAD_FIELD } from "../checkoutPages";
import { validLines } from "../cart";
import type { OrderApi } from "../orderApi";
import type { ShopPage } from "../route";
import type { Shop } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

const lines = (shop: Shop) => validLines(shop, [{ pid: 2, vid: null, qty: 1 }]);
function api(place?: OrderApi["place"]): OrderApi {
  return { place: place ?? vi.fn(async () => ({ ok: true as const, orderNo: "W-1", token: "f".repeat(64), total: 340 })), load: vi.fn(async () => null), uploadReceipt: vi.fn(async () => ({ ok: true as const })) };
}
function Page({ a, shop = DEMO_SHOP }: { a: OrderApi; shop?: Shop }) {
  const [route, go] = useState<ShopPage>({ page: "checkout" });
  return <TProvider lang="en"><div data-testid="route">{route.page}</div><CheckoutFlow shop={shop} cur="NT$" route={route} go={go} infos={lines(shop)} preview={false} onPlaced={() => {}} api={a} /></TProvider>;
}
let scrolled: Element[] = [];
beforeEach(() => {
  localStorage.clear(); scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); } as never;
});
afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

describe("checkout: a missing field is shown, brought into view and focused", () => {
  it("empty name: nothing is sent, the message is next to the field, the field is scrolled to and has the cursor", async () => {
    const a = api();
    render(<Page a={a} />);
    fireEvent.click(screen.getByTestId("co-place-phone"));
    const name = screen.getByTestId("co-name");
    await waitFor(() => expect(scrolled).toContain(name));
    expect(a.place).not.toHaveBeenCalled();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    // the message sits right after the field (same block), and says what to do
    const msg = screen.getByText("Enter your name.");
    expect(msg.getAttribute("role")).toBe("alert");
    expect(name.closest("label")!.nextElementSibling).toBe(msg);
    // the FIRST wrong field in page order is the one brought into view (name is above phone and store)
    expect(scrolled[0]).toBe(name);
    expect(document.querySelector(BAD_FIELD)).toBe(name);
  });

  it("name ok, phone wrong: the phone field is the one scrolled to", async () => {
    render(<Page a={api()} />);
    fireEvent.change(screen.getByTestId("co-name"), { target: { value: "Demo Buyer" } });
    fireEvent.change(screen.getByTestId("co-phone"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("co-place-phone"));
    const phone = screen.getByTestId("co-phone");
    await waitFor(() => expect(scrolled[0]).toBe(phone));
    expect(document.activeElement).toBe(phone);
    expect(screen.getByTestId("co-name").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("Enter a valid mobile number.")).toBeTruthy();
  });

  it("no pickup store chosen: the Choose-store button is marked and scrolled to (a button is not focused like a text field)", async () => {
    render(<Page a={api()} />);
    fireEvent.change(screen.getByTestId("co-name"), { target: { value: "Demo Buyer" } });
    fireEvent.change(screen.getByTestId("co-phone"), { target: { value: "0900000000" } });
    fireEvent.click(screen.getByTestId("co-place-phone"));
    const btn = screen.getByTestId("co-choose-store");
    await waitFor(() => expect(scrolled[0]).toBe(btn));
    expect(btn.getAttribute("data-bad")).toBe("true");
    expect(screen.getByText("Choose your pickup store.")).toBeTruthy();
  });

  it("the second tap scrolls again (the buyer scrolled away and tapped Place order once more)", async () => {
    render(<Page a={api()} />);
    fireEvent.click(screen.getByTestId("co-place-phone"));
    await waitFor(() => expect(scrolled.length).toBe(1));
    fireEvent.click(screen.getByTestId("co-place-phone"));
    await waitFor(() => expect(scrolled.length).toBe(2));
  });

  it("a field the SERVER refused is brought into view the same way", async () => {
    localStorage.setItem("sfl_shop_buyer", JSON.stringify({ name: "Demo Buyer", phone: "0900000000", contact: "", address: "", stores: { s711: [{ id: "123456", name: "Store" }] } }));
    const a = api(vi.fn(async () => ({ ok: false as const, error: "bad_phone" })) as never);
    render(<Page a={a} />);
    fireEvent.click(screen.getByTestId("co-place-phone"));
    const phone = screen.getByTestId("co-phone");
    await waitFor(() => expect(scrolled).toContain(phone));
    expect(a.place).toHaveBeenCalledTimes(1);
    expect(phone.getAttribute("aria-invalid")).toBe("true");
  });

  it("no delivery possible: the delivery message shows (it was missing) and nothing is sent", async () => {
    const shop: Shop = { ...DEMO_SHOP, checkout: { ship: {}, autoCancelHours: 24 }, checkout2: undefined };
    const a = api();
    render(<Page a={a} shop={shop} />);
    fireEvent.change(screen.getByTestId("co-name"), { target: { value: "Demo Buyer" } });
    fireEvent.change(screen.getByTestId("co-phone"), { target: { value: "0900000000" } });
    fireEvent.click(screen.getByTestId("co-place-phone"));
    await waitFor(() => expect(screen.getByText("Choose a delivery.")).toBeTruthy());
    expect(a.place).not.toHaveBeenCalled();
  });

  it("everything filled in: the order is sent and nothing is scrolled", async () => {
    localStorage.setItem("sfl_shop_buyer", JSON.stringify({ name: "Demo Buyer", phone: "0900000000", contact: "", address: "", stores: { s711: [{ id: "123456", name: "Store" }] } }));
    const a = api();
    render(<Page a={a} />);
    fireEvent.click(screen.getByTestId("co-place-phone"));
    await waitFor(() => expect(a.place).toHaveBeenCalledTimes(1));
    expect(scrolled.length).toBe(0);
    expect(document.querySelector(BAD_FIELD)).toBeNull();
  });
});
