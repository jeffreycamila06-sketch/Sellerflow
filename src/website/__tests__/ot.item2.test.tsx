// Order tracking — item 2: no match (or a state the page doesn't show) → the order page exactly as today.
// Nothing is written to the order; the state is read each time the page opens.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import { CheckoutFlow } from "../checkoutPages";
import type { ShopPage } from "../route";
import { CASES, viewOf, orderPageHtml, NOW } from "./orderPageCases";
import { orderParcel } from "../parcelView";
import { DEMO_SHOP } from "./fixtures";

const BEFORE_FILE = "src/website/__tests__/fixtures/order-page-before.json";
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => vi.useRealTimers());

// fixtures/order-page-before-link.json = the same 22 pages WITH the order link, captured from commit 7d6b7095 (item 2,
// before any order-page change) through CheckoutFlow with linkFor. How the BEFORE file was made (on the commit before any order-page change): CAPTURE_ORDER_BEFORE=1
it.runIf(!!process.env.CAPTURE_ORDER_BEFORE)("capture the BEFORE html", async () => {
  const out: Record<string, string> = {};
  for (const [name, p] of CASES) for (const page of ["sent", "order"] as const) out[`${name} | ${page}`] = await orderPageHtml(viewOf(p), page);
  writeFileSync(BEFORE_FILE, JSON.stringify(out, null, 1));
});

// The deliberate changes of later items, taken out before comparing (everything else must be byte for byte):
//  item 7 — opened from the link, the big title (od-title) now follows the order's state.
const DELIBERATE = (html: string) => {
  const d = document.createElement("div"); d.innerHTML = html;
  d.querySelector("[data-testid=od-title]")?.remove();
  //  item 8 — the order-link note says "…and upload your receipt" only for pay-first orders (pay on delivery: shorter)
  return d.innerHTML.replace(">Keep this link to check your order.<", ">Keep this link to check your order and upload your receipt.<");
};
describe("no match → the order page as today", () => {
  const before = JSON.parse(readFileSync(BEFORE_FILE, "utf8")) as Record<string, string>;
  it("22 order pages (11 orders × right after checkout / opened from the link) are byte for byte the same (except the deliberate changes)", async () => {
    expect(Object.keys(before)).toHaveLength(22);
    for (const [name, p] of CASES) for (const page of ["sent", "order"] as const) {
      const now = await orderPageHtml(viewOf(p), page);
      expect(DELIBERATE(now), `${name} | ${page}`).toBe(before[`${name} | ${page}`]);
      if (page === "sent" && p.payment !== undefined && p.payment !== "cod") expect(now, `${name} | sent: no deliberate change right after checkout (pay first)`).toBe(before[`${name} | ${page}`]);
    }
  });
  it("the same 22 pages with the order link (as the buyer gets them): the same except the deliberate changes", async () => {
    const beforeLink = JSON.parse(readFileSync("src/website/__tests__/fixtures/order-page-before-link.json", "utf8")) as Record<string, string>;
    expect(Object.keys(beforeLink)).toHaveLength(22);
    for (const [name, p] of CASES) for (const page of ["sent", "order"] as const) {
      const api = { place: vi.fn(), load: vi.fn(async () => viewOf(p)), uploadReceipt: vi.fn() };
      function H() { const [r, go] = useState<ShopPage>({ page, token: "f".repeat(64) } as ShopPage); return <TProvider lang="en"><CheckoutFlow shop={{ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } }} cur="NT$" route={r} go={go} infos={[]} preview={false} onPlaced={() => {}} api={api} linkFor={() => "https://shop.example/o/1"} /></TProvider>; }
      render(<H />);
      const now = (await screen.findByTestId("od-page")).outerHTML;
      cleanup();
      expect(DELIBERATE(now), `${name} | ${page} (with link)`).toBe(beforeLink[`${name} | ${page}`]);
      if (page === "sent" && p.payment !== undefined && p.payment !== "cod") expect(now, `${name} | sent with link: unchanged (pay first)`).toBe(beforeLink[`${name} | ${page}`]);
    }
  });
  it("a parcel on an order that doesn't qualify (home, typed store, not shipped, no tracking) is ignored", async () => {
    const parcel = { state: "at_store" as const, deadline: "2026-11-26" };
    for (const [name, p] of CASES.filter(([n]) => !/^(fm|s711) shipped/.test(n))) {
      for (const page of ["sent", "order"] as const) expect(DELIBERATE(await orderPageHtml(viewOf({ ...p, parcel }), page)), `${name} | ${page}`).toBe(before[`${name} | ${page}`]);
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
