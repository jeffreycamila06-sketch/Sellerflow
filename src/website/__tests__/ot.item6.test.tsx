// Order tracking — item 6: "Last updated: <time>" from the last check; before any match no such line.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { viewOf, NOW } from "./orderPageCases";
import type { OrderView } from "../orderApi";
import { parcelWhen } from "../parcelView";
import { DEMO_SHOP } from "./fixtures";

afterEach(() => cleanup());
async function page(v: Partial<OrderView>) {
  const api = { place: vi.fn(), load: vi.fn(async () => viewOf(v)), uploadReceipt: vi.fn() };
  render(<ShopApp preview={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } }} nowMs={NOW} orderApi={api} startRoute={{ page: "order", token: "f".repeat(64) }} />);
  await screen.findByTestId("od-page");
}

describe("last updated", () => {
  it("with a match: the time of the last check, in the order box", async () => {
    await page({ parcel: { state: "in_transit", checkedAt: "2026-11-19T01:40:00Z" } });
    expect(screen.getByTestId("od-updated").textContent).toBe(`Last updated: ${parcelWhen("2026-11-19T01:40:00Z", "en")}`);
    expect(screen.getByTestId("od-updated").textContent).toMatch(/^Last updated: Nov 19, \d{1,2}:40 [AP]M$/);
  });
  it("no match, or a match without a check time: no line", async () => {
    await page({});
    expect(screen.queryByTestId("od-updated")).toBeNull();
    cleanup();
    await page({ parcel: { state: "in_transit" } });
    expect(screen.queryByTestId("od-updated")).toBeNull();
  });
});
