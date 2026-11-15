// Seller Website audit B — website photo quality: the FULL photo is the first encoding ≤ 1 MB in the
// order quality 0.85 → 0.82 → 0.8 at up to 2048 px, then smaller sizes, NEVER below quality 0.8; a
// small (~600 px) copy is saved next to it; the shop grid / cart / order lists show the small copy
// (full photo if the small one can't load); the product page shows the full photo. Photo 1 (the
// live product picture) is not touched.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const h = vi.hoisted(() => ({ uploads: [] as string[], removed: [] as string[][], failSmall: false }));
vi.mock("../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    storage: { from: () => ({
      upload: async (path: string) => { h.uploads.push(path); return { error: h.failSmall && path.endsWith("-s.jpg") ? { message: "x" } : null }; },
      remove: async (p: string[]) => { h.removed.push(p); return { error: null }; },
      getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }),
    }) },
  },
}));
import { pickFullEncoding, pickSmallEncoding, WEBSITE_PHOTO_MAX_BYTES, WEBSITE_PHOTO_MAX_SIDE, WEBSITE_SMALL_SIDE } from "../../redesign/adapters/websitePhotoQuality";
import { uploadExtraPhoto } from "../../redesign/adapters/websitePhotos";
import ShopApp from "../ShopApp";
import { DEMO_SHOP } from "./fixtures";

beforeEach(() => { h.uploads = []; h.removed = []; h.failSmall = false; });
const MB = 1024 * 1024;
describe("encoding choice (pure)", () => {
  it("fits at 0.85 full size → 0.85 full size", () => {
    const calls: [number, number][] = [];
    const r = pickFullEncoding((s, q) => { calls.push([s, q]); return { size: 600_000, s, q }; });
    expect(r).toMatchObject({ s: 1, q: 0.85 });
    expect(calls).toEqual([[1, 0.85]]);
  });
  it("too big at 0.85 → lower quality first (0.82, 0.8), then a smaller size — never below 0.8, never over 1 MB", () => {
    const calls: [number, number][] = [];
    const r = pickFullEncoding((s, q) => { calls.push([s, q]); return { size: s === 1 ? 1.4 * MB : 0.9 * MB, s, q }; });
    expect(calls.slice(0, 4)).toEqual([[1, 0.85], [1, 0.82], [1, 0.8], [0.9, 0.85]]);
    expect(r).toMatchObject({ s: 0.9, q: 0.85 });
    expect(Math.min(...calls.map((c) => c[1]))).toBeGreaterThanOrEqual(0.8);
    expect(pickFullEncoding(() => ({ size: 2 * MB }))).toBeNull();
    expect(WEBSITE_PHOTO_MAX_BYTES).toBe(MB); expect(WEBSITE_PHOTO_MAX_SIDE).toBe(2048); expect(WEBSITE_SMALL_SIDE).toBe(600);
  });
  it("small copy: quality 0.8", () => {
    const calls: number[] = [];
    pickSmallEncoding((_s, q) => { calls.push(q); return { size: 80_000 }; });
    expect(calls).toEqual([0.8]);
  });
});

describe("upload", () => {
  const ok = async () => ({ ok: true as const, full: new Blob(["F"]), small: new Blob(["S"]) });
  it("full photo first, then its small copy", async () => {
    expect(await uploadExtraPhoto(7, 3, new Blob(["x"]), ok)).toEqual({ ok: true, path: "u1/7-p3.jpg" });
    expect(h.uploads).toEqual(["u1/7-p3.jpg", "u1/7-p3-s.jpg"]);
  });
  it("small copy failed → the full one is removed again, the upload fails (never a photo without its small copy)", async () => {
    h.failSmall = true;
    expect(await uploadExtraPhoto(7, 3, new Blob(["x"]), ok)).toEqual({ ok: false, reason: "failed" });
    expect(h.removed).toEqual([["u1/7-p3.jpg"]]);
  });
  it("too big / unreadable pass through without any upload", async () => {
    expect(await uploadExtraPhoto(7, 3, new Blob(["x"]), async () => ({ ok: false, reason: "too_big" }))).toEqual({ ok: false, reason: "too_big" });
    expect(h.uploads).toEqual([]);
  });
});

describe("the shop uses small copies only in lists", () => {
  const shop = { ...DEMO_SHOP, products: DEMO_SHOP.products.map((p) => (p.id === 2 ? { ...p, photos: ["u1/2-p2.jpg", "u1/2-p3.jpg"] } : p.id === 3 ? { ...p, photos: ["u1/3.jpg"] } : p)) };
  it("grid: small copy of a website photo; photo 1 (live picture) as is; small can't load → full", () => {
    const { container } = render(<ShopApp preview={shop} />);
    const imgs = [...container.querySelectorAll("img")].filter((i) => i.src.startsWith("https://cdn/"));
    expect(imgs.map((i) => i.src)).toEqual(expect.arrayContaining(["https://cdn/u1/2-p2-s.jpg", "https://cdn/u1/3.jpg"]));
    const small = imgs.find((i) => i.src.endsWith("2-p2-s.jpg"))!;
    fireEvent.error(small);
    expect(small.src).toBe("https://cdn/u1/2-p2.jpg");
  });
  it("product page: the full photo", () => {
    render(<ShopApp preview={shop} startRoute={{ page: "product", id: 2 }} />);
    const main = screen.getByTestId("pd-gallery").querySelector("img") as HTMLImageElement;
    expect(main.src).toBe("https://cdn/u1/2-p2.jpg");
  });
  it("photo 1 upload code (productImages.ts) is unchanged on this branch; cart / checkout / order lists use the small copy", () => {
    expect(execSync("git diff --stat origin/main -- src/redesign/adapters/productImages.ts").toString().trim()).toBe("");
    for (const f of ["src/website/pages/Cart.tsx", "src/website/checkoutPages.tsx", "src/website/pages/Home.tsx"]) expect(readFileSync(f, "utf8")).toContain("<SmallPhoto path=");
    expect(readFileSync("src/website/pages/Product.tsx", "utf8")).not.toContain("SmallPhoto");
  });
});
