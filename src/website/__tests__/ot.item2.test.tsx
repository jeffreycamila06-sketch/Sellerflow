// Order tracking — item 2: no match (or a state the page doesn't show) → the order page exactly as today.
// Nothing is written to the order; the state is read each time the page opens.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { CASES, viewOf, orderPageHtml, NOW } from "./orderPageCases";
import { orderParcel } from "../parcelView";
import { DEMO_SHOP } from "./fixtures";

const BEFORE_FILE = "src/website/__tests__/fixtures/order-page-before.json";
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());

// how the BEFORE file was made (on the commit before any order-page change): CAPTURE_ORDER_BEFORE=1
it.runIf(!!process.env.CAPTURE_ORDER_BEFORE)("capture the BEFORE html", async () => {
  const out: Record<string, string> = {};
  for (const [name, p] of CASES) for (const page of ["sent", "order"] as const) out[`${name} | ${page}`] = await orderPageHtml(viewOf(p), page);
  writeFileSync(BEFORE_FILE, JSON.stringify(out, null, 1));
});

describe("no match → the order page as today", () => {
  const before = JSON.parse(readFileSync(BEFORE_FILE, "utf8")) as Record<string, string>;
  it("22 order pages (11 orders × right after checkout / opened from the link) are byte for byte the same", async () => {
    expect(Object.keys(before)).toHaveLength(22);
    for (const [name, p] of CASES) for (const page of ["sent", "order"] as const) {
      expect(await orderPageHtml(viewOf(p), page), `${name} | ${page}`).toBe(before[`${name} | ${page}`]);
    }
  });
  it("a parcel on an order that doesn't qualify (home, typed store, not shipped, no tracking) is ignored", async () => {
    const parcel = { state: "at_store" as const, deadline: "2026-11-26" };
    for (const [name, p] of CASES.filter(([n]) => !/^(fm|s711) shipped/.test(n))) {
      for (const page of ["sent", "order"] as const) expect(await orderPageHtml(viewOf({ ...p, parcel }), page), `${name} | ${page}`).toBe(before[`${name} | ${page}`]);
    }
    expect(orderParcel(viewOf({ delivery: "home", parcel }))).toBeUndefined();
    expect(orderParcel(viewOf({ status: "paid", parcel }))).toBeUndefined();
    expect(orderParcel(viewOf({ tracking: undefined, parcel }))).toBeUndefined();
    expect(orderParcel(viewOf({ parcel }))).toEqual(parcel);
  });
  it("read each time the page opens; nothing is written", async () => {
    const load = vi.fn(async () => viewOf({ parcel: { state: "in_transit" } }));
    const api = { place: vi.fn(), load, uploadReceipt: vi.fn() };
    for (let i = 0; i < 2; i++) {
      render(<ShopApp preview={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } }} nowMs={NOW} orderApi={api} startRoute={{ page: "order", token: "f".repeat(64) }} />);
      await screen.findByTestId("od-page");
      cleanup();
    }
    expect(load).toHaveBeenCalledTimes(2);
    expect(api.place).not.toHaveBeenCalled();
    expect(api.uploadReceipt).not.toHaveBeenCalled();
  });
});
