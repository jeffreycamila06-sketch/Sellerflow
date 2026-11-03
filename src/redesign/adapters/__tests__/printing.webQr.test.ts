// WEB STICKER QR — "Print QR on sticker" also works through the browser print dialog.
// Round 3 (item 7): the laptop prints THE sticker bitmap as one image, so the QR is the SAME QR the phone
// stamps (stickerRaster stampHandleQr — same link, same ECC "M", same module size), with the same content
// rules: toggle on (+ entitled), @username line on, handle not blank. The image layouts carry a QR on every
// size (the generic rules), so 60×40 gets one on a laptop.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jsQR from "jsqr";
import { printSlip, setStickerQrOn, setStickerQrEntitled, __resetWebPrintQueue, __webPrintIdle, DEF_SETTINGS, type Settings, markLaptopSizeChosen } from "../printing";
import { pageSrc, rasterFromBmpDataUrl } from "./printControls.harness";
import type { FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";
// round 4 (item 5): these cases exercise the laptop BITMAP page — a chosen sticker size (the old page prints until one is chosen)
beforeEach(() => markLaptopSizeChosen());

const order = (over: Record<string, unknown> = {}) => ({ orderNum: 1750000000000, item: "A01", qty: 1, price: 320, total: 320, time: "9:41 PM", handle: "annc", name: "Ann Cruz", bNum: 12, platform: "TikTok", status: "New", date: "2026-09-26", ...over });
const buyer = (over: Partial<Buyer> = {}): Buyer => ({ handle: "annc", name: "Ann Cruz", platform: "TikTok", num: 12, orders: [order()], totalOrders: 1, totalSpent: 320, ...over } as Buyer);
const cfg = (over: Partial<Settings> = {}): Settings => ({ ...DEF_SETTINGS, ...over });

// Decode the printed image back to text: paint the 1-bit raster at 2 px/dot on white and run jsQR —
// proves the printed QR really encodes the URL.
function decodeRaster(r: FullRaster): string | null {
  const px = 2, w = r.w * px, h = r.h * px;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) {
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) { const k = ((y * px + j) * w + x * px + i) * 4; data[k] = data[k + 1] = data[k + 2] = 0; }
  }
  return jsQR(data, w, h)?.data ?? null;
}

describe("printSlip web path — the QR in the laptop sticker image", () => {
  let captured: HTMLIFrameElement | null;
  beforeEach(() => {
    captured = null;
    __resetWebPrintQueue();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === "iframe") captured = el as HTMLIFrameElement;
      return el;
    });
    setStickerQrEntitled(true);
    setStickerQrOn(true);
  });
  afterEach(() => {
    setStickerQrOn(false); setStickerQrEntitled(false);
    __resetWebPrintQueue(); vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((f) => f.remove());
  });
  const printed = async (b: Buyer, c: Settings): Promise<FullRaster> => {
    const r = printSlip(b, "NT$", "My Shop", c);
    expect(r).toEqual({ ok: true, via: "browser" });
    await __webPrintIdle();
    const html = captured?.contentDocument?.documentElement.outerHTML || "";
    expect(html).toContain("@page{size:");
    return rasterFromBmpDataUrl(pageSrc(html));
  };

  it("toggle ON → the QR is in the printed image and decodes to the buyer's TikTok link (100×60)", async () => {
    expect(decodeRaster(await printed(buyer(), cfg({ stickerSize: "100x60" })))).toBe("https://tiktok.com/@annc");
  });
  it("60×40 too — the laptop uses the image layouts, which carry a QR on every size", async () => {
    expect(decodeRaster(await printed(buyer(), cfg({ stickerSize: "60x40" })))).toBe("https://tiktok.com/@annc");
  });
  it("a leading @ in the handle is stripped from the link", async () => {
    expect(decodeRaster(await printed(buyer({ handle: "@annc" }), cfg({ stickerSize: "100x60" })))).toBe("https://tiktok.com/@annc");
  });
  it("toggle OFF → no QR in the image", async () => {
    setStickerQrOn(false);
    expect(decodeRaster(await printed(buyer(), cfg({ stickerSize: "100x60" })))).toBeNull();
  });
  it("toggle on but NOT entitled (off-market) → no QR", async () => {
    setStickerQrEntitled(false);
    expect(decodeRaster(await printed(buyer(), cfg({ stickerSize: "100x60" })))).toBeNull();
  });
  it("blank handle → no QR", async () => {
    expect(decodeRaster(await printed(buyer({ handle: "" }), cfg({ stickerSize: "100x60" })))).toBeNull();
  });
  it("@username line OFF → no QR (same rule as the phone)", async () => {
    expect(decodeRaster(await printed(buyer(), cfg({ stickerSize: "100x60", printBuyerUsername: false })))).toBeNull();
  });
});
