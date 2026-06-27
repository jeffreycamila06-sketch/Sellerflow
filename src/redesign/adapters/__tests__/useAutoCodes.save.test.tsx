// Step 5b — on a SUCCESSFUL save, useAutoCodes fires onSaved with the persisted code
// list + a {productLocalId → stock} map, so RedesignApp can lift it straight into the
// live matcher refs (immediate apply, no reload). autoCodesDb + productsDb are mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../autoCodesDb", () => ({ loadCodes: vi.fn(async () => []), saveCodes: vi.fn(async () => true) }));
vi.mock("../productsDb", () => ({
  resolveInitialProducts: vi.fn(async () => ({
    products: [{ id: 11, name: "Tee", sku: "T-1", price: 150, stock: 5, platform: "TikTok", status: "Active" }],
    source: "local",
  })),
  saveProductDb: vi.fn(async () => {}),
}));

import { useAutoCodes } from "../useAutoCodes";
import { saveCodes } from "../autoCodesDb";

describe("useAutoCodes.save → onSaved (immediate apply contract)", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it("persists then hands back the saved codes + stock map", async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAutoCodes(true, onSaved));
    await waitFor(() => expect(result.current.products.length).toBe(1)); // catalog loaded

    act(() => result.current.addCode());          // row defaults to product 11 @150
    act(() => result.current.setCode(0, "D"));
    await act(async () => { await result.current.save(); });

    expect(saveCodes).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    const [codes, stock] = onSaved.mock.calls[0];
    expect(codes).toEqual([{ code: "D", productLocalId: 11, price: 150, productName: "Tee" }]);
    expect(stock instanceof Map).toBe(true);
    expect(stock.get(11)).toBe(5);                 // the code's product stock, for the matcher ref
  });

  it("does NOT fire onSaved when the save fails", async () => {
    (saveCodes as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAutoCodes(true, onSaved));
    await waitFor(() => expect(result.current.products.length).toBe(1));
    act(() => result.current.addCode());
    act(() => result.current.setCode(0, "D"));
    await act(async () => { await result.current.save(); });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
