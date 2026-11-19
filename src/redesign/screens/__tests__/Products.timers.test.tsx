// Products — after a product is deleted (product pictures on, no website photos) the screen waits
// 1.5 s and then reads the photo count again. That wait is stopped when the screen closes
// (the same fix as Pickup Status, CI run 1843); while the screen is open nothing changed.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { expectNothingLate, tick, until } from "../../adapters/__tests__/pageGone";

const h = vi.hoisted(() => {
  const state = { rows: [] as unknown[] };
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "update"]) c[m] = () => c;
    c.then = (r: (v: unknown) => unknown) => r({ data: state.rows, error: null });
    return c;
  };
  const bucket = {
    upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })),
    getPublicUrl: vi.fn((p: string) => ({ data: { publicUrl: `https://cdn.test/product-images/${p}` } })),
  };
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: vi.fn(() => chain()),
    storage: { from: vi.fn(() => bucket) },
  };
  return { state, supabase, deleteProductDb: vi.fn(async (..._a: unknown[]) => true as boolean), loadPhotoQuota: vi.fn(async () => ({ used: 1, limit: 100 })) };
});
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: h.supabase }));
vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDbResult: vi.fn(async () => ({ ok: true })), deleteProductDb: (...a: unknown[]) => h.deleteProductDb(...a),
  adjustProductStock: vi.fn(async () => 6), adjustStockLogged: vi.fn(async () => 6), restockProduct: vi.fn(async () => 15),
  logStockMovement: vi.fn(async () => true), loadStockMovements: vi.fn(async () => []),
}));
vi.mock("../../adapters/photoQuota", async (orig) => ({ ...(await orig<typeof import("../../adapters/photoQuota")>()), loadPhotoQuota: () => h.loadPhotoQuota() }));
import Products from "../Products";
import { TProvider } from "../../i18n";

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
const PRODS = [
  { id: 7, name: "Hello Kitty Bag", sku: "HK1", price: 350, stock: 5, platform: "TikTok", status: "Active", liveCode: "A" },
  { id: 8, name: "yellow scarf", sku: "Y1", price: 1200, stock: 0, platform: "Facebook", status: "Out of stock", liveCode: "" },
];
const view = () => render(<TProvider lang="en"><div data-redesign=""><Products cur="NT$" productImages /></div></TProvider>);
const quotaReads = () => h.loadPhotoQuota.mock.calls.length;

/** Tap Delete on product 7 (the confirm box says yes); the delete has been sent when this returns. */
async function tapDelete() {
  await until(() => screen.queryByTestId("prd-btns-7"));
  await until(() => quotaReads() === 1); // the read at open
  fireEvent.click(Array.from(screen.getByTestId("prd-btns-7").children).find((b) => b.textContent === "Delete") as HTMLElement);
  await until(() => h.deleteProductDb.mock.calls.length === 1);
  expect(h.deleteProductDb).toHaveBeenCalledWith(7);
}
/** …and its answer has been handled: the 1.5 s wait is the ONE thing on the clock.
 *  (tick(0) moves the clock by nothing: it only lets the test browser's own 0 ms timers run — it starts
 *  one for every localStorage write, and the product list is kept there.) */
async function deleteOne() {
  await tapDelete();
  await until(() => screen.queryByTestId("prd-card-7") === null);
  await tick(0);
  expect(vi.getTimerCount()).toBe(1);
}

beforeEach(() => {
  vi.useFakeTimers();   // the clock moves only when a test moves it
  localStorage.clear(); localStorage.setItem("sf_prods", JSON.stringify(PRODS));
  h.state.rows = [];
  h.deleteProductDb.mockReset(); h.deleteProductDb.mockResolvedValue(true);
  h.loadPhotoQuota.mockClear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Products — the screen is closed right after a delete", () => {
  it("no timer is left, nothing updates late, and the photo count is not read again", async () => {
    const r = view();
    await deleteOne();
    r.unmount();
    expectNothingLate();
    expect(quotaReads()).toBe(1);
  });
  it("closed while the delete is still on its way: the 1.5 s wait is never started", async () => {
    let done: ((ok: boolean) => void) | null = null;
    h.deleteProductDb.mockImplementation(() => new Promise<boolean>((res) => { done = res; }));
    const r = view();
    await tapDelete();
    await tick(0);   // the test browser's own 0 ms timers (see deleteOne)
    expect(vi.getTimerCount()).toBe(0);
    r.unmount();
    done!(true);
    await tick(0);
    expectNothingLate();
    expect(quotaReads()).toBe(1);
  });
});

describe("Products — while the screen is open nothing changed", () => {
  it("the photo count is read again 1.5 seconds after the delete — not sooner, and once", async () => {
    view();
    await deleteOne();
    await tick(1499);
    expect(quotaReads()).toBe(1);
    await tick(1);
    await until(() => quotaReads() === 2);
    await tick(60_000);
    expect(quotaReads()).toBe(2);
  });
  it("a delete the database refused starts no wait (the product is put back)", async () => {
    h.deleteProductDb.mockResolvedValue(false);
    view();
    await tapDelete();
    await until(() => document.body.textContent?.includes("Delete failed — the product was restored."));
    expect(screen.queryByTestId("prd-card-7")).not.toBeNull();
    await tick(60_000);   // (the note's own 3.2 s timer runs out in here; it is not the wait this test is about)
    expect(quotaReads()).toBe(1);
  });
});
