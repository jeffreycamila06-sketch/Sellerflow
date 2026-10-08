// Product pictures (switch product_images_enabled, sql/95). Pins: switch off = Products exactly as
// before and NO storage / image_path call; switch on = thumbnail when image_path is set, the
// initials placeholder when not (and when the picture fails to load), Add / Replace / Remove and
// product delete hit the right storage path ({uid}/{local_id}.jpg, upsert on replace), the
// compression keeps the longest side ≤ 800 px and refuses anything still over 400 KB; the sql/95
// contract.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => {
  const log: { op: string; args: unknown[] }[] = [];
  const state = { rows: [] as unknown[], uploadError: null as unknown, removeError: null as unknown, updateError: null as unknown };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "update"]) c[m] = (...a: unknown[]) => { log.push({ op: m, args: a }); return c; };
    c.then = (r: (v: unknown) => unknown) => r(result());
    return c;
  };
  const bucket = {
    upload: vi.fn(async (...a: unknown[]) => { log.push({ op: "upload", args: a }); return { error: state.uploadError }; }),
    remove: vi.fn(async (...a: unknown[]) => { log.push({ op: "remove", args: a }); return { error: state.removeError }; }),
    getPublicUrl: vi.fn((p: string) => ({ data: { publicUrl: `https://cdn.test/product-images/${p}` } })),
  };
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: vi.fn((t: string) => { log.push({ op: "from", args: [t] }); return chain(() => ({ data: state.rows, error: state.updateError })); }),
    storage: { from: vi.fn((b: string) => { log.push({ op: "bucket", args: [b] }); return bucket; }) },
  };
  return { log, state, bucket, supabase };
});
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: h.supabase }));
vi.mock("../productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDbResult: vi.fn(async () => ({ ok: true })),
  deleteProductDb: vi.fn(async () => true),
  adjustProductStock: vi.fn(async () => 6),
  adjustStockLogged: vi.fn(async () => 6),
  restockProduct: vi.fn(async () => 15),
  logStockMovement: vi.fn(async () => true),
  loadStockMovements: vi.fn(async () => []),
}));
vi.mock("../productImages", async (orig) => ({ ...(await orig<typeof import("../productImages")>()), compressProductImage: vi.fn() }));
import Products from "../../screens/Products";
import { TProvider } from "../../i18n";
import { deleteProductDb } from "../productsDb";
import * as pi from "../productImages";

const real = await vi.importActual<typeof import("../productImages")>("../productImages");
const compressMock = pi.compressProductImage as unknown as ReturnType<typeof vi.fn>;

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
const PRODS = [
  { id: 7, name: "Red Dress", sku: "D1", price: 350, stock: 5, platform: "TikTok", status: "Active", liveCode: "" },
  { id: 8, name: "Blue Bag", sku: "B1", price: 200, stock: 2, platform: "TikTok", status: "Low stock", liveCode: "" },
];
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("sf_prods", JSON.stringify(PRODS));
  vi.clearAllMocks(); h.log.length = 0;
  h.state.rows = [{ local_id: 7, image_path: "u1/7.jpg" }]; h.state.uploadError = null; h.state.removeError = null; h.state.updateError = null;
});
const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><Products cur="NT$" {...extra} /></TProvider>);
const touchedStorage = () => h.log.some((c) => c.op === "bucket" || c.op === "upload" || c.op === "remove" || (c.op === "select" && String(c.args[0]).includes("image_path")));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("switch OFF — nothing changes", () => {
  it("renders identical to no prop, no picture UI, no storage call", async () => {
    const a = view().container.innerHTML;
    const b = view({ productImages: false }).container.innerHTML;
    expect(b).toBe(a);
    await flush();
    expect(screen.queryAllByTestId("prd-thumb-7")).toHaveLength(0);
    expect(touchedStorage()).toBe(false);
  });
  it("edit form has no picture section; delete never touches storage", async () => {
    view();
    fireEvent.click(screen.getAllByText("Edit")[0]);
    expect(screen.queryByTestId("prd-pic-section")).toBeNull();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getAllByText("Delete")[0]);
    await waitFor(() => expect(deleteProductDb).toHaveBeenCalledWith(7));
    await flush();
    expect(touchedStorage()).toBe(false);
  });
});

describe("switch ON", () => {
  it("switching off after the pictures loaded hides them again", async () => {
    const r = view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    r.rerender(<TProvider lang="en"><Products cur="NT$" productImages={false} /></TProvider>);
    expect(screen.queryByTestId("prd-thumb-7")).toBeNull();
  });
  it("thumbnail when image_path is set (lazy), placeholder when not", async () => {
    view({ productImages: true });
    const img = await screen.findByTestId("prd-thumb-7");
    expect(img.getAttribute("src")).toBe("https://cdn.test/product-images/u1/7.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(screen.queryByTestId("prd-thumb-8")).toBeNull();
    expect(screen.getByText("BB")).toBeTruthy(); // initials placeholder for the product without a picture
  });
  it("a picture that fails to load falls back to the placeholder", async () => {
    view({ productImages: true });
    fireEvent.error(await screen.findByTestId("prd-thumb-7"));
    expect(screen.queryByTestId("prd-thumb-7")).toBeNull();
    expect(screen.getByText("RD")).toBeTruthy();
  });
  it("Add picture uploads to {uid}/{local_id}.jpg with upsert, then stores the path", async () => {
    compressMock.mockResolvedValue({ ok: true, blob: new Blob(["x"], { type: "image/jpeg" }), width: 800, height: 600 });
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(screen.getAllByText("Edit")[1]); // Bag (Blue Bag, id 8) has no picture
    expect(screen.getByTestId("prd-pic-add").textContent).toBe("Add picture");
    expect(screen.queryByTestId("prd-pic-remove")).toBeNull();
    fireEvent.change(screen.getByTestId("prd-pic-input"), { target: { files: [new File(["p"], "p.png", { type: "image/png" })] } });
    await waitFor(() => expect(h.bucket.upload).toHaveBeenCalled());
    const [path, , opts] = h.bucket.upload.mock.calls[0] as unknown as [string, Blob, Record<string, unknown>];
    expect(path).toBe("u1/8.jpg");
    expect(opts).toMatchObject({ upsert: true, contentType: "image/jpeg" });
    await waitFor(() => expect(h.log.some((c) => c.op === "update" && (c.args[0] as { image_path?: string }).image_path === "u1/8.jpg")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("prd-pic-add").textContent).toBe("Replace"));
    expect(screen.getByTestId("prd-pic-preview").getAttribute("src")).toMatch(/u1\/8\.jpg\?v=\d+$/);
  });
  it("Replace overwrites the same path", async () => {
    compressMock.mockResolvedValue({ ok: true, blob: new Blob(["x"], { type: "image/jpeg" }), width: 10, height: 10 });
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(screen.getAllByText("Edit")[0]);
    expect(screen.getByTestId("prd-pic-add").textContent).toBe("Replace");
    fireEvent.change(screen.getByTestId("prd-pic-input"), { target: { files: [new File(["p"], "p.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(h.bucket.upload).toHaveBeenCalled());
    expect(h.bucket.upload.mock.calls[0][0]).toBe("u1/7.jpg");
    expect((h.bucket.upload.mock.calls[0] as unknown[])[2]).toMatchObject({ upsert: true });
  });
  it("Remove deletes the object and clears image_path", async () => {
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(screen.getAllByText("Edit")[0]);
    fireEvent.click(screen.getByTestId("prd-pic-remove"));
    await waitFor(() => expect(h.bucket.remove).toHaveBeenCalledWith(["u1/7.jpg"]));
    await waitFor(() => expect(h.log.some((c) => c.op === "update" && (c.args[0] as { image_path?: unknown }).image_path === null)).toBe(true));
    await waitFor(() => expect(screen.getByTestId("prd-pic-add").textContent).toBe("Add picture"));
  });
  it("a picture still over 400 KB after shrinking is refused with a plain message, nothing uploaded", async () => {
    compressMock.mockResolvedValue({ ok: false, reason: "too_big" });
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(screen.getAllByText("Edit")[1]);
    fireEvent.change(screen.getByTestId("prd-pic-input"), { target: { files: [new File(["p"], "p.jpg", { type: "image/jpeg" })] } });
    expect((await screen.findByTestId("prd-pic-err")).textContent).toContain("400 KB");
    expect(h.bucket.upload).not.toHaveBeenCalled();
  });
  it("a failed upload says so and keeps the old state", async () => {
    compressMock.mockResolvedValue({ ok: true, blob: new Blob(["x"]), width: 1, height: 1 });
    h.state.uploadError = { message: "nope" };
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(screen.getAllByText("Edit")[1]);
    fireEvent.change(screen.getByTestId("prd-pic-input"), { target: { files: [new File(["p"], "p.jpg")] } });
    expect((await screen.findByTestId("prd-pic-err")).textContent).toBe("Couldn't save the picture. Try again.");
    expect(screen.getByTestId("prd-pic-add").textContent).toBe("Add picture");
  });
  it("a new product must be saved first", async () => {
    view({ productImages: true });
    fireEvent.click(screen.getByText("+ Add"));
    expect(screen.getByTestId("prd-pic-save-first")).toBeTruthy();
    expect(screen.queryByTestId("prd-pic-input")).toBeNull();
  });
  it("deleting a product removes its object, fire-and-forget", async () => {
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getAllByText("Delete")[0]);
    await waitFor(() => expect(h.bucket.remove).toHaveBeenCalledWith(["u1/7.jpg"]));
  });
  it("a failing object removal never blocks or reverts the product delete", async () => {
    h.bucket.remove.mockRejectedValueOnce(new Error("down"));
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getAllByText("Delete")[0]);
    await waitFor(() => expect(h.bucket.remove).toHaveBeenCalled());
    await flush();
    expect(screen.queryByText("Red Dress")).toBeNull();
  });
  it("a failed DB delete restores the product and leaves the picture alone", async () => {
    (deleteProductDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    view({ productImages: true });
    await screen.findByTestId("prd-thumb-7");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getAllByText("Delete")[0]);
    await waitFor(() => expect(screen.getByText("Red Dress")).toBeTruthy());
    await flush();
    expect(h.bucket.remove).not.toHaveBeenCalled();
  });
});

describe("compression", () => {
  const dataUrlOf = (bytes: number) => "data:image/jpeg;base64," + "A".repeat(Math.ceil(bytes / 3) * 4);
  let canvases: { w: number; h: number; q: number }[] = [];
  let sizeFor: (w: number, q: number) => number = () => 1000;
  beforeEach(() => {
    canvases = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect() {}, drawImage() {}, fillStyle: "" } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement, _t?: string, q?: number) {
      canvases.push({ w: this.width, h: this.height, q: q ?? 0 });
      return dataUrlOf(sizeFor(this.width, q ?? 0));
    });
  });
  const withImage = async (w: number, hgt: number, fn: () => Promise<void>) => {
    const Orig = globalThis.Image;
    class FakeImage { naturalWidth = w; naturalHeight = hgt; onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_s: string) { setTimeout(() => this.onload?.(), 0); } }
    (globalThis as unknown as { Image: unknown }).Image = FakeImage;
    try { await fn(); } finally { globalThis.Image = Orig; }
  };
  it("keeps the longest side ≤ 800 px (landscape and portrait), JPEG quality 0.8 first", async () => {
    await withImage(4000, 3000, async () => {
      const r = await real.compressProductImage(new Blob(["x"]));
      expect(r).toMatchObject({ ok: true, width: 800, height: 600 });
      expect(canvases[0]).toEqual({ w: 800, h: 600, q: 0.8 });
    });
    await withImage(1000, 3000, async () => {
      const r = await real.compressProductImage(new Blob(["x"]));
      expect(r).toMatchObject({ ok: true, width: 267, height: 800 });
    });
    expect(Math.max(...canvases.flatMap((c) => [c.w, c.h]))).toBeLessThanOrEqual(800);
  });
  it("a small picture is never enlarged", async () => {
    await withImage(300, 200, async () => {
      expect(await real.compressProductImage(new Blob(["x"]))).toMatchObject({ ok: true, width: 300, height: 200 });
    });
  });
  it("over the ~150 KB target → lower quality / smaller size until it fits", async () => {
    sizeFor = (w, q) => (w >= 800 && q >= 0.7 ? 250_000 : 120_000);
    await withImage(4000, 3000, async () => {
      const r = await real.compressProductImage(new Blob(["x"]));
      expect(r.ok && r.blob.size).toBeLessThanOrEqual(150 * 1024);
      expect(canvases.map((c) => c.q)).toEqual([0.8, 0.7, 0.6]);
    });
  });
  it("nothing under the target but under 400 KB → the smallest is kept", async () => {
    sizeFor = (w, q) => 200_000 + Math.round(w * q * 10);
    await withImage(4000, 3000, async () => {
      const r = await real.compressProductImage(new Blob(["x"]));
      expect(r.ok).toBe(true);
      expect(r.ok && r.blob.size).toBeLessThanOrEqual(400 * 1024);
      expect(r.ok && r.width).toBe(480); // the 0.6 scale at the lowest quality was the smallest
    });
  });
  it("still over 400 KB at every size and quality → refused", async () => {
    sizeFor = () => 500_000;
    await withImage(4000, 3000, async () => {
      expect(await real.compressProductImage(new Blob(["x"]))).toEqual({ ok: false, reason: "too_big" });
    });
  });
  it("an unreadable file is refused", async () => {
    const Orig = globalThis.Image;
    class BadImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_s: string) { setTimeout(() => this.onerror?.(), 0); } }
    (globalThis as unknown as { Image: unknown }).Image = BadImage;
    try { expect(await real.compressProductImage(new Blob(["x"]))).toEqual({ ok: false, reason: "unreadable" }); }
    finally { globalThis.Image = Orig; }
  });
});

describe("adapter + wiring", () => {
  it("paths and public URL", () => {
    expect(real.productImagePath("abc", 12)).toBe("abc/12.jpg");
    expect(real.productImageUrl("abc/12.jpg")).toBe("https://cdn.test/product-images/abc/12.jpg");
    expect(real.productImageUrl("abc/12.jpg", 5)).toBe("https://cdn.test/product-images/abc/12.jpg?v=5");
    expect(h.supabase.storage.from).toHaveBeenCalledWith("product-images");
  });
  it("loads only own rows with a picture", async () => {
    h.state.rows = [{ local_id: 3, image_path: "u1/3.jpg" }];
    const m = await real.loadProductImagePaths();
    expect([...(m ?? new Map())]).toEqual([[3, "u1/3.jpg"]]);
    expect(h.log).toEqual(expect.arrayContaining([{ op: "select", args: ["local_id,image_path"] }, { op: "eq", args: ["user_id", "u1"] }, { op: "not", args: ["image_path", "is", null] }]));
  });
  it("the normal product load and save never carry image_path", () => {
    const db = readFileSync("src/redesign/adapters/productsDb.ts", "utf8");
    expect(db).not.toContain("image_path");
  });
  it("RedesignApp hands Products the switch, appended last", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain(" inventoryV2={featureSw.inventoryV2} productImages={featureSw.productImages} />}");
  });
});

describe("sql/95 contract", () => {
  const sql = readFileSync("sql/95_product_images.sql", "utf8");
  const rb = readFileSync("sql/95_product_images_rollback.sql", "utf8");
  it("column, bucket limits, owner-only writes, switch seeded off", () => {
    expect(sql).toMatch(/add column if not exists image_path text/i);
    expect(sql).toContain("'product-images', 'product-images', true, 409600, array[");
    expect(sql).toMatch(/array\['image\/jpeg',\s*'image\/png',\s*'image\/webp'\]/);
    expect((sql.match(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g) ?? []).length).toBe(4);
    expect(sql).toContain("('product_images_enabled', 'false')");
  });
  it("no 'drop … if exists' and no backslash-u anywhere", () => {
    for (const s of [sql, rb, readFileSync("src/redesign/adapters/productImages.ts", "utf8")]) {
      expect(s).not.toMatch(/drop\s+\w+\s+if\s+exists/i);
      expect(s).not.toContain("\\u");
    }
  });
});
