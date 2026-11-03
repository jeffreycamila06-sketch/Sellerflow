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
  it("RM: text input with the decimal keypad; ',' typed → '.'; stock stays a whole-number input", async () => {
    render(<TProvider lang="en"><Products cur="RM" /></TProvider>);
    fireEvent.click(screen.getByText("+ Add"));
    const price = (await screen.findByTestId("prd-price")) as HTMLInputElement;
    expect(price.type).toBe("text");
    expect(price.inputMode).toBe("decimal");
    expect(price.required).toBe(true);
    fireEvent.change(price, { target: { value: "2,90" } });
    expect(price.value).toBe("2.90");
    fireEvent.change(price, { target: { value: "2.905" } });
    expect(price.value).toBe("2.90");
    const stock = screen.getByTestId("prd-stock") as HTMLInputElement;
    expect(stock.type).toBe("number");
    expect(stock.inputMode).toBe("numeric");
  });

  it("NT$: numeric keypad, digits only (origin/main behaviour)", async () => {
    render(<TProvider lang="en"><Products cur="NT$" /></TProvider>);
    fireEvent.click(screen.getByText("+ Add"));
    const price = (await screen.findByTestId("prd-price")) as HTMLInputElement;
    expect(price.inputMode).toBe("numeric");
    fireEvent.change(price, { target: { value: "1,200" } });
    expect(price.value).toBe("1200");
    fireEvent.change(price, { target: { value: "2.90" } });
    expect(price.value).toBe("290");
  });

  it("RM 2,90 (comma keypad) saves as 2.9 and shows RM2.90", async () => {
    await addProduct("RM", "2,90");
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
