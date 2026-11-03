// A Malaysia seller (RM) saves price 2.90 in Products: the input takes cents (step 0.01,
// decimal keypad), the saved product shows RM2.90 (not 2.9 / 3); NT$ whole prices unchanged.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Products from "../Products";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDbResult: vi.fn(async () => ({ ok: true })),
  deleteProductDb: vi.fn(async () => true),
}));

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
beforeEach(() => { localStorage.clear(); });

async function addProduct(cur: string, price: string) {
  render(<TProvider lang="en"><Products cur={cur} /></TProvider>);
  fireEvent.click(screen.getByText("+ Add"));
  const priceInput = (await screen.findByTestId("prd-price")) as HTMLInputElement;
  const form = priceInput.closest("form")!;
  fireEvent.change(form.querySelector('input[required]:not([type])') as HTMLInputElement, { target: { value: "Tudung" } });
  fireEvent.change(priceInput, { target: { value: price } });
  fireEvent.change(screen.getByTestId("prd-stock"), { target: { value: "5" } });
  fireEvent.submit(form);
  return priceInput;
}

describe("Products — decimal price", () => {
  it("price input: type=number step=0.01 inputMode=decimal; stock input: whole numbers only", async () => {
    render(<TProvider lang="en"><Products cur="RM" /></TProvider>);
    fireEvent.click(screen.getByText("+ Add"));
    const price = (await screen.findByTestId("prd-price")) as HTMLInputElement;
    expect(price.type).toBe("number");
    expect(price.step).toBe("0.01");
    expect(price.inputMode).toBe("decimal");
    const stock = screen.getByTestId("prd-stock") as HTMLInputElement;
    expect(stock.step).toBe("");
    expect(stock.inputMode).toBe("numeric");
  });

  it("RM 2.90 saves and shows RM2.90", async () => {
    await addProduct("RM", "2.90");
    expect(await screen.findByText("RM2.90")).toBeTruthy();
    expect(screen.queryByText("RM2.9")).toBeNull();
    expect(screen.queryByText("RM3")).toBeNull();
    const stored = JSON.parse(localStorage.getItem("sf_prods") || "[]").find((p: { name: string }) => p.name === "Tudung");
    expect(stored.price).toBe(2.9);
    expect(stored.stock).toBe(5);
  });

  it("NT$ 350 shows NT$350 exactly as before", async () => {
    await addProduct("NT$", "350");
    expect((await screen.findAllByText("NT$350")).length).toBeGreaterThan(0);
    expect(screen.queryByText("NT$350.00")).toBeNull();
    expect(JSON.parse(localStorage.getItem("sf_prods") || "[]").find((p: { name: string }) => p.name === "Tudung").price).toBe(350);
  });
});
