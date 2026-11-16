// Seller Website v2 — item 12: the address form, phone shape, currency and default language follow the
// seller's country (Canada: province + postal code; Australia: state + postcode); an optional "Prices
// include tax" line (no tax is calculated). Taiwan stays exactly as today.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { TProvider } from "../../redesign/i18n";
import WebsitePayShip from "../../redesign/screens/WebsitePayShip";
import type { PayShipApi } from "../../redesign/adapters/websiteEditorApi";
import type { MyWebsite, WebsiteSettings } from "../../redesign/adapters/websiteSeller";
import { publicCheckoutV2 } from "../../redesign/adapters/websiteShipPay";
import { addrFormOf, addressErrors, composeAddress, cleanPost, phoneOk, phoneHintOf } from "../addressForm";
import { currencyFor, shopLang, type Shop } from "../shopApi";
import { draftErrors, type OrderApi, type OrderDraft, type PlaceInput } from "../orderApi";
import { CheckoutFlow } from "../checkoutPages";
import { validLines } from "../cart";
import type { ShopPage } from "../route";
import { DEMO_SHOP } from "./fixtures";

describe("address by country", () => {
  it("Canada / Australia get the parts; everywhere else one box", () => {
    expect([addrFormOf("CA"), addrFormOf("ca"), addrFormOf("AU"), addrFormOf("TW"), addrFormOf("PH"), addrFormOf("")]).toEqual(["CA", "CA", "AU", "free", "free", "free"]);
  });
  it("Canada: province + postal code A1A 1A1", () => {
    expect(cleanPost("CA", " m5h2n2 ")).toBe("M5H 2N2");
    expect(cleanPost("CA", "m5h-2n2")).toBe("M5H 2N2");
    expect(addressErrors("CA", { street: "12 King St W", city: "Toronto", region: "ON", post: "m5h 2n2" })).toEqual([]);
    expect(addressErrors("CA", { street: "", city: "", region: "XX", post: "12345" })).toEqual(["street", "city", "region", "post"]);
    expect(addressErrors("CA", { street: "1 Main", city: "Calgary", region: "AB", post: "D1A 1A1" })).toEqual(["post"]); // D is never a first letter
    expect(composeAddress("CA", { street: " 12 King St W ", city: "Toronto", region: "ON", post: "m5h2n2" }, "")).toBe("12 King St W, Toronto, ON M5H 2N2");
  });
  it("Australia: state + 4-digit postcode", () => {
    expect(addressErrors("AU", { street: "1 George St", city: "Sydney", region: "NSW", post: "2000" })).toEqual([]);
    expect(addressErrors("AU", { street: "1 George St", city: "Sydney", region: "ON", post: "200" })).toEqual(["region", "post"]);
    expect(composeAddress("AU", { street: "1 George St", city: "Sydney", region: "NSW", post: "2000" }, "")).toBe("1 George St, Sydney NSW 2000");
  });
  it("the one box elsewhere, as today", () => {
    expect(composeAddress("free", { street: "", city: "", region: "", post: "" }, "  No. 1, Xinyi Rd  ")).toBe("No. 1, Xinyi Rd");
  });
});

describe("phone, currency, language", () => {
  it("phone shape by country (Taiwan: as today, 8–15 digits)", () => {
    expect([phoneOk("TW", "0912345678"), phoneOk("TW", "1234567"), phoneOk("", "12345678")]).toEqual([true, false, true]);
    expect([phoneOk("CA", "(416) 555-0123"), phoneOk("CA", "1 416 555 0123"), phoneOk("CA", "41655501")]).toEqual([true, true, false]);
    expect([phoneOk("AU", "0412 345 678"), phoneOk("AU", "+61 412 345 678"), phoneOk("AU", "0912345678")]).toEqual([true, true, false]);
    expect([phoneOk("PH", "0917 123 4567"), phoneOk("PH", "+63 917 123 4567"), phoneOk("PH", "0817 123 4567")]).toEqual([true, true, false]);
    expect([phoneHintOf("CA"), phoneHintOf("AU"), phoneHintOf("XX")]).toEqual(["416 555 0123", "0412 345 678", ""]);
  });
  it("currency follows the country unless the seller picked one", () => {
    const s = (country: string, currency?: string) => ({ ...DEMO_SHOP, country, shop: { ...DEMO_SHOP.shop, currency } }) as Shop;
    expect(["TW", "PH", "CA", "AU", "US", "XX"].map((c) => currencyFor(s(c)))).toEqual(["NT$", "₱", "CA$", "A$", "US$", "$"]);
    expect(currencyFor(s("CA", "C$"))).toBe("C$");
  });
  it("default language: Taiwan 繁體中文; the Philippines, Canada, Australia English", () => {
    expect(["TW", "PH", "CA", "AU"].map((c) => shopLang({ ...DEMO_SHOP, country: c, shop: { ...DEMO_SHOP.shop, lang: undefined } }, null))).toEqual(["zh-TW", "en", "en", "en"]);
  });
});

describe("the tax line", () => {
  it("only when the seller turns it on", () => {
    expect(publicCheckoutV2({ taxIncluded: true }, "CA").taxIncluded).toBe(true);
    expect("taxIncluded" in publicCheckoutV2({}, "CA")).toBe(false);
  });
  it("the seller's switch", async () => {
    const site: MyWebsite = { subdomain: "s", draft: {}, published: null, publishedAt: null, settings: { bank: { enabled: true, accountNumber: "1" } }, customDomain: null };
    const a: PayShipApi = { load: vi.fn(async () => site), save: vi.fn(async () => true), uploadQr: vi.fn(async () => null) };
    render(<TProvider lang="en"><WebsitePayShip onToast={vi.fn()} api={a} country="CA" cur="CA$" /></TProvider>);
    fireEvent.click(await screen.findByTestId("wps-tax"));
    fireEvent.click(screen.getByTestId("wps-save"));
    await waitFor(() => expect(a.save).toHaveBeenCalled());
    expect(((a.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as WebsiteSettings).taxIncluded).toBe(true);
  });
});

// ── a Canada and an Australia checkout, end to end (the browser side) ─────────
const shopOf = (country: "CA" | "AU"): Shop => ({ ...DEMO_SHOP, country, shop: { ...DEMO_SHOP.shop, currency: undefined },
  checkout: { ship: {}, autoCancelHours: 24 },
  checkout2: { options: [{ id: "std", needs: "address", fee: country === "CA" ? 15 : 12, freeOver: 150, cod: false }, { id: "pickup", needs: "none", fee: 0, cod: true }],
    methods: country === "CA" ? [{ id: "interac", kind: "first", info: "Send to pay@shop.ca" }] : [{ id: "payid", kind: "first", info: "PayID 0412 345 678" }], autoCancelHours: 24, taxIncluded: true } });
function Flow({ shop, api }: { shop: Shop; api: OrderApi }) {
  const [r, go] = useState<ShopPage>({ page: "checkout" });
  return <TProvider lang="en"><div data-testid="route">{r.page}</div><CheckoutFlow shop={shop} cur={currencyFor(shop)} route={r} go={go} infos={validLines(shop, [{ pid: 2, vid: null, qty: 1 }])} preview={false} onPlaced={() => {}} api={api} linkFor={() => "x"} /></TProvider>;
}
const fakeApi = () => { const placed: PlaceInput[] = []; return { placed, place: vi.fn(async (_s: string, i: PlaceInput) => { placed.push(i); return { ok: true as const, orderNo: "W-0001", token: "f".repeat(64), total: 1 }; }), load: vi.fn(async () => null), uploadReceipt: vi.fn() }; };
const type = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
beforeEach(() => localStorage.clear());

describe("Canada checkout", () => {
  it("province + postal code, CA$ prices, tax line; one address line sent", async () => {
    const a = fakeApi();
    render(<Flow shop={shopOf("CA")} api={a} />);
    expect(screen.getByTestId("co-total")).toHaveTextContent("CA$");
    expect(screen.getByTestId("co-tax")).toHaveTextContent("Prices include tax");
    expect(screen.getByTestId("co-phone")).toHaveAttribute("placeholder", "416 555 0123");
    expect(screen.getByTestId("co-addr-form")).toHaveTextContent("Province");
    type("co-name", "Ann Lee"); type("co-phone", "416 555 0199");
    type("co-addr-street", "12 King St W"); type("co-addr-city", "Toronto"); type("co-addr-post", "m5h 2n");
    fireEvent.click(screen.getByTestId("co-place"));
    expect(await screen.findByText("Fill in the street, city and province / state.")).toBeInTheDocument();
    expect(screen.getByText("Enter a postal code like A1A 1A1.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("co-addr-region"), { target: { value: "ON" } });
    type("co-addr-post", "m5h2n2");
    fireEvent.click(screen.getByTestId("co-place"));
    await waitFor(() => expect(a.place).toHaveBeenCalled());
    expect(a.placed[0]).toMatchObject({ ship: "std", pay: "interac", delivery: "home", payment: "bank", address: "12 King St W, Toronto, ON M5H 2N2", phone: "416 555 0199" });
  });
  it("a Canadian phone of the wrong length is refused before sending", async () => {
    const a = fakeApi();
    render(<Flow shop={shopOf("CA")} api={a} />);
    type("co-name", "Ann"); type("co-phone", "4165550"); fireEvent.click(screen.getByTestId("co-del-pickup"));
    fireEvent.click(screen.getByTestId("co-place"));
    expect(await screen.findByText("Enter a valid mobile number.")).toBeInTheDocument();
    expect(a.place).not.toHaveBeenCalled();
  });
});

describe("Australia checkout", () => {
  it("suburb + state + postcode, A$ prices; one address line sent", async () => {
    const a = fakeApi();
    render(<Flow shop={shopOf("AU")} api={a} />);
    expect(screen.getByTestId("co-total")).toHaveTextContent("A$");
    expect(screen.getByTestId("co-addr-form")).toHaveTextContent("Suburb");
    expect(screen.getByTestId("co-addr-form")).toHaveTextContent("Postcode");
    type("co-name", "Sam"); type("co-phone", "0412 345 678");
    type("co-addr-street", "1 George St"); type("co-addr-city", "Sydney"); fireEvent.change(screen.getByTestId("co-addr-region"), { target: { value: "NSW" } }); type("co-addr-post", "2000");
    fireEvent.click(screen.getByTestId("co-place"));
    await waitFor(() => expect(a.place).toHaveBeenCalled());
    expect(a.placed[0]).toMatchObject({ ship: "std", pay: "payid", address: "1 George St, Sydney NSW 2000" });
  });
});

describe("Taiwan unchanged", () => {
  it("one address box, no tax line, NT$", () => {
    const d = (o: Partial<OrderDraft>): OrderDraft => ({ name: "A", phone: "0912345678", contact: "", delivery: "home", storeId: "", storeName: "", address: "No. 1, Xinyi Rd", payment: "bank", note: "", ...o });
    expect(draftErrors(d({}), { delivery: ["home"], payment: ["bank"], country: "TW" })).toEqual([]);
    render(<Flow shop={DEMO_SHOP} api={fakeApi()} />);
    fireEvent.click(screen.getByTestId("co-del-home"));
    expect(screen.getByTestId("co-address")).toBeInTheDocument();
    expect(screen.queryByTestId("co-addr-form")).toBeNull();
    expect(screen.queryByTestId("co-tax")).toBeNull();
  });
});

describe("sql/165 part 12 (contract)", () => {
  it("taxIncluded only when on; nothing calculated", () => {
    const sql = readFileSync("sql/165_seller_website_v2.sql", "utf8");
    expect(sql).toMatch(/when public\.website_bool\(s->>'taxIncluded', false\) then '\{"taxIncluded": true\}'::jsonb/);
    expect(sql).not.toMatch(/tax_rate|tax_amount/);
  });
});
