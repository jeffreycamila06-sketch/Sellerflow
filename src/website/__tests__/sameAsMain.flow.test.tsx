// PROOF: the buyer's journey works the same as on main. One scripted buyer goes through the shop
// (open a product, pick options, add, save, quick add, cart, quantity, checkout, pick a store, change delivery
// and payment, place the order, order page, upload a receipt, my orders) and everything that MATTERS is
// written down after each step: the address, what is stored on the device (cart, buyer, saved, orders) and
// every call to the order service with its full contents, plus the totals on the screen.
// fixtures/flowOnMain.json was written by running THIS file on main (SFL_FLOW_DUMP=<file>).
// On a branch the journey must give the same record with the new look OFF and with it ON.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Shop } from "../shopApi";
import { SHOPS, NOW, TOKEN, recordingApi, type Recorder } from "./fixtures/proofShops";

let current: Shop = SHOPS.pop;
vi.mock("../shopApi", async (orig) => ({ ...(await orig<typeof import("../shopApi")>()), loadShop: vi.fn(async () => current) }));
import ShopApp from "../ShopApp";

const FILE = join(__dirname, "fixtures", "flowOnMain.json");
const DUMP = process.env.SFL_FLOW_DUMP;
const main: Record<string, unknown> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const out: Record<string, unknown> = {};
const KEYS = ["sfl_shop_cart_budgetukay", "sfl_shop_buyer", "sfl_shop_saved_budgetukay", "sfl_shop_orders_budgetukay"];
const stored = () => Object.fromEntries(KEYS.map((k) => [k.replace("sfl_shop_", "").replace("_budgetukay", ""), JSON.parse(localStorage.getItem(k) ?? "null")]));
const text = (id: string) => screen.queryByTestId(id)?.textContent ?? null;
const card = (name: string) => screen.getAllByTestId("shop-item").find((c) => c.getAttribute("aria-label") === name)!;
const tap = (id: string) => fireEvent.click(screen.getByTestId(id));
const at = async (path: string) => waitFor(() => expect(location.pathname).toBe(`/s/budgetukay${path}`));

async function journey(shop: Shop, extra: Record<string, unknown>) {
  current = shop;
  const brand = shop.shop.look?.layout === "brand";
  const rec: Recorder = { calls: [] };
  const log: unknown[] = [];
  const step = (name: string, more: Record<string, unknown> = {}) => log.push({ step: name, path: location.pathname, ...stored(), calls: rec.calls.length, ...more });
  history.replaceState(null, "", "/s/budgetukay");
  const r = render(<ShopApp host="www.sellerflowlive.com" path="/s/budgetukay" nowMs={NOW} orderApi={recordingApi(rec)} {...extra} />);
  await waitFor(() => expect(screen.getByTestId("shop-home")).toBeTruthy());
  step("home", { cards: screen.getAllByTestId("shop-item").length });

  fireEvent.click(card("Vintage sport tee")); await at("/p/5");
  step("product", { name: text("pd-name"), price: text("pd-price"), was: text("pd-was"), addDisabled: (screen.getByTestId("pd-add") as HTMLButtonElement).disabled });
  for (const v of ["Purple", "L"]) fireEvent.click(screen.getAllByTestId("pd-opt").find((b) => b.textContent === v)!);
  tap("pd-plus");
  step("picked", { qty: text("pd-qty"), stock: text("pd-stock"), total: text("pd-total"), soldOutOption: (screen.getAllByTestId("pd-opt").find((b) => b.textContent === "M") as HTMLButtonElement).disabled });
  tap("pd-add");
  step("added", { toast: text("shop-toast"), panel: !!screen.queryByTestId("brand-cart-panel"), count: text("shop-cart-count") });
  if (brand) tap("panel-keep");
  tap("pd-save");
  step("saved", { toast: text("shop-toast"), savedCount: text("shop-saved-count") });

  tap("shop-back"); await at("");
  fireEvent.click(within(card("Linen button shirt, oversized")).getByTestId("card-quick"));
  step("quick-add plain", { toast: text("shop-toast"), panel: !!screen.queryByTestId("brand-cart-panel"), count: text("shop-cart-count") });
  if (brand) tap("panel-x");
  fireEvent.click(within(card("Plain tee, sizes only")).getByTestId("card-quick"));
  if (brand) {
    step("quick-add sizes", { sheet: !!screen.queryByTestId("brand-size-sheet"), sizes: screen.getAllByTestId("brand-size").map((b) => `${b.textContent}${(b as HTMLButtonElement).disabled ? " (off)" : ""}`) });
    fireEvent.click(screen.getAllByTestId("brand-size")[0]);
    step("size picked", { panel: !!screen.queryByTestId("brand-cart-panel"), subtotal: text("panel-subtotal"), free: text("panel-free") });
    fireEvent.click(screen.getAllByTestId("panel-plus")[0]);
    step("panel +1", { subtotal: text("panel-subtotal"), qty: screen.getAllByTestId("panel-qty").map((x) => x.textContent) });
    fireEvent.click(screen.getAllByTestId("panel-remove").at(-1)!);
    step("panel remove", { subtotal: text("panel-subtotal"), lines: screen.getAllByTestId("panel-line").length });
    tap("panel-checkout"); await at("/checkout");
  } else {
    await at("/p/6");
    step("quick-add sizes", { toast: text("shop-toast") });
    tap("shop-cart-btn"); await at("/cart");
    step("cart", { subtotal: text("cart-subtotal"), free: text("cart-free"), lines: screen.getAllByTestId("cart-line").length, summary: text("cart-summary") });
    fireEvent.click(screen.getAllByTestId("cart-plus")[0]);
    step("cart +1", { subtotal: text("cart-subtotal"), qty: screen.getAllByTestId("cart-qty").map((x) => x.textContent) });
    fireEvent.click(screen.getAllByTestId("cart-remove").at(-1)!);
    step("cart remove", { subtotal: text("cart-subtotal"), lines: screen.getAllByTestId("cart-line").length });
    tap("cart-checkout-phone"); await at("/checkout");
  }

  step("checkout", { total: text("co-total"), payNote: text("co-pay-note"), choices: screen.getAllByRole("radio").map((b) => `${b.getAttribute("data-testid")}=${b.getAttribute("aria-checked")}${(b as HTMLButtonElement).disabled ? " (off)" : ""}`) });
  tap("co-place-phone");
  step("place with nothing filled", { fail: text("co-fail"), wrong: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent) });
  fireEvent.change(screen.getByTestId("co-name"), { target: { value: "Demo Buyer" } });
  fireEvent.change(screen.getByTestId("co-phone"), { target: { value: "0900 000 000" } });
  fireEvent.change(screen.getByTestId("co-contact"), { target: { value: "demo.buyer" } });
  tap("co-del-home");
  step("home delivery", { total: text("co-total"), choices: screen.getAllByRole("radio").map((b) => `${b.getAttribute("data-testid")}=${b.getAttribute("aria-checked")}${(b as HTMLButtonElement).disabled ? " (off)" : ""}`) });
  tap("co-del-fm"); tap("co-pay-cod");
  step("FamilyMart + pay at pickup", { total: text("co-total"), payNote: text("co-pay-note") });
  tap("co-del-s711"); tap("co-pay-bank");
  tap("co-choose-store"); await at("/store");
  fireEvent.change(screen.getByTestId("st-id"), { target: { value: "12a3456789" } });
  fireEvent.change(screen.getByTestId("st-name"), { target: { value: "Test Store" } });
  step("store page", { id: (screen.getByTestId("st-id") as HTMLInputElement).value, map: screen.getByTestId("st-map").getAttribute("href") });
  tap("st-use"); await at("/checkout");
  fireEvent.change(screen.getByTestId("co-note"), { target: { value: "Please pack well" } });
  step("ready", { store: text("co-store"), total: text("co-total"), name: (screen.getByTestId("co-name") as HTMLInputElement).value });
  tap("co-place-phone"); await at(`/sent/${TOKEN}`);
  await waitFor(() => expect(screen.getByTestId("od-page")).toBeTruthy());
  step("order sent", { no: text("od-no"), status: text("od-status"), total: text("od-total"), steps: [...screen.getByTestId("od-steps").children].map((x) => `${x.getAttribute("data-state")}:${x.textContent}`),
    pay: text("od-pay"), chats: [...screen.getByTestId("od-chat").querySelectorAll("a")].map((a) => `${a.getAttribute("data-testid")} ${a.getAttribute("href")}`), link: (screen.getByTestId("od-link") as HTMLInputElement).value });
  fireEvent.change(screen.getByTestId("od-file"), { target: { files: [new File(["x"], "receipt.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(screen.getByTestId("od-receipt-ok")).toBeTruthy());
  step("receipt uploaded", { ok: text("od-receipt-ok") });

  fireEvent.click(screen.getByTestId("shop-logo")); await at("");
  tap("bnav-orders"); await at("/orders");
  step("my orders", { rows: screen.getAllByTestId("device-order").map((x) => x.textContent) });
  tap("device-order"); await at(`/o/${TOKEN}`);
  await waitFor(() => expect(screen.getByTestId("od-page")).toBeTruthy());
  step("order link", { no: text("od-no"), sent: !!screen.queryByTestId("od-sent") });
  r.unmount();
  return { log, calls: rec.calls };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); localStorage.clear(); localStorage.setItem("sfl_shop_lang", "en"); });
afterEach(() => { vi.useRealTimers(); });

const KINDS = ["pop", "brandOcean", "marketDark"] as const;
describe("the buyer's journey = main (new look OFF)", () => {
  for (const k of KINDS) it(k, async () => {
    const got = JSON.parse(JSON.stringify(await journey(SHOPS[k], {})));
    out[k] = got;
    expect((got.calls as unknown[][]).filter((c) => c[0] === "place").length).toBe(1);
    if (!DUMP) expect(got).toEqual(main[k]);
  });
  it("3 journeys" + (DUMP ? " (written)" : ""), () => { if (DUMP) writeFileSync(DUMP, JSON.stringify(out, null, 1)); else expect(Object.keys(main).length).toBe(3); });
});
describe.skipIf(!!DUMP)("the buyer's journey = main (new look ON)", () => {
  for (const k of [...KINDS, "boutique", "bold", "brandBlush"] as const) it(k, async () => {
    const got = JSON.parse(JSON.stringify(await journey(SHOPS[k], { newLook: true })));
    const same = k === "boutique" || k === "bold" ? "pop" : k === "brandBlush" ? "brandOcean" : k;
    expect(got).toEqual(main[same]);
  });
});
