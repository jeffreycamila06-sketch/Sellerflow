// Seller Website Part 1 — the Products screen: website off = no Website button and the screen as before;
// variant rows never show as their own card; the sheet saves the parent (stock untouched) + one row per
// combination (new rows with their stock, existing rows without a changed stock → stock not written);
// deleting a product removes its variants too.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { Product } from "../../adapters/products";

const h = vi.hoisted(() => ({ products: [] as Product[], save: vi.fn(async (_p: Product, _o?: { skipStock?: boolean }) => ({ ok: true })), del: vi.fn(async (_id: number) => true) }));
vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: async () => ({ products: h.products, source: "db" }),
  saveProductDbResult: (p: Product, o?: { skipStock?: boolean }) => h.save(p, o),
  deleteProductDb: (id: number) => h.del(id),
  adjustProductStock: async () => null,
}));
import Products from "../Products";

const P = (over: Partial<Product> = {}): Product => ({ id: 1, name: "Floral dress", sku: "FD", price: 350, stock: 10, platform: "TikTok", status: "Active", liveCode: "A01", ...over });
const KID = P({ id: 9, name: "Floral dress · S", liveCode: "A01-S", stock: 3, status: "Low stock", parentId: 1, variant: { values: ["S"] } });
async function mount(products: Product[], website: boolean) {
  h.products = products;
  const onChanged = vi.fn();
  render(<TProvider lang="en"><Products cur="NT$" onProductsChanged={onChanged} website={website} /></TProvider>);
  await act(async () => { await Promise.resolve(); });
  return onChanged;
}
beforeEach(() => { localStorage.clear(); h.save.mockClear(); h.del.mockClear(); vi.spyOn(window, "confirm").mockReturnValue(true); });

describe("Products — Seller Website", () => {
  it("website off: no Website button; a catalog without variants shows every product", async () => {
    await mount([P(), P({ id: 2, name: "Shirt", liveCode: "A02" })], false);
    expect(screen.queryByTestId("prd-web-1")).toBeNull();
    expect(screen.getByText("Floral dress")).toBeTruthy();
    expect(screen.getByText("Shirt")).toBeTruthy();
  });
  it("variant rows never show as their own card (even with the website off)", async () => {
    await mount([P(), KID], false);
    expect(screen.queryByText("Floral dress · S")).toBeNull();
    expect(screen.queryByTestId("stock-val-9")).toBeNull();
  });
  it("website on: the card shows Website · 1 variants + the parent-code hint", async () => {
    await mount([P(), KID], true);
    expect(screen.getByTestId("prd-web-1").textContent).toBe("Website · 1 variants");
    expect(screen.getByTestId("prd-parent-hint-1").textContent).toContain("A01");
  });
  it("the sheet saves the parent without its stock and creates one row per combination with its stock", async () => {
    const onChanged = await mount([P({ liveCode: "A01" })], true);
    fireEvent.click(screen.getByTestId("prd-web-1"));
    fireEvent.change(screen.getByTestId("pws-category"), { target: { value: "Dresses" } });
    fireEvent.click(screen.getByTestId("pws-add-group"));
    fireEvent.change(screen.getByTestId("pws-group-name"), { target: { value: "Size" } });
    fireEvent.change(screen.getByTestId("pws-group-values"), { target: { value: "M, L" } });
    const rows = screen.getAllByTestId("pws-row");
    expect(rows).toHaveLength(2);
    expect((screen.getAllByTestId("pws-row-code")[0] as HTMLInputElement).value).toBe("A01-M");
    fireEvent.change(screen.getAllByTestId("pws-row-stock")[0], { target: { value: "4" } });
    await act(async () => { fireEvent.click(screen.getByTestId("pws-save")); await Promise.resolve(); });
    const calls = h.save.mock.calls.map(([p, o]) => ({ id: p.id, code: p.liveCode, stock: p.stock, parentId: p.parentId, skip: !!o?.skipStock, category: p.category }));
    expect(calls[0]).toMatchObject({ id: 1, skip: true, category: "Dresses" });
    expect(calls.slice(1).map((c) => [c.code, c.stock, c.parentId, c.skip])).toEqual([["A01-M", 4, 1, false], ["A01-L", 0, 1, false]]);
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByTestId("pws")).toBeNull();
  });
  it("deleting a product removes its variants too", async () => {
    await mount([P(), KID], true);
    await act(async () => { fireEvent.click(screen.getAllByText("Delete")[0]); await Promise.resolve(); });
    expect(h.del.mock.calls.map((c) => c[0]).sort()).toEqual([1, 9]);
  });
});

describe("Products — a product with variants shows the variants' total (display only)", () => {
  it("stock = sum of its variants, +/− off; a product without variants is unchanged", async () => {
    await mount([P({ stock: 0, status: "Out of stock" }), KID, P({ id: 5, name: "Shirt", liveCode: "A02", stock: 4 })], true);
    expect(screen.getByTestId("stock-val-1").textContent).toBe("3");
    expect(screen.getByTestId("stock-inc-1")).toBeDisabled();
    expect(screen.getByTestId("stock-dec-1")).toBeDisabled();
    expect(screen.getByTestId("stock-val-5").textContent).toBe("4");
    expect(screen.getByTestId("stock-inc-5")).not.toBeDisabled();
  });
  it("Edit opens the REAL product (its own stock 0), never the total", async () => {
    await mount([P({ stock: 0, status: "Out of stock" }), KID], true);
    fireEvent.click(screen.getAllByText("Edit")[0]);
    const stock = screen.getAllByRole("spinbutton").concat(screen.queryAllByRole("textbox")).find((el) => (el as HTMLInputElement).value === "0" || (el as HTMLInputElement).value === "3") as HTMLInputElement | undefined;
    expect(stock?.value).toBe("0");
  });
});
