// WEB STICKER QR — "Print QR on sticker" also works through the browser print dialog.
// printSlip's web path adds an inline SVG QR (bottom-right) using the SAME link
// (tiktokProfileUrl), the SAME ECC "M" and the same content rules as the phone:
// toggle on (+ entitled), @username line on, handle not blank. NO label-size check on
// web — the seller's browser/printer-driver settings decide the paper size.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jsQR from "jsqr";
import { printSlip, webStickerQrSvg, setStickerQrOn, setStickerQrEntitled, __resetWebPrintQueue, DEF_SETTINGS, type Settings } from "../printing";
import { qrMatrix } from "../../../lib/qr";
import type { Buyer } from "../../../lib/orderTypes";

const order = (over: Record<string, unknown> = {}) => ({ orderNum: 1750000000000, item: "A01", qty: 1, price: 320, total: 320, time: "9:41 PM", handle: "annc", name: "Ann Cruz", bNum: 12, platform: "TikTok", status: "New", date: "2026-09-26", ...over });
const buyer = (over: Partial<Buyer> = {}): Buyer => ({ handle: "annc", name: "Ann Cruz", platform: "TikTok", num: 12, orders: [order()], totalOrders: 1, totalSpent: 320, ...over } as Buyer);
const cfg = (over: Partial<Settings> = {}): Settings => ({ ...DEF_SETTINGS, ...over });

// Decode the SVG back to text: parse the "M{x} {y}h1v1h-1z" modules, paint them at
// 4 px/module on white, and run jsQR — proves the printed QR really encodes the URL.
function decodeSvg(svg: string): string | null {
  const total = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)![1]);
  const px = 4, w = total * px;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (const [, xs, ys] of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x0 = Number(xs) * px, y0 = Number(ys) * px;
    for (let y = y0; y < y0 + px; y++) for (let x = x0; x < x0 + px; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  }
  return jsQR(data, w, w)?.data ?? null;
}

describe("webStickerQrSvg — same link + ECC as the phone", () => {
  it("encodes https://tiktok.com/@<handle> (decodes back), strips a leading @", () => {
    for (const h of ["annc", "@annc"]) expect(decodeSvg(webStickerQrSvg(h)!.svg)).toBe("https://tiktok.com/@annc");
  });
  it("is the SAME matrix the phone uses (qrMatrix(url, 'M')) with the 4-module quiet zone, 0.5 mm/module", () => {
    const m = qrMatrix("https://tiktok.com/@annc", "M")!;
    const q = webStickerQrSvg("annc")!;
    const dark = m.flat().filter(Boolean).length;
    expect(q.svg.match(/h1v1h-1z/g)?.length).toBe(dark);
    expect(q.svg).toContain(`viewBox="0 0 ${m.length + 8} ${m.length + 8}"`);
    expect(q.sizeMm).toBe((m.length + 8) * 0.5);            // e.g. v2 (25) → 16.5 mm · v3 (29) → 18.5 mm
    expect(q.svg).toContain('shape-rendering="crispEdges"');
  });
  it("blank handle → null", () => {
    for (const h of ["", "   ", "@", null, undefined]) expect(webStickerQrSvg(h as string)).toBeNull();
  });
});

describe("printSlip web path — the QR in the browser-print sticker", () => {
  let captured: HTMLIFrameElement | null;
  beforeEach(() => {
    captured = null;
    __resetWebPrintQueue();
    vi.useFakeTimers();
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
    __resetWebPrintQueue(); vi.restoreAllMocks(); vi.useRealTimers();
    document.querySelectorAll("iframe").forEach((f) => f.remove());
  });
  const webHtml = () => captured?.contentDocument?.documentElement.outerHTML || "";

  it("toggle ON → the QR is in the printed sticker, bottom-right, and decodes to the buyer's TikTok link", () => {
    const r = printSlip(buyer(), "NT$", "My Shop", cfg());
    expect(r).toEqual({ ok: true, via: "browser" });
    const html = webHtml();
    const svg = /<svg class="qr"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
    expect(svg).not.toBe("");
    expect(decodeSvg(svg)).toBe("https://tiktok.com/@annc");
    const size = webStickerQrSvg("annc")!.sizeMm;
    expect(html).toContain(`width:${size}mm;height:${size}mm}`);
    expect(html).toMatch(/\.qr\{position:absolute;right:[^;]+;bottom:[^;]+;width:/); // bottom-right corner
  });

  it("text stays clear of the QR: name, @handle and the big code get right padding = QR width + 1.5 mm", () => {
    printSlip(buyer(), "NT$", "My Shop", cfg());
    const size = webStickerQrSvg("annc")!.sizeMm;
    expect(webHtml()).toContain(`.name,.user,.foot{padding-right:${size + 1.5}mm}`);
  });

  it("NO label-size check on web — a 60×40 setting still gets the QR (the driver decides the paper)", () => {
    printSlip(buyer(), "NT$", "My Shop", cfg({ stickerSize: "60x40" }));
    expect(webHtml()).toContain('<svg class="qr"');
    expect(webHtml()).not.toMatch(/@media[^{]*height/);
  });

  it("toggle OFF → no QR and no QR layout rules (sticker unchanged)", () => {
    setStickerQrOn(false);
    printSlip(buyer(), "NT$", "My Shop", cfg());
    const html = webHtml();
    expect(html).not.toContain("<svg");
    expect(html).not.toContain(".qr{");
    expect(html).not.toContain("padding-right");
  });

  it("toggle on but NOT entitled (off-market) → no QR", () => {
    setStickerQrEntitled(false);
    printSlip(buyer(), "NT$", "My Shop", cfg());
    expect(webHtml()).not.toContain("<svg");
  });

  it("blank handle → no QR", () => {
    printSlip(buyer({ handle: "" }), "NT$", "My Shop", cfg());
    expect(webHtml()).not.toContain("<svg");
  });

  it("@username line OFF → no QR (same rule as the phone)", () => {
    printSlip(buyer(), "NT$", "My Shop", cfg({ printBuyerUsername: false }));
    expect(webHtml()).not.toContain("<svg");
  });
});

describe("QR block size stays scannable and bounded", () => {
  it("short handle → v2 16.5 mm; typical TikTok handle → v3 18.5 mm; max-length handle ≤ 22.5 mm", () => {
    expect(webStickerQrSvg("annc")!.sizeMm).toBe(16.5);
    expect(webStickerQrSvg("budgetukay_shop")!.sizeMm).toBe(18.5);
    expect(webStickerQrSvg("a".repeat(24))!.sizeMm).toBeLessThanOrEqual(22.5); // TikTok caps usernames at 24 chars
  });
});
