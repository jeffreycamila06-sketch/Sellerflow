// Order tracking — item 3: the timeline after Shipped (as the preview): In transit → Arrived at the store →
// Picked up, or Returned to the shop (red) in place of Picked up. Passed steps show their date when known.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { orderTimeline } from "../orderText";
import { buildT } from "../../redesign/i18n";
import { viewOf, orderPageHtml, NOW } from "./orderPageCases";
import type { ParcelView } from "../parcelView";
import ShopApp from "../ShopApp";
import { DEMO_SHOP } from "./fixtures";

const t = buildT("en") as unknown as Record<string, string>;
const when = (iso: string) => `@${iso.slice(5, 10)}`;
const P = (parcel: ParcelView) => ({ parcel, when, store: "FamilyMart Xinyi #151003" });
const steps = (parcel: ParcelView, v = viewOf({})) => orderTimeline(t, v, P(parcel)).map((x) => `${x.label}:${x.st || "-"}${x.sub ? ` [${x.sub}]` : ""}`);
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());

describe("the steps (pure)", () => {
  it("in transit", () => {
    expect(steps({ state: "in_transit" })).toEqual(["Order placed:dn", "The shop is packing your order:dn", "Shipped · 12345678901:dn", "In transit:nw [On the way to the store]", "Arrived at the store:-", "Picked up:-"]);
  });
  it("at the store (arrived date + the order's store)", () => {
    expect(steps({ state: "at_store", arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26" }).slice(3)).toEqual(["In transit:dn [On the way to the store]", "Arrived at the store:nw [@11-19 · FamilyMart Xinyi #151003]", "Picked up:-"]);
  });
  it("picked up (every step done, the dates known)", () => {
    expect(steps({ state: "picked_up", arrivedAt: "2026-11-19T01:30:00Z", pickedUpAt: "2026-11-21T10:42:00Z" }).slice(3)).toEqual(["In transit:dn [On the way to the store]", "Arrived at the store:dn [@11-19 · FamilyMart Xinyi #151003]", "Picked up:dn [@11-21]"]);
  });
  it("returned (red, in place of Picked up)", () => {
    expect(steps({ state: "returned", arrivedAt: "2026-11-19T01:30:00Z", returnedAt: "2026-11-27T00:00:00Z" }).slice(3)).toEqual(["In transit:dn [On the way to the store]", "Arrived at the store:dn [@11-19 · FamilyMart Xinyi #151003]", "Returned to the shop:bad [@11-27]"]);
  });
  it("a date that isn't known is simply left out", () => {
    expect(steps({ state: "picked_up" }).slice(4)).toEqual(["Arrived at the store:dn [FamilyMart Xinyi #151003]", "Picked up:dn"]);
  });
  it("pay first: the paid step stays; only the steps after Shipped are added", () => {
    expect(steps({ state: "in_transit" }, viewOf({ payment: "bank" })).slice(0, 4)).toEqual(["Order placed:dn", "Payment received:dn", "The shop is packing your order:dn", "Shipped · 12345678901:dn"]);
  });
  it("without a parcel: the timeline exactly as before", () => {
    const v = viewOf({});
    expect(orderTimeline(t, v)).toEqual(orderTimeline(t, v, undefined));
    expect(orderTimeline(t, v).map((x) => x.label)).toEqual(["Order placed", "The shop is packing your order", "Shipped · 12345678901"]);
  });
});

describe("on the page", () => {
  it("the steps, the dates and the red Returned step render; the extra styles load only with a parcel", async () => {
    const api = { place: vi.fn(), load: vi.fn(async () => viewOf({ parcel: { state: "returned", arrivedAt: "2026-11-19T01:30:00Z", returnedAt: "2026-11-27T00:00:00Z" } })), uploadReceipt: vi.fn() };
    render(<ShopApp preview={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } }} nowMs={NOW} orderApi={api} startRoute={{ page: "order", token: "f".repeat(64) }} />);
    const tl = await screen.findByTestId("od-steps");
    const rows = [...tl.children] as HTMLElement[];
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["dn", "dn", "dn", "dn", "dn", "bad"]);
    expect(rows[5].textContent).toMatch(/^Returned to the shopNov 27/);
    expect(rows[4].textContent).toContain("FamilyMart Xinyi #151003");
    expect(screen.getByTestId("od-page").querySelector("style")!.textContent).toContain(".v-bad");
    cleanup();
    const html = await orderPageHtml(viewOf({}), "order");
    expect(html).not.toContain("<style>");
  });
});
