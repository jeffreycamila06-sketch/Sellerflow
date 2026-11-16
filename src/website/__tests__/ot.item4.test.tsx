// Order tracking — item 4: the parcel is at the store → "Pick up by <date>", days left (on the buyer's device),
// the store, "Pay <total> at pickup" only for pay-on-delivery; past the deadline → the date without days left.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { daysLeft } from "../parcelView";
import { viewOf, NOW } from "./orderPageCases";
import type { OrderView } from "../orderApi";
import { DEMO_SHOP } from "./fixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
async function box(v: Partial<OrderView>, today: string, lang = "en") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${today}T12:00:00`)); // noon on the buyer's device
  const api = { place: vi.fn(), load: vi.fn(async () => viewOf(v)), uploadReceipt: vi.fn() };
  render(<ShopApp preview={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang } }} nowMs={NOW} orderApi={api} startRoute={{ page: "order", token: "f".repeat(64) }} />);
  await screen.findByTestId("od-page");
  return screen.queryByTestId("od-pickup");
}
const AT = { state: "at_store" as const, arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26" };

describe("daysLeft (the buyer's device calendar)", () => {
  it("counts calendar days to the deadline; negative once it has passed", () => {
    expect(daysLeft("2026-11-26", new Date("2026-11-19T23:59:00").getTime())).toBe(7);
    expect(daysLeft("2026-11-26", new Date("2026-11-26T00:01:00").getTime())).toBe(0);
    expect(daysLeft("2026-11-26", new Date("2026-11-27T09:00:00").getTime())).toBe(-1);
    expect(daysLeft("26/11")).toBeNull();
  });
});

describe("the box", () => {
  it("pay at pickup: the date, days left, the store, the amount", async () => {
    const b = await box({ parcel: AT }, "2026-11-19");
    expect(b!.querySelector("b")!.textContent).toBe("Pick up by Nov 26");
    expect(b!.querySelector("span")!.textContent).toBe("7 days left · FamilyMart Xinyi #151003 · Pay NT$83.7 at pickup");
  });
  it("pay first: no amount to pay", async () => {
    const b = await box({ parcel: AT, payment: "bank", paidAt: "2026-11-16T15:00:00Z" }, "2026-11-19");
    expect(b!.querySelector("span")!.textContent).toBe("7 days left · FamilyMart Xinyi #151003");
  });
  it("1 day left / the last day", async () => {
    expect((await box({ parcel: AT }, "2026-11-25"))!.textContent).toContain("1 day left ·");
    cleanup();
    expect((await box({ parcel: AT }, "2026-11-26"))!.textContent).toContain("Last day today ·");
  });
  it("past the deadline (not yet returned): the date without days left", async () => {
    const b = await box({ parcel: AT }, "2026-11-28");
    expect(b!.textContent).toBe("Pick up by Nov 26FamilyMart Xinyi #151003 · Pay NT$83.7 at pickup");
  });
  it("only at the store, with a deadline", async () => {
    expect(await box({ parcel: { state: "in_transit" } }, "2026-11-19")).toBeNull();
    cleanup();
    expect(await box({ parcel: { ...AT, state: "picked_up" } }, "2026-11-19")).toBeNull();
    cleanup();
    expect(await box({ parcel: { state: "at_store" } }, "2026-11-19")).toBeNull();
    cleanup();
    expect(await box({}, "2026-11-19")).toBeNull();
  });
  it("another language", async () => {
    const b = await box({ parcel: AT }, "2026-11-19", "zh-TW");
    expect(b!.textContent).toContain("還剩 7 天");
    expect(b!.textContent).toContain("取件時付款");
  });
});
