// Seller Website v2 — item 10: the seller's shipping options list (name, fee, free-over, what the buyer
// gives: a store number (7-11 / FamilyMart, Taiwan only), a typed store name, an address, or nothing),
// ready lists per country, and the buyer's checkout using it. A shop that never saved a list behaves
// exactly as today (Taiwan: 7-11 / FamilyMart / home).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import WebsitePayShip from "../../redesign/screens/WebsitePayShip";
import type { PayShipApi } from "../../redesign/adapters/websiteEditorApi";
import type { MyWebsite, WebsiteSettings } from "../../redesign/adapters/websiteSeller";
import { readyShipOptions, editorShipOptions, withShipOptions, publicCheckoutV2, shipProblems, newShipOption } from "../../redesign/adapters/websiteShipPay";
import { checkoutFrom } from "../../redesign/adapters/websiteEditor";
import { toCheckoutV2, v2FromLegacy, checkoutOf, deliveryOfNeeds, shipLabel, freeOverOf } from "../shipPay";
import { deliveriesOf, paymentsOf } from "../checkoutLogic";
import { draftErrors, type OrderApi, type OrderDraft, type PlaceInput } from "../orderApi";
import { CheckoutFlow } from "../checkoutPages";
import { validLines } from "../cart";
import type { ShopPage } from "../route";
import type { Shop } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";
import { buildT } from "../../redesign/i18n";

const CASES = JSON.parse(readFileSync("scripts/fixtures/checkout-v2-cases.json", "utf8")) as { name: string; country: string; settings: WebsiteSettings; expected: unknown }[];
const t = buildT("en") as unknown as Record<string, string>;

describe("ready lists per country (Jeff 2026-11-16)", () => {
  const ids = (c: string) => readyShipOptions(c).map((o) => `${o.id}:${o.needs}:${o.fee}:${o.cod ? "cod" : "-"}:${o.on ? "on" : "off"}`);
  it("Taiwan as today; others start off with no fee, Local pickup on and free", () => {
    expect(ids("TW")).toEqual(["s711:store711:60:cod:on", "fm:storefm:60:cod:on", "home:address:120:-:off"]);
    expect(ids("CA")).toEqual(["std:address:0:-:off", "exp:address:0:-:off", "pickup:none:0:cod:on"]);
    expect(ids("AU")).toEqual(ids("CA"));
    expect(ids("PH")).toEqual(["jt:address:0:cod:off", "lbc:address:0:cod:off", "pickup:none:0:cod:on"]);
    expect(ids("JP")).toEqual(["std:address:0:-:off", "pickup:none:0:cod:on"]);
  });
  it("labels: ready names translated, a typed name wins", () => {
    expect(["s711", "fm", "home", "pickup", "std", "exp", "jt", "lbc"].map((id) => shipLabel(t, { id }))).toEqual(["7-11", "FamilyMart", "Home delivery", "Local pickup", "Standard shipping", "Express shipping", "J&T Express", "LBC"]);
    expect(shipLabel(t, { id: "c1abcd", name: " Post office ", needs: "store" })).toBe("Post office");
  });
});

describe("the editor's list", () => {
  it("nothing saved, Taiwan → today's settings as the list (+ nothing else)", () => {
    const l = editorShipOptions({ ship: { s711: { fee: 45 }, fm: { enabled: false }, home: { enabled: true, fee: 150 } }, freeOver: 999 }, "TW");
    expect(l.map((x) => `${x.id}:${x.on}:${x.fee}:${x.freeOver}`)).toEqual(["s711:true:45:999", "fm:false:60:999", "home:true:150:999"]);
  });
  it("nothing saved, Canada → Local pickup on + the ready ones off (home only if it was on)", () => {
    expect(editorShipOptions({}, "CA").map((x) => `${x.id}:${x.on}`)).toEqual(["pickup:true", "std:false", "exp:false"]);
    expect(editorShipOptions({ ship: { home: { enabled: true, fee: 15 } } }, "CA").map((x) => `${x.id}:${x.on}`)).toEqual(["home:true", "pickup:true", "std:false", "exp:false"]);
  });
  it("a saved list is kept as saved; 7-11 / FamilyMart pickers only in Taiwan", () => {
    const st: WebsiteSettings = { shipOptions: [{ id: "s711", needs: "store711", fee: 60, freeOver: 0, cod: true, on: true, name: "", note: "" }, { id: "std", needs: "address", fee: 9, freeOver: 0, cod: false, on: true, name: "", note: "" }] };
    expect(editorShipOptions(st, "AU").map((x) => x.id)).toEqual(["std", "exp", "pickup"]);
    expect(editorShipOptions(st, "AU").find((x) => x.id === "pickup")!.on).toBe(false); // ready extras added OFF to a saved list
  });
  it("saving writes the list + Taiwan's old fields (so a rollback keeps what the seller chose)", () => {
    const l = editorShipOptions({}, "TW").map((x) => (x.id === "s711" ? { ...x, fee: 45, freeOver: 800 } : x.id === "fm" ? { ...x, on: false } : x));
    const s = withShipOptions({ bank: { enabled: true } }, l);
    expect(s.shipOptions!.map((x) => x.id)).toEqual(["s711", "fm", "home"]);
    expect(s.ship).toEqual({ s711: { enabled: true, fee: 45 }, fm: { enabled: false, fee: 60 }, home: { enabled: false, fee: 120 } });
    expect(s.freeOver).toBe(800);
    expect(s.bank).toEqual({ enabled: true });
  });
  it("a new option needs a name; nothing on → can't save", () => {
    const n = newShipOption(() => 0.5);
    expect(n.id).toMatch(/^c[0-9a-z]{5}$/);
    expect(shipProblems([n])).toEqual(["name"]);
    expect(shipProblems([{ ...n, on: false }])).toEqual(["none"]);
    expect(shipProblems([{ ...n, name: "Post office" }])).toEqual([]);
  });
});

describe("what the buyer sees = the database (shared cases with sql/167's proof script)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(publicCheckoutV2(c.settings, c.country)).toEqual(c.expected);
      expect(toCheckoutV2(c.expected)).toEqual(c.expected); // the shop reads the database's answer unchanged
    });
  }
  it("before sql/167 (no checkout2): derived from the old answer the same way", () => {
    for (const c of CASES.filter((x) => !("shipOptions" in x.settings) && !("payMethods" in x.settings) && !("taxIncluded" in x.settings))) {
      expect(v2FromLegacy(checkoutFrom(c.settings), c.country)).toEqual(c.expected);
    }
  });
});

describe("the buyer's checkout", () => {
  it("an old shop answer (Taiwan) → s711 / fm / home, the same rules as before", () => {
    expect(deliveriesOf(DEMO_SHOP)).toEqual(["s711", "fm", "home"]);
    expect(paymentsOf(DEMO_SHOP, "home")).toEqual(["bank"]);
    expect(freeOverOf(checkoutOf(DEMO_SHOP))).toBe(1500);
    expect([deliveryOfNeeds("store711"), deliveryOfNeeds("storefm"), deliveryOfNeeds("store"), deliveryOfNeeds("address"), deliveryOfNeeds("none")]).toEqual(["s711", "fm", "store", "home", "pickup"]);
  });
  const CA: Shop = { ...DEMO_SHOP, country: "CA", checkout: { ship: {}, cod: true, autoCancelHours: 24 },
    checkout2: { options: [{ id: "std", needs: "address", fee: 15, freeOver: 100, cod: false }, { id: "c1abcd", needs: "store", name: "Canada Post office", fee: 8, cod: false }, { id: "pickup", needs: "none", fee: 0, cod: true, note: "Sat 2–5pm" }],
      methods: [{ id: "bank", kind: "first", bank: { accountNumber: "1" } }, { id: "cod", kind: "delivery" }], autoCancelHours: 24 } };
  const d = (o: Partial<OrderDraft>): OrderDraft => ({ name: "Ann", phone: "4165550123", contact: "", delivery: "std", storeId: "", storeName: "", address: "", payment: "bank", note: "", ...o });
  const rules = { delivery: deliveriesOf(CA), payment: ["bank", "cod"], options: CA.checkout2!.options, methods: CA.checkout2!.methods };
  it("field checks follow what the option needs", () => {
    expect(draftErrors(d({ address: "12 King St W, Toronto" }), rules)).toEqual([]);
    expect(draftErrors(d({}), rules)).toEqual(["address"]);
    expect(draftErrors(d({ delivery: "c1abcd" }), rules)).toEqual(["store"]);
    expect(draftErrors(d({ delivery: "c1abcd", storeName: "Queen St PO" }), rules)).toEqual([]);
    expect(draftErrors(d({ delivery: "pickup", payment: "cod" }), rules)).toEqual([]);
    expect(draftErrors(d({ delivery: "std", address: "12 King St W", payment: "cod" }), rules)).toEqual(["payment"]);
    expect(draftErrors(d({ delivery: "s711" }), rules)).toEqual(["delivery"]);
  });

  function Harness({ shop, api }: { shop: Shop; api: OrderApi }) {
    const [route, go] = useState<ShopPage>({ page: "checkout" });
    return <TProvider lang="en"><div data-testid="route">{route.page}</div><CheckoutFlow shop={shop} cur="CA$" route={route} go={go} infos={validLines(shop, [{ pid: 2, vid: null, qty: 1 }])} preview={false} onPlaced={() => {}} api={api} linkFor={() => "https://x"} /></TProvider>;
  }
  const api = () => { const placed: PlaceInput[] = []; return { placed, place: vi.fn(async (_s: string, i: PlaceInput) => { placed.push(i); return { ok: true as const, orderNo: "W-0001", token: "f".repeat(64), total: 1 }; }), load: vi.fn(async () => null), uploadReceipt: vi.fn() }; };
  beforeEach(() => localStorage.clear());
  const fill = () => { fireEvent.change(screen.getByTestId("co-name"), { target: { value: "Ann" } }); fireEvent.change(screen.getByTestId("co-phone"), { target: { value: "4165550123" } }); };
  it("Canada: the seller's options; Local pickup → no address, pay on delivery allowed; sends the ids + kinds", async () => {
    const a = api();
    render(<Harness shop={CA} api={a} />);
    expect(screen.queryByTestId("co-del-s711")).toBeNull();
    expect(screen.getByTestId("co-del-std")).toHaveTextContent("Standard shipping");
    expect(screen.getByTestId("co-del-c1abcd")).toHaveTextContent("Canada Post office");
    expect(screen.getByTestId("co-del-pickup")).toHaveTextContent("Sat 2–5pm");
    expect(screen.getByTestId("co-pay-cod")).toBeDisabled(); // std doesn't allow it
    fireEvent.click(screen.getByTestId("co-del-pickup"));
    expect(screen.queryByTestId("co-address")).toBeNull();
    expect(screen.getByTestId("co-pickup-note")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("co-pay-cod"));
    fill();
    fireEvent.click(screen.getByTestId("co-place"));
    await waitFor(() => expect(a.place).toHaveBeenCalled());
    expect(a.placed[0]).toMatchObject({ ship: "pickup", pay: "cod", delivery: "pickup", payment: "cod" });
  });
  it("a typed-store option asks for the store name", async () => {
    const a = api();
    render(<Harness shop={CA} api={a} />);
    fireEvent.click(screen.getByTestId("co-del-c1abcd"));
    fill();
    fireEvent.click(screen.getByTestId("co-place"));
    expect(await screen.findByText("Type the store name.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("co-store-name"), { target: { value: "Queen St PO" } });
    fireEvent.click(screen.getByTestId("co-place"));
    await waitFor(() => expect(a.place).toHaveBeenCalled());
    expect(a.placed[0]).toMatchObject({ ship: "c1abcd", pay: "bank", delivery: "store", payment: "bank", storeName: "Queen St PO" });
  });
  it("Taiwan (old answer): 7-11 sends ship s711 + delivery s711", async () => {
    const a = api();
    render(<Harness shop={DEMO_SHOP} api={a} />);
    expect(screen.getByTestId("co-del-s711")).toHaveTextContent("7-11");
    fill();
    fireEvent.click(screen.getByTestId("co-choose-store"));
    fireEvent.change(screen.getByTestId("st-id"), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("st-use"));
    fireEvent.click(await screen.findByTestId("co-place"));
    await waitFor(() => expect(a.place).toHaveBeenCalled());
    expect(a.placed[0]).toMatchObject({ ship: "s711", pay: "bank", delivery: "s711", payment: "bank", storeId: "123456" });
  });
});

describe("the seller's Payment & shipping screen", () => {
  const SITE = (settings: WebsiteSettings = {}): MyWebsite => ({ subdomain: "budgetukay", draft: {}, published: null, publishedAt: null, settings, customDomain: null });
  const ps = (a: PayShipApi, country = "TW") => render(<TProvider lang="en"><WebsitePayShip onToast={vi.fn()} api={a} country={country} cur="CA$" /></TProvider>);
  it("Canada: the ready list; a new option needs a name; saved as a list", async () => {
    const a: PayShipApi = { load: vi.fn(async () => SITE({ bank: { enabled: true, accountNumber: "1" } })), save: vi.fn(async () => true), uploadQr: vi.fn(async () => null) };
    ps(a, "CA");
    expect(await screen.findByTestId("wps-ship-pickup")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wps-ship-std")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("wps-ship-s711")).toBeNull();
    fireEvent.click(screen.getByTestId("wps-ship-std"));
    fireEvent.change(screen.getByTestId("wps-fee-std"), { target: { value: "15" } });
    fireEvent.click(screen.getByTestId("wps-ship-add"));
    fireEvent.click(screen.getByTestId("wps-save"));
    expect(await screen.findByTestId("wps-msg")).toHaveTextContent("Give each new shipping option a name.");
    const nameInput = screen.getAllByTestId(/^wps-ship-name-c/)[0];
    fireEvent.change(nameInput, { target: { value: "Canada Post" } });
    fireEvent.click(screen.getByTestId("wps-save"));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    const saved = (a.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as WebsiteSettings;
    expect(saved.shipOptions!.filter((x) => x.on).map((x) => `${x.id.startsWith("c") ? "new" : x.id}:${x.fee}:${x.name}`)).toEqual(["pickup:0:", "std:15:", "new:0:Canada Post"]);
  });
  it("Taiwan, nothing saved: 7-11 / FamilyMart / home as today; the fee still goes to the old field", async () => {
    const a: PayShipApi = { load: vi.fn(async () => SITE({ cod: { enabled: true } })), save: vi.fn(async () => true), uploadQr: vi.fn(async () => null) };
    ps(a);
    expect(await screen.findByTestId("wps-ship-s711")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wps-ship-home")).toHaveAttribute("aria-checked", "false");
    fireEvent.change(screen.getByTestId("wps-fee-s711"), { target: { value: "45" } });
    fireEvent.click(screen.getByTestId("wps-ship-edit-s711"));
    expect(screen.queryByTestId("wps-ship-needs-s711")).toBeNull(); // a ready option keeps what it needs
    fireEvent.click(screen.getByTestId("wps-save"));
    await waitFor(() => expect(a.save).toHaveBeenCalled());
    expect((a.save as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ ship: { s711: { enabled: true, fee: 45 } } });
  });
});

describe("sql/167 part 10 (contract)", () => {
  const sql = readFileSync("sql/167_seller_website_v2.sql", "utf8");
  it("7-11 / FamilyMart only in Taiwan; old pages still use the sql/163 path; the delivery check widened", () => {
    expect(sql).toMatch(/and \(c = 'TW' or x\.e->>'needs' not in \('store711', 'storefm'\)\)/);
    expect(sql).toMatch(/if v_ship_id is null then\n {4}v_delivery := p_order->>'delivery';/);
    expect(sql).toMatch(/check \(delivery in \('s711','fm','home','store','pickup'\)\)/);
    const rb = readFileSync("sql/167_seller_website_v2_rollback.sql", "utf8");
    expect(rb).toMatch(/if exists \(select 1 from public\.website_orders where delivery in \('store', 'pickup'\)\) then/);
  });
});
