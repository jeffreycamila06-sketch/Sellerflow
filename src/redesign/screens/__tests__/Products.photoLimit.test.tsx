// Seller Website audit A — product photo limit per plan: "Photos: X / limit" in Products, the limit
// message after the server refuses an upload (live picture and website photos), and a deleted
// product's website photos (+ small copies) are deleted with it. The server rule is proved in
// scripts/sql163-behaviour.mjs (part 5).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent, screen, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { Product } from "../../adapters/products";
import { uploadFailText, atPhotoLimit } from "../../adapters/photoQuota";
import { smallPhotoPath } from "../../adapters/websitePhotos";

const h = vi.hoisted(() => ({
  products: [] as Product[], quota: { used: 12, limit: 50 } as { used: number; limit: number } | null,
  removed: [] as string[][], upload: vi.fn(async () => null as string | null),
}));
vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: async () => ({ products: h.products, source: "db" }),
  saveProductDbResult: vi.fn(async () => ({ ok: true })), deleteProductDb: vi.fn(async () => true),
  adjustProductStock: vi.fn(async () => 6), adjustStockLogged: vi.fn(async () => 6), restockProduct: vi.fn(async () => 6), logStockMovement: vi.fn(async () => true), loadStockMovements: vi.fn(async () => []),
}));
vi.mock("../../adapters/productImages", async (orig) => ({
  ...(await orig<typeof import("../../adapters/productImages")>()),
  loadProductImagePaths: vi.fn(async () => new Map()),
  compressProductImage: vi.fn(async () => ({ ok: true, blob: new Blob(["x"]), width: 10, height: 10 })),
  uploadProductImage: (...a: unknown[]) => h.upload(...(a as [])),
  forgetProductImage: vi.fn(),
}));
vi.mock("../../adapters/photoQuota", async (orig) => ({ ...(await orig<typeof import("../../adapters/photoQuota")>()), loadPhotoQuota: vi.fn(async () => h.quota) }));
vi.mock("../../adapters/websitePhotos", async (orig) => ({ ...(await orig<typeof import("../../adapters/websitePhotos")>()), removeWebsitePhotos: vi.fn(async (p: string[]) => { h.removed.push(p); return true; }) }));
import Products from "../Products";

const P = (over: Partial<Product> = {}): Product => ({ id: 1, name: "Dress", sku: "D", price: 350, stock: 3, platform: "TikTok", status: "Active", liveCode: "A01", ...over });
async function mount(props: Record<string, unknown> = {}) {
  render(<TProvider lang="en"><Products cur="NT$" productImages {...props} /></TProvider>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
beforeEach(() => { h.products = [P()]; h.quota = { used: 12, limit: 50 }; h.removed = []; h.upload.mockClear(); vi.spyOn(window, "confirm").mockReturnValue(true); });

describe("photo limit (A)", () => {
  it("pure: the limit text only when the server says full", async () => {
    expect(atPhotoLimit({ used: 50, limit: 50 })).toBe(true);
    expect(atPhotoLimit({ used: 49, limit: 50 })).toBe(false);
    expect(atPhotoLimit(null)).toBe(false);
    expect((await uploadFailText("LIMIT", "OTHER", async () => ({ used: 50, limit: 50 }))).text).toBe("LIMIT");
    expect((await uploadFailText("LIMIT", "OTHER", async () => ({ used: 3, limit: 50 }))).text).toBe("OTHER");
    expect((await uploadFailText("LIMIT", "OTHER", async () => null)).text).toBe("OTHER");
    expect(smallPhotoPath("u/1-p3.jpg")).toBe("u/1-p3-s.jpg");
    expect(smallPhotoPath("u/1.jpg")).toBe("u/1.jpg");
  });
  it("Products shows 'Photos: X / limit' (only when photos are on)", async () => {
    await mount();
    expect(screen.getByTestId("prd-photo-quota").textContent).toBe("Photos: 12 / 50");
  });
  it("no photo feature → no count line, no read", async () => {
    render(<TProvider lang="en"><Products cur="NT$" /></TProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("prd-photo-quota")).toBeNull();
  });
  it("the server refuses the live picture at the limit → the limit message", async () => {
    h.quota = { used: 50, limit: 50 };
    await mount();
    fireEvent.click(screen.getByText("Edit"));
    await act(async () => { fireEvent.change(screen.getByTestId("prd-pic-input"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } }); });
    await waitFor(() => expect(screen.getByTestId("prd-pic-err").textContent).toBe("Picture limit reached. Delete photos you no longer need (like sold-out items) to upload new ones."));
    expect(screen.getByTestId("prd-photo-quota").textContent).toBe("Photos: 50 / 50");
  });
  it("a failure that isn't the limit keeps the old message", async () => {
    await mount();
    fireEvent.click(screen.getByText("Edit"));
    await act(async () => { fireEvent.change(screen.getByTestId("prd-pic-input"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } }); });
    await waitFor(() => expect(screen.getByTestId("prd-pic-err").textContent).not.toContain("limit"));
  });
  it("deleting a product deletes its website photos (+ small copies through removeWebsitePhotos)", async () => {
    h.products = [P({ photoPaths: ["u/1-p2.jpg", "u/1-p3.jpg"] }), P({ id: 2, name: "Shirt", liveCode: "A02" })];
    await mount({ website: true });
    await act(async () => { fireEvent.click(screen.getAllByText("Delete")[0]); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(h.removed).toEqual([["u/1-p2.jpg", "u/1-p3.jpg"]]));
  });
});
