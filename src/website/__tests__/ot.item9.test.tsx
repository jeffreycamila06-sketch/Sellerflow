// Order tracking — item 9: home delivery, typed pickup stores and other countries are unchanged: courier + tracking
// number only, never a parcel state (the database matches only 7-ELEVEN / FamilyMart; the page checks again).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import ShopApp from "../ShopApp";
import { viewOf, NOW } from "./orderPageCases";
import type { OrderView } from "../orderApi";
import { DEMO_SHOP } from "./fixtures";

afterEach(() => cleanup());
async function html(v: Partial<OrderView>) {
  const api = { place: vi.fn(), load: vi.fn(async () => viewOf(v)), uploadReceipt: vi.fn() };
  render(<ShopApp preview={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } }} nowMs={NOW} orderApi={api} startRoute={{ page: "order", token: "f".repeat(64) }} />);
  const el = await screen.findByTestId("od-page");
  const out = el.outerHTML;
  return out;
}
const PARCEL = { state: "at_store" as const, deadline: "2026-11-26", arrivedAt: "2026-11-19T01:30:00Z", checkedAt: "2026-11-19T01:40:00Z" };
const OTHERS: [string, Partial<OrderView>][] = [
  ["home delivery", { delivery: "home", storeId: undefined, storeName: undefined, address: "No. 5, Lane 20, Taipei", courier: "Black Cat", tracking: "TW8842001" }],
  ["typed pickup store", { delivery: "store", storeId: undefined, storeName: "Toronto Main", courier: "Canada Post", tracking: "CP123" }],
  ["Canada home delivery", { delivery: "home", country: "CA", storeId: undefined, storeName: undefined, address: "12 King St W, Toronto", courier: "Canada Post", tracking: "CP998", payment: "bank", paidAt: "2026-11-16T15:00:00Z" }],
  ["local pickup", { delivery: "pickup", storeId: undefined, storeName: undefined, tracking: undefined }],
];

describe("home / typed store / other countries", () => {
  for (const [name, v] of OTHERS) {
    it(`${name}: the same page with or without a parcel; courier + tracking number only`, async () => {
      const without = await html(v); cleanup();
      const withParcel = await html({ ...v, parcel: PARCEL }); cleanup();
      expect(withParcel).toBe(without);
      for (const id of ["od-pickup", "od-returned", "od-updated"]) expect(withParcel).not.toContain(`data-testid="${id}"`);
      expect(withParcel).not.toMatch(/In transit|Arrived at the store|Ready for pickup/);
      if (v.courier) expect(withParcel).toContain(`data-testid="od-courier">${v.courier}<`);
      if (v.tracking) expect(withParcel).toContain(`data-testid="od-tracking">${v.tracking}<`);
    });
  }
  it("the database side: only s711 / fm orders are ever matched", () => {
    expect(readFileSync("sql/171_website_parcel_tracking.sql", "utf8")).toContain("p_delivery not in ('s711', 'fm')");
  });
});
