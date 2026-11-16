// Seller Website audit 6 — the stock history shows website orders ("Website order · W-0012") next to
// the live reasons, which keep their labels.
import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { Product } from "../../adapters/products";

const P: Product = { id: 1, name: "Shirt", sku: "S", price: 280, stock: 6, platform: "TikTok", status: "Active", liveCode: "A02" };
vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: async () => ({ products: [P], source: "db" }),
  saveProductDbResult: vi.fn(async () => ({ ok: true })), deleteProductDb: vi.fn(async () => true),
  adjustProductStock: vi.fn(async () => 6), adjustStockLogged: vi.fn(async () => 6), restockProduct: vi.fn(async () => 6), logStockMovement: vi.fn(async () => true),
  loadStockMovements: vi.fn(async () => [
    { delta: 2, reason: "website", orderRef: "W-0012", createdAt: "2026-11-15T03:00:00Z" },
    { delta: -2, reason: "website", orderRef: "W-0012", createdAt: "2026-11-15T02:00:00Z" },
    { delta: -1, reason: "auto_order", orderRef: "c1", createdAt: "2026-11-15T01:00:00Z" },
  ]),
}));
import Products from "../Products";

describe("stock history — website orders", () => {
  it("'Website order · W-0012' for the sale and the stock coming back; live rows keep their label", async () => {
    render(<TProvider lang="en"><Products cur="NT$" inventoryV2 /></TProvider>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByTestId("history-1")); await Promise.resolve(); });
    expect(screen.getByTestId("history-row-0").textContent).toContain("+2Website order · W-0012");
    expect(screen.getByTestId("history-row-1").textContent).toContain("-2Website order · W-0012");
    expect(screen.getByTestId("history-row-2").textContent).not.toContain("Website");
    expect(screen.getByTestId("history-row-2").textContent).not.toContain("c1");
  });
});
