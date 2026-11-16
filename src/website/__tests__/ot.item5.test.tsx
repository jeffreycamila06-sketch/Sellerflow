// Order tracking — item 5: returned → the red box asking the buyer to message the shop (the shop's own chat links).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { viewOf, NOW } from "./orderPageCases";
import type { OrderView } from "../orderApi";
import { DEMO_SHOP } from "./fixtures";

afterEach(() => cleanup());
async function page(v: Partial<OrderView>) {
  const api = { place: vi.fn(), load: vi.fn(async () => viewOf(v)), uploadReceipt: vi.fn() };
  render(<ShopApp preview={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } }} nowMs={NOW} orderApi={api} startRoute={{ page: "order", token: "f".repeat(64) }} />);
  await screen.findByTestId("od-page");
}
const RET = { state: "returned" as const, arrivedAt: "2026-11-19T01:30:00Z", returnedAt: "2026-11-27T00:00:00Z", deadline: "2026-11-26" };

describe("returned", () => {
  it("the red box with the shop's chat links (the same links as the chat box below)", async () => {
    await page({ parcel: RET });
    const box = screen.getByTestId("od-returned");
    expect(box.className).toBe("v-pnote v-bad");
    expect(box.textContent).toMatch(/^This parcel went back to the shopMessage the shop to arrange a new delivery\./);
    const links = within(box).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["line", "messenger"].map((k) => screen.getByTestId(`od-chat-${k}`).getAttribute("href")));
    expect(screen.queryByTestId("od-pickup")).toBeNull(); // no deadline box once returned
  });
  it("a shop without chat links: the box without buttons", async () => {
    await page({ parcel: RET, shop: { sub: "budgetukay", name: "Budgetukay", chats: {} } });
    expect(within(screen.getByTestId("od-returned")).queryAllByRole("link")).toHaveLength(0);
  });
  it("only when returned", async () => {
    for (const st of ["in_transit", "at_store", "picked_up"] as const) {
      await page({ parcel: { ...RET, state: st } });
      expect(screen.queryByTestId("od-returned"), st).toBeNull();
      cleanup();
    }
  });
});
