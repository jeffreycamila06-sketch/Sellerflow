// Seller Website v2 — item 4: the product page. Gallery + thumbnails, colour / size buttons (sold-out
// disabled, never a dropdown), "only N left", quantity up to stock, the total with the cheapest delivery
// near the buy buttons, payment methods, return policy, item details, size guide, You may also like,
// sticky Add to cart / Buy now on phones.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { cheapestDelivery, relatedProducts } from "../pages/productData";
import type { Shop, ShopProduct } from "../shopApi";
import type { CheckoutV2 } from "../shipPay";
import { DEMO_SHOP } from "./fixtures";

const EN = (d: Partial<Shop["shop"]> = {}, o: Partial<Shop> = {}): Shop => ({ ...DEMO_SHOP, ...o, shop: { ...DEMO_SHOP.shop, lang: "en", ...d } });
const open = (shop: Shop, id = 1) => render(<ShopApp preview={shop} startRoute={{ page: "product", id }} />);

describe("helpers", () => {
  const ck: CheckoutV2 = { options: [{ id: "home", needs: "address", fee: 120, cod: false }, { id: "s711", needs: "store711", fee: 60, freeOver: 500, cod: true }], methods: [], autoCancelHours: 24 };
  it("cheapest delivery counts the free-over", () => {
    expect(cheapestDelivery(ck, 300)).toMatchObject({ fee: 60, opt: { id: "s711" } });
    expect(cheapestDelivery(ck, 600)).toMatchObject({ fee: 0 });
    expect(cheapestDelivery({ ...ck, options: [] }, 1)).toBeNull();
  });
  it("related: same category first, in stock first, never itself", () => {
    const P = (id: number, category: string, stock = 1): ShopProduct => ({ id, name: `${id}`, price: 1, stock, photos: [], category });
    expect(relatedProducts([P(1, "A"), P(2, "B"), P(3, "A", 0), P(4, "A")], P(1, "A")).map((x) => x.id)).toEqual([4, 3, 2]);
  });
});

describe("the page", () => {
  it("options are buttons; sold-out values disabled; 'only N left'; quantity stops at the stock", () => {
    open(EN());
    expect(screen.getByTestId("pd-page").querySelector("select")).toBeNull();
    const xl = screen.getAllByTestId("pd-opt").find((o) => o.textContent === "XL") as HTMLButtonElement;
    expect(xl.disabled).toBe(true);
    fireEvent.click(screen.getAllByTestId("pd-opt").find((o) => o.textContent === "M")!);
    fireEvent.click(screen.getAllByTestId("pd-opt").find((o) => o.textContent === "Blue")!);
    expect(screen.getByTestId("pd-left")).toHaveTextContent("Only 2 left");
    fireEvent.click(screen.getByTestId("pd-plus"));
    expect(screen.getByTestId("pd-plus")).toBeDisabled();
    expect(screen.getByTestId("pd-qty")).toHaveTextContent("2");
  });
  it("the total with the cheapest delivery, how to pay, the return policy", () => {
    open(EN(), 2);
    expect(screen.getByTestId("pd-total")).toHaveTextContent("Total from NT$340");
    expect(screen.getByTestId("pd-total")).toHaveTextContent("with 7-11 (NT$60)");
    expect(screen.getByTestId("pd-pay")).toHaveTextContent("Bank transfer");
    fireEvent.click(within(screen.getByTestId("pd-returns")).getByText("see policy"));
    expect(screen.getByTestId("shop-sheet")).toHaveTextContent("Message us within 3 days");
  });
  it("old price, -%, condition, size guide, colour swatches", () => {
    const p: ShopProduct = { id: 9, name: "Tee", price: 280, stock: 3, photos: ["u/a.jpg", "u/b.jpg"], oldPrice: 400, condition: "9/10", sizeGuide: "M · chest 52 cm",
      groups: [{ name: "Color", values: ["Purple"], color: true, swatches: { Purple: "#7C3AED" } }, { name: "Size", values: ["M"] }], variants: [{ id: 91, values: ["Purple", "M"], price: 280, stock: 3, photo: null }] };
    open(EN({}, { products: [p, ...DEMO_SHOP.products] }), 9);
    expect(screen.getByTestId("pd-was")).toHaveTextContent("NT$400");
    expect(screen.getByText("-30%")).toBeInTheDocument();
    expect(screen.getByTestId("pd-desc")).toHaveTextContent("9/10");
    expect((screen.getAllByTestId("pd-opt")[0].querySelector("i") as HTMLElement).style.background).toContain("124, 58, 237");
    fireEvent.click(screen.getByTestId("pd-size-guide"));
    expect(screen.getByTestId("pd-size-text")).toHaveTextContent("chest 52 cm");
    expect(screen.getByTestId("pd-count")).toHaveTextContent("1 / 2");
  });
  it("You may also like + the phone buy bar (Buy now → checkout)", () => {
    open(EN(), 2);
    expect(within(screen.getByTestId("pd-related")).getAllByTestId("shop-item").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("pd-buy"));
    expect(screen.getByTestId("co-place")).toBeInTheDocument();
  });
  it("sold out: Sold out on the button, nothing to add", () => {
    open(EN(), 4);
    expect(screen.getByTestId("pd-soldout")).toBeInTheDocument();
    expect(screen.getByTestId("pd-buy")).toBeDisabled();
    expect(screen.getByTestId("pd-buy")).toHaveTextContent("Sold out");
  });
});
