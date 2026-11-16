// Order tracking — item 7: the big title follows the order's state (opened from the link); right after checkout the
// page still reads "Order sent!" as today. The small pill shows the parcel's state once it matched.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { orderHero } from "../orderText";
import { buildT } from "../../redesign/i18n";
import { viewOf, NOW } from "./orderPageCases";
import type { OrderView } from "../orderApi";
import { DEMO_SHOP } from "./fixtures";

const t = buildT("en") as unknown as Record<string, string>;
afterEach(() => cleanup());
async function page(v: Partial<OrderView>, kind: "sent" | "order" = "order") {
  const api = { place: vi.fn(), load: vi.fn(async () => viewOf(v)), uploadReceipt: vi.fn() };
  render(<ShopApp preview={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } }} nowMs={NOW} orderApi={api} startRoute={{ page: kind, token: "f".repeat(64) }} />);
  await screen.findByTestId("od-page");
}

describe("the title (approved mapping)", () => {
  it("each order state", () => {
    const title = (v: Partial<OrderView>) => orderHero(t, viewOf(v), v.parcel).title;
    expect(title({ status: "awaiting_payment", payment: "bank" })).toBe("Waiting for payment");
    expect(title({ status: "payment_sent", payment: "bank" })).toBe("Receipt sent");
    expect(title({ status: "paid", payment: "bank" })).toBe("The shop is packing your order");
    expect(title({ status: "confirmed" })).toBe("The shop is packing your order");
    expect(title({})).toBe("Your order has shipped");
    expect(title({ parcel: { state: "in_transit" } })).toBe("Your order is on the way");
    expect(title({ parcel: { state: "at_store" } })).toBe("Ready for pickup");
    expect(title({ parcel: { state: "picked_up" } })).toBe("Picked up. Thank you!");
    expect(title({ parcel: { state: "returned" } })).toBe("Parcel returned to the shop");
    expect(title({ status: "cancelled" })).toBe("Cancelled");
  });
});

describe("on the page", () => {
  it("opened from the link: the state's title (+ the preview's line under it)", async () => {
    await page({ parcel: { state: "at_store", deadline: "2026-11-26" } });
    const h = screen.getByTestId("od-title");
    expect(h.textContent).toBe("📦Ready for pickupYour parcel is waiting at the store.");
    expect(h.getAttribute("data-tone")).toBe("warn");
    expect(screen.queryByTestId("od-sent")).toBeNull();
  });
  it("returned: red", async () => {
    await page({ parcel: { state: "returned" } });
    expect(screen.getByTestId("od-title").getAttribute("data-tone")).toBe("bad");
    expect(screen.getByTestId("od-status")).toHaveTextContent("Returned");
    expect(screen.getByTestId("od-status").getAttribute("data-tone")).toBe("bad");
  });
  it("right after checkout: \"Order sent!\" as today, no state title", async () => {
    await page({ status: "awaiting_payment", payment: "bank", tracking: undefined }, "sent");
    expect(screen.getByTestId("od-sent")).toHaveTextContent("Order sent!");
    expect(screen.queryByTestId("od-title")).toBeNull();
  });
  it("the pill: the parcel's state once it matched; the order's status without one", async () => {
    await page({ parcel: { state: "in_transit" } });
    expect(screen.getByTestId("od-status")).toHaveTextContent("In transit");
    cleanup();
    await page({ parcel: { state: "at_store" } });
    expect(screen.getByTestId("od-status")).toHaveTextContent("Ready for pickup");
    cleanup();
    await page({});
    expect(screen.getByTestId("od-status")).toHaveTextContent("Shipped");
    expect(screen.getByTestId("od-status").hasAttribute("data-tone")).toBe(false);
  });
});
