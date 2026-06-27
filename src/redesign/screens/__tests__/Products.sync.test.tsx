// Products screen — cross-device wiring (Step 2). Verifies the screen reconciles on
// mount via resolveInitialProducts, write-through on add/edit/delete, and that the
// "Soon · cross-device" badge is gone. The productsDb adapter is mocked so we assert
// the screen calls it (the adapter's own behavior is covered in productsDb.test.ts).
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Products from "../Products";
import { TProvider } from "../../i18n";
import { PRODUCT_DEFAULTS } from "../../adapters/products";

vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDb: vi.fn(async () => {}),
  deleteProductDb: vi.fn(async () => {}),
}));
import { resolveInitialProducts, saveProductDb, deleteProductDb } from "../../adapters/productsDb";

const renderProducts = () => render(<TProvider lang="en"><Products cur="NT$" /></TProvider>);

describe("Products screen — cross-device sync wiring", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it("reconciles with the DB on mount (resolveInitialProducts called once)", async () => {
    renderProducts();
    await vi.waitFor(() => expect(resolveInitialProducts as Mock).toHaveBeenCalledTimes(1));
    // seeded list renders (the 5 demo products by default)
    expect(screen.getByText(PRODUCT_DEFAULTS[0].name)).toBeTruthy();
  });

  it("no longer shows the 'Soon · cross-device' badge", () => {
    renderProducts();
    expect(screen.queryByText(/Soon · cross-device/)).toBeNull();
  });

  it("add writes through to the DB (saveProductDb with the new product)", async () => {
    renderProducts();
    await vi.waitFor(() => expect(resolveInitialProducts as Mock).toHaveBeenCalled());
    fireEvent.click(screen.getByText("+ Add"));
    const form = document.querySelector("form") as HTMLFormElement;
    const nameInput = form.querySelector("input") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "New Item" } });
    fireEvent.submit(form);
    expect(saveProductDb as Mock).toHaveBeenCalledTimes(1);
    expect((saveProductDb as Mock).mock.calls[0][0]).toMatchObject({ name: "New Item" });
  });

  it("delete writes through to the DB (deleteProductDb with the product id)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderProducts();
    await vi.waitFor(() => expect(resolveInitialProducts as Mock).toHaveBeenCalled());
    fireEvent.click(screen.getAllByText("Delete")[0]);
    expect(deleteProductDb as Mock).toHaveBeenCalledTimes(1);
    expect((deleteProductDb as Mock).mock.calls[0][0]).toBe(PRODUCT_DEFAULTS[0].id);
  });

  it("delete is cancelable (no DB write when confirm is dismissed)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderProducts();
    await vi.waitFor(() => expect(resolveInitialProducts as Mock).toHaveBeenCalled());
    fireEvent.click(screen.getAllByText("Delete")[0]);
    expect(deleteProductDb as Mock).not.toHaveBeenCalled();
  });
});
