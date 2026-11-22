// PROOF: with the new look switched OFF, every buyer page is the same as on main — the page's HTML AND its
// style sheet, compared as fingerprints. 6 shops (one per way a shop can look today) × 11 pages.
// fixtures/pagesOnMain.json was written by running THIS file on main (SFL_SHOP_DUMP=<file>); it runs unchanged
// on main and on a branch. The one difference allowed is listed in ALLOWED (a fix that is meant for everyone).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Shop } from "../shopApi";
import { SHOPS, NOW, TOKEN, CART, BUYER, recordingApi } from "./fixtures/proofShops";

let current: Shop = SHOPS.pop;
vi.mock("../shopApi", async (orig) => ({ ...(await orig<typeof import("../shopApi")>()), loadShop: vi.fn(async () => current) }));
import ShopApp from "../ShopApp";

/** Style rules added on purpose for EVERY shop since main (each one is a fix with its own test). */
const ALLOWED = [".sfl-v2 .v-live .v-tx .v-pill{color:#fff}\n"];
const PAGES: [string, string, string][] = [
  ["home", "", "shop-home"], ["shop", "/shop", "shop-list"], ["product-options", "/p/5", "pd-page"], ["product-plain", "/p/2", "pd-page"], ["cart", "/cart", "cart-page"],
  ["checkout", "/checkout", "co-page"], ["store", "/store", "st-id"], ["order-sent", `/sent/${TOKEN}`, "od-page"], ["order", `/o/${TOKEN}`, "od-page"], ["saved", "/saved", "saved-page"], ["orders", "/orders", "orders-page"],
];
const FILE = join(__dirname, "fixtures", "pagesOnMain.json");
const DUMP = process.env.SFL_SHOP_DUMP;
const main: Record<string, string> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const out: Record<string, string> = {};
const print = (html: string) => { let h = html; for (const a of ALLOWED) h = h.split(a).join(""); return `${createHash("sha256").update(h).digest("hex").slice(0, 24)} ${h.length}`; };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  localStorage.clear();
  localStorage.setItem("sfl_shop_lang", "en");
  localStorage.setItem("sfl_shop_cart_budgetukay", CART);
  localStorage.setItem("sfl_shop_buyer", BUYER);
  localStorage.setItem("sfl_shop_saved_budgetukay", JSON.stringify([5, 2]));
  localStorage.setItem("sfl_shop_orders_budgetukay", JSON.stringify([{ token: TOKEN, no: "W-0012", at: new Date(NOW).toISOString(), total: 1320 }]));
});
afterEach(() => { vi.useRealTimers(); });

describe("new look OFF: every page = main (HTML + style sheet)", () => {
  for (const [sk, shop] of Object.entries(SHOPS)) for (const [pk, path, ready] of PAGES) {
    it(`${sk} · ${pk}`, async () => {
      current = shop;
      const r = render(<ShopApp host="www.sellerflowlive.com" path={`/s/budgetukay${path}`} nowMs={NOW} orderApi={recordingApi({ calls: [] })} />);
      await waitFor(() => expect(r.container.querySelector(`[data-testid="${ready}"]`)).not.toBeNull());
      const fp = print(r.container.innerHTML);
      out[`${sk}/${pk}`] = fp;
      r.unmount();
      if (!DUMP) expect(fp, `${sk}/${pk} differs from main`).toBe(main[`${sk}/${pk}`]);
    });
  }
  it("covers 66 pages" + (DUMP ? " (written)" : ""), () => {
    expect(Object.keys(out).length).toBe(66);
    if (DUMP) writeFileSync(DUMP, JSON.stringify(out, null, 1));
    else expect(Object.keys(main).length).toBe(66);
  });
});
