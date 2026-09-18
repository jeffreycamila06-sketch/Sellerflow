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

  it("M1: unmounting with an un-flushed delta STILL writes it (no silently-lost edit)", async () => {
    vi.useFakeTimers();
    adjust.mockResolvedValue(13);
    const { getByTestId, unmount } = await mount([P({ stock: 10 })]);
    for (let i = 0; i < 3; i++) fireEvent.click(getByTestId("stock-inc-1"));
    expect(adjust).not.toHaveBeenCalled();          // debounce hasn't fired yet
    unmount();                                       // navigate-away before the 600ms flush
    expect(adjust).toHaveBeenCalledTimes(1);         // flushed on unmount
    expect(adjust).toHaveBeenCalledWith(1, 3);       // the pending +3 persisted
  });

  it("M1: an id already mid-write is NOT double-flushed on unmount (its resolve handles the rest)", async () => {
    vi.useFakeTimers();
    let resolveRpc!: (v: number | null) => void;
    adjust.mockImplementation(() => new Promise<number | null>((r) => { resolveRpc = r; }));
    const { getByTestId, unmount } = await mount([P({ stock: 10 })]);
    fireEvent.click(getByTestId("stock-inc-1"));      // +1
    await act(async () => { await vi.advanceTimersByTimeAsync(650); }); // flush → RPC in flight
    expect(adjust).toHaveBeenCalledTimes(1);
    unmount();                                        // in-flight id → cleanup must NOT re-fire
    expect(adjust).toHaveBeenCalledTimes(1);          // still one call (no double-apply)
    resolveRpc(11);                                   // let it settle (no post-unmount crash)
  });

  it("C1: a tap DURING an in-flight write does NOT dip the display", async () => {
    vi.useFakeTimers();
    const resolvers: Array<(v: number | null) => void> = [];
    adjust.mockImplementation(() => new Promise<number | null>((r) => { resolvers.push(r); }));
    const { getByTestId } = await mount([P({ stock: 10 })]);
    for (let i = 0; i < 5; i++) fireEvent.click(getByTestId("stock-inc-1")); // +5 → display 15
    expect(getByTestId("stock-val-1").textContent).toBe("15");
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });       // flush → RPC(+5) in flight
    expect(adjust).toHaveBeenCalledWith(1, 5);

    fireEvent.click(getByTestId("stock-inc-1"));                              // tap during the in-flight write
    expect(getByTestId("stock-val-1").textContent).toBe("16");               // C1: 15 + 1, NOT a dip to 11

    await act(async () => { resolvers[0](15); await Promise.resolve(); });    // first write settles (10+5=15)
    expect(getByTestId("stock-val-1").textContent).toBe("16");               // stays 16 (authoritative 15 + pending 1)
    await act(async () => { await vi.advanceTimersByTimeAsync(0); if (resolvers[1]) resolvers[1](16); await Promise.resolve(); });
    expect(getByTestId("stock-val-1").textContent).toBe("16");               // re-flush(+1) settles to 16
  });
});
