// Products — product pictures exactly like the approved preview (Nov 12 2026), product-pictures
// switch ON. Grid 2 per row on a phone / 5 on a laptop; square picture box (cover); ⤢ badge;
// tap → full-screen viewer (✕ / outside / Esc / back gesture, focus returns); no picture → the
// coloured letter; the edit dialog's 160 px whole-picture (contain) preview; card text sizes.
// Plus the pure helpers of the automatic picture adjust (EXIF orientation, HEIC detection).
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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
  return { state, supabase };
});
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: h.supabase }));
vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDbResult: vi.fn(async () => ({ ok: true })), deleteProductDb: vi.fn(async () => true),
  adjustProductStock: vi.fn(async () => 6), adjustStockLogged: vi.fn(async () => 6), restockProduct: vi.fn(async () => 15),
  logStockMovement: vi.fn(async () => true), loadStockMovements: vi.fn(async () => []),
}));
import Products from "../Products";
import { TProvider } from "../../i18n";
import { PIC_GRID_COLUMNS, picGridColumnCount, placeholderLetter } from "../../adapters/productGrid";
import { readJpegInfo, orientedSize, orientationMatrix, isHeic } from "../../adapters/productImages";

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
const PRODS = [
  { id: 7, name: "Hello Kitty Bag with a very long name that never fits on two lines", sku: "HK1", price: 350, stock: 5, platform: "TikTok", status: "Active", liveCode: "A" },
  { id: 8, name: "yellow scarf", sku: "Y1", price: 1200.5, stock: 0, platform: "Facebook", status: "Out of stock", liveCode: "" },
];
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("sf_prods", JSON.stringify(PRODS));
  h.state.rows = [{ local_id: 7, image_path: "u1/7.jpg" }];
  window.history.replaceState(null, "");
});
const view = (extra: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><div data-redesign=""><Products cur="NT$" productImages {...extra} /></div></TProvider>);
const st = (el: Element) => (el as HTMLElement).style;

describe("grid (pictures on)", () => {
  it("one responsive grid: gap 8, padding 10px 8px, columns = 2 on phones / 5 on a laptop / in between on a tablet", async () => {
    view();
    const grid = await screen.findByTestId("prd-grid");
    expect(st(grid).gridTemplateColumns).toBe(PIC_GRID_COLUMNS);
    expect(st(grid).gap).toBe("8px");
    expect(st(grid).padding).toBe("10px 8px");
    // content width = viewport (or content area) − 16 px side padding
    expect(picGridColumnCount(390 - 16)).toBe(2); // iPhone 390
    expect(picGridColumnCount(412 - 16)).toBe(2); // Android 412
    expect(picGridColumnCount(360 - 16)).toBe(2); // small Android
    expect(picGridColumnCount(430 - 16)).toBe(2);
    expect(picGridColumnCount(1280 - 16)).toBe(5); // laptop, full width
    expect(picGridColumnCount(1280 - 240 - 16)).toBe(5); // laptop with the left menu
    expect(picGridColumnCount(1920 - 16)).toBe(5); // never more than 5
    expect(picGridColumnCount(768 - 16)).toBe(4); // tablet: in between
    expect(picGridColumnCount(600 - 16)).toBe(3);
  });
  it("card: radius 10; picture box is a robust square (height 0 + padding-bottom 100%), picture = cover filling it", async () => {
    view();
    const card = await screen.findByTestId("prd-card-7");
    expect(st(card).borderRadius).toBe("10px");
    const box = screen.getByTestId("prd-picbox-7");
    expect(st(box).height).toBe("0px");
    expect(st(box).paddingBottom).toBe("100%");
    expect(st(box).position).toBe("relative");
    const img = await screen.findByTestId("prd-thumb-7");
    expect(st(img).objectFit).toBe("cover");
    expect(st(img).position).toBe("absolute");
    expect([st(img).width, st(img).height]).toEqual(["100%", "100%"]);
    expect(screen.getByTestId("prd-zoom-7").textContent).toBe("⤢");
    expect(within(box).getByText("TikTok")).toBeTruthy(); // platform badge stays on the picture
  });
  it("no picture: the same square box with the coloured letter (40px), no ⤢, nothing to tap", async () => {
    view();
    await screen.findByTestId("prd-thumb-7");
    const ph = screen.getByTestId("prd-ph-8");
    expect(ph.textContent).toBe("Y");
    expect(st(ph).fontSize).toBe("40px");
    expect(st(screen.getByTestId("prd-picbox-8")).paddingBottom).toBe("100%");
    expect(screen.queryByTestId("prd-zoom-8")).toBeNull();
    expect(screen.queryByTestId("prd-thumb-btn-8")).toBeNull();
    expect(placeholderLetter("  hat ")).toBe("H");
  });
  it("under the picture: name 13.5/600 max 2 lines (min 2), price red mono 15, −/+ 22×22 r6 f12, buttons 2×2 gap 4", async () => {
    view({ inventoryV2: true });
    await screen.findByTestId("prd-thumb-7");
    const name = screen.getByTestId("prd-name-7");
    expect([st(name).fontSize, st(name).fontWeight, st(name).minHeight]).toEqual(["13.5px", "600", "2.5em"]);
    expect((name.style as unknown as Record<string, string>).WebkitLineClamp ?? name.style.getPropertyValue("-webkit-line-clamp")).toBe("2");
    const price = screen.getByTestId("prd-price-8");
    expect(price.textContent).toBe("NT$1,200.50");
    expect([st(price).color, st(price).fontSize, st(price).fontFamily]).toEqual(["var(--danger)", "15px", "var(--font-mono)"]);
    const dec = screen.getByTestId("stock-dec-7");
    expect([st(dec).width, st(dec).height, st(dec).borderRadius, st(dec).fontSize]).toEqual(["22px", "22px", "6px", "12px"]);
    const btns = screen.getByTestId("prd-btns-7");
    expect([st(btns).display, st(btns).gridTemplateColumns, st(btns).gap]).toEqual(["grid", "1fr 1fr", "4px"]);
    expect(Array.from(btns.children).map((b) => b.textContent)).toEqual(["Edit", "Delete", "Restock", "History"]);
    const edit = btns.children[0] as HTMLElement;
    expect([edit.style.fontSize, edit.style.padding, edit.style.borderRadius]).toEqual(["11.5px", "5px", "7px"]);
  });
  it("stock − / + and the buttons still work", async () => {
    view();
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(screen.getByTestId("stock-inc-7"));
    expect(screen.getByTestId("stock-val-7").textContent).toBe("6");
    fireEvent.click(within(screen.getByTestId("prd-btns-7")).getByText("Edit"));
    expect(screen.getByTestId("prd-pic-section")).toBeTruthy();
  });
  it("pictures switch OFF: the old list (no new grid, no square boxes)", async () => {
    view({ productImages: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("prd-grid")).toBeNull();
    expect(screen.queryByTestId("prd-picbox-7")).toBeNull();
  });
});

describe("full-screen viewer", () => {
  const openFromCard = async () => {
    view();
    const btn = await screen.findByTestId("prd-thumb-btn-7");
    btn.focus();
    fireEvent.click(btn);
    return btn;
  };
  it("tap the picture → whole picture (contain) + name caption + ✕, over everything", async () => {
    await openFromCard();
    const v = screen.getByTestId("pic-viewer");
    expect([st(v).position, st(v).zIndex]).toEqual(["fixed", "2000"]);
    const img = screen.getByTestId("pic-viewer-img");
    expect(img.getAttribute("src")).toBe("https://cdn.test/product-images/u1/7.jpg");
    expect([st(img).objectFit, st(img).maxWidth, st(img).maxHeight, st(img).borderRadius]).toEqual(["contain", "100%", "100%", "12px"]);
    expect(screen.getByTestId("pic-viewer-caption").textContent).toBe(PRODS[0].name);
    const x = screen.getByTestId("pic-viewer-close");
    expect([st(x).width, st(x).height, st(x).borderRadius]).toEqual(["40px", "40px", "50%"]);
    expect(st(v).padding).toContain("safe-area-inset-top");
    expect(st(v).padding).toContain("safe-area-inset-bottom");
    expect(document.activeElement).toBe(x);
  });
  it("✕ closes, focus returns to the picture, and the history entry is taken off again", async () => {
    const btn = await openFromCard();
    expect((window.history.state as Record<string, unknown>)?.sflPicViewer).toBe(true);
    fireEvent.click(screen.getByTestId("pic-viewer-close"));
    expect(screen.queryByTestId("pic-viewer")).toBeNull();
    expect(document.activeElement).toBe(btn);
    await waitFor(() => expect((window.history.state as Record<string, unknown> | null)?.sflPicViewer).toBeUndefined());
  });
  it("a tap outside the picture closes; a tap ON the picture does not", async () => {
    await openFromCard();
    fireEvent.click(screen.getByTestId("pic-viewer-img"));
    expect(screen.getByTestId("pic-viewer")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pic-viewer"));
    expect(screen.queryByTestId("pic-viewer")).toBeNull();
  });
  it("Esc closes", async () => {
    await openFromCard();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("pic-viewer")).toBeNull();
  });
  it("the phone back gesture (history back) closes", async () => {
    await openFromCard();
    window.history.back();
    await waitFor(() => expect(screen.queryByTestId("pic-viewer")).toBeNull());
  });
});

describe("edit dialog picture", () => {
  it("160×160, radius 14, whole picture (contain), ⤢ Tap to view; Replace and Remove stacked to the right; tap → viewer", async () => {
    view();
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(within(screen.getByTestId("prd-btns-7")).getByText("Edit"));
    const box = screen.getByTestId("prd-pic-box");
    expect([st(box).width, st(box).height, st(box).borderRadius]).toEqual(["160px", "160px", "14px"]);
    const img = screen.getByTestId("prd-pic-preview");
    expect(st(img).objectFit).toBe("contain");
    expect(screen.getByTestId("prd-pic-view").textContent).toContain("⤢ Tap to view");
    const actions = screen.getByTestId("prd-pic-actions");
    expect(st(actions).flexDirection).toBe("column");
    expect(Array.from(actions.children).map((b) => b.textContent)).toEqual(["Replace", "Remove"]);
    fireEvent.click(screen.getByTestId("prd-pic-view"));
    expect(screen.getByTestId("pic-viewer-img").getAttribute("src")).toBe(img.getAttribute("src"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("pic-viewer")).toBeNull();
    expect(screen.getByTestId("prd-pic-box")).toBeTruthy(); // the dialog stays open
  });
  it("no picture: the coloured letter in the 160 box, Add picture to the right, nothing to view", async () => {
    view();
    await screen.findByTestId("prd-thumb-7");
    fireEvent.click(within(screen.getByTestId("prd-btns-8")).getByText("Edit"));
    expect(screen.queryByTestId("prd-pic-view")).toBeNull();
    expect(screen.getByTestId("prd-pic-box").textContent).toBe("Y");
    expect(Array.from(screen.getByTestId("prd-pic-actions").children).map((b) => b.textContent)).toEqual(["Add picture"]);
  });
});

describe("automatic picture adjust — pure helpers", () => {
  // Build a tiny JPEG header: SOI, APP1 Exif (orientation), SOF0 (stored size).
  const jpeg = (orientation: number, le: boolean, w: number, h: number) => {
    const u16 = (n: number) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
    const u32 = (n: number) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    const tiff = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const sof = [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xc0, (sof.length + 2) >> 8, (sof.length + 2) & 255, ...sof, 0xff, 0xda]);
  };
  it("reads the EXIF orientation (both byte orders) and the stored size", () => {
    for (const o of [1, 3, 6, 8]) {
      expect(readJpegInfo(jpeg(o, false, 4032, 3024))).toEqual({ orientation: o, width: 4032, height: 3024 });
      expect(readJpegInfo(jpeg(o, true, 4032, 3024))).toEqual({ orientation: o, width: 4032, height: 3024 });
    }
    expect(readJpegInfo(new Uint8Array([1, 2, 3, 4]))).toEqual({ orientation: 1, width: 0, height: 0 }); // not a JPEG
  });
  it("orientations 5–8 swap width and height", () => {
    expect(orientedSize(4032, 3024, 6)).toEqual({ w: 3024, h: 4032 });
    expect(orientedSize(4032, 3024, 3)).toEqual({ w: 4032, h: 3024 });
  });
  it("the turn puts the stored picture's corners in the right place (6 = 90° clockwise, 8 = 90° anticlockwise, 3 = 180°)", () => {
    const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const W = 400, H = 300; // stored landscape
    // 6: stored top-left → shown top-right; stored bottom-left → shown top-left
    expect(apply(orientationMatrix(6, W, H), 0, 0)).toEqual([300, 0]);
    expect(apply(orientationMatrix(6, W, H), 0, H)).toEqual([0, 0]);
    // 8: stored top-right → shown top-left
    expect(apply(orientationMatrix(8, W, H), W, 0)).toEqual([0, 0]);
    // 3: stored bottom-right → shown top-left
    expect(apply(orientationMatrix(3, W, H), W, H)).toEqual([0, 0]);
    expect(orientationMatrix(1, W, H)).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it("recognises HEIC by type or by its ftyp brand", () => {
    const box = (brand: string) => new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...Array.from(brand, (c) => c.charCodeAt(0))]);
    expect(isHeic("image/heic", new Uint8Array())).toBe(true);
    expect(isHeic("image/heif", new Uint8Array())).toBe(true);
    expect(isHeic("", box("heic"))).toBe(true);
    expect(isHeic("", box("mif1"))).toBe(true);
    expect(isHeic("", box("isom"))).toBe(false); // an MP4
    expect(isHeic("image/jpeg", new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});
