// Products — QUICK STOCK EDIT (− / +) safety. The write is race-safe by construction
// (atomic adjust_product_stock RPC, proven in adjustProductStockSql.test.ts + live
// MCP); these tests pin the CLIENT contract that the user emphasized:
//   • 5 rapid + taps = exactly ONE settled write of +5 (debounced delta, not 5 writes),
//   • on success the card shows the RPC's AUTHORITATIVE returned stock,
//   • on failure the on-screen number REVERTS (never shows a stock that didn't persist),
//   • − is disabled at 0 (never drives stock negative).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { Product } from "../../adapters/products";

const { resolveProducts, adjust } = vi.hoisted(() => ({
  resolveProducts: { current: [] as Product[] },
  adjust: vi.fn<(id: number, delta: number) => Promise<number | null>>(),
}));

vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: async () => ({ products: resolveProducts.current, source: "db" }),
  saveProductDbResult: async () => ({ ok: true }),
  deleteProductDb: async () => true,
  adjustProductStock: (id: number, delta: number) => adjust(id, delta),
}));

import Products from "../Products";

const P = (over: Partial<Product> = {}): Product => ({ id: 1, name: "Red dress", sku: "RD-1", price: 350, stock: 10, platform: "TikTok", status: "Active", liveCode: "", ...over });

async function mount(products: Product[]) {
  resolveProducts.current = products;
  const onChanged = vi.fn();
  const utils = render(<TProvider lang="en"><Products cur="NT$" onProductsChanged={onChanged} /></TProvider>);
  await act(async () => { await Promise.resolve(); }); // flush the mount resolve effect
  return { ...utils, onChanged };
}

beforeEach(() => { localStorage.clear(); adjust.mockReset(); adjust.mockResolvedValue(null); });
afterEach(() => { vi.useRealTimers(); });

describe("quick stock edit — debounced atomic write", () => {
  it("5 rapid + taps = ONE write of +5; card shows the authoritative returned stock", async () => {
    vi.useFakeTimers();
    adjust.mockResolvedValue(15); // DB 10 + summed delta 5
    const { getByTestId, onChanged } = await mount([P({ stock: 10 })]);

    for (let i = 0; i < 5; i++) fireEvent.click(getByTestId("stock-inc-1"));
    expect(getByTestId("stock-val-1").textContent).toBe("15");   // optimistic +5 immediately
    expect(adjust).not.toHaveBeenCalled();               // nothing sent yet (debounced)

    await act(async () => { await vi.runAllTimersAsync(); });     // fire debounce + settle the RPC
    expect(adjust).toHaveBeenCalledTimes(1);             // ONE write, not five
    expect(adjust).toHaveBeenCalledWith(1, 5);           // summed delta +5
    expect(getByTestId("stock-val-1").textContent).toBe("15");   // authoritative value
    expect(onChanged).toHaveBeenCalledWith(expect.anything(), 1, "stock"); // re-seeds Auto-mode stock
  });

  it("shows the AUTHORITATIVE stock even when a concurrent auto-order decremented it", async () => {
    vi.useFakeTimers();
    // seller taps +2 but an auto-order took 1 concurrently → DB returns 10+2-1 = 11
    adjust.mockResolvedValue(11);
    const { getByTestId } = await mount([P({ stock: 10 })]);
    fireEvent.click(getByTestId("stock-inc-1"));
    fireEvent.click(getByTestId("stock-inc-1"));
    expect(getByTestId("stock-val-1").textContent).toBe("12");   // optimistic (doesn't know about the auto-order yet)
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(getByTestId("stock-val-1").textContent).toBe("11");   // reconciled to the DB truth
  });

  it("on write FAILURE the number REVERTS to the pre-tap value + a note shows", async () => {
    vi.useFakeTimers();
    adjust.mockResolvedValue(null); // RPC error
    const { getByTestId, queryByText } = await mount([P({ stock: 8 })]);
    fireEvent.click(getByTestId("stock-inc-1"));
    fireEvent.click(getByTestId("stock-inc-1"));
    expect(getByTestId("stock-val-1").textContent).toBe("10");   // optimistic
    // advance ONLY past the debounce + settle the RPC (not the 3200ms note-auto-clear)
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    expect(adjust).toHaveBeenCalledTimes(1);
    expect(getByTestId("stock-val-1").textContent).toBe("8");    // reverted — never shows an unpersisted stock
    expect(queryByText(/didn't save|reverted/i)).toBeTruthy();   // failure note
  });

  it("− is disabled at 0 (never drives stock below 0)", async () => {
    const { getByTestId } = await mount([P({ stock: 0, status: "Out of stock" })]);
    expect((getByTestId("stock-dec-1") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("stock-inc-1") as HTMLButtonElement).disabled).toBe(false);
  });
});
