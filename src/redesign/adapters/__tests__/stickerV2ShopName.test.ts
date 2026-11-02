// Sticker layout v2 — the shop name on the top line (60×40 only; 50×30 / Niimbot unchanged until approved).
// Present/absent per Settings → "Shop name"; cut with "…" so it never reaches the date; nothing overlaps
// the QR; the rest of the v2 stack (Buyer 88, name → @username → comment) is unchanged.
import { describe, it, expect, beforeEach } from "vitest";
import jsqr from "jsqr";
import { buildNativeStickerPayload, imageStickerPayload, imagePathAtlases, buildSettingsFromRedesign, setStickerQrEntitled, setStickerQrOn, setStickerSpacingAllowed, setStickerCompactV2, NIIMBOT_CANVAS, type NativeStickerPayload } from "../printing";
import { propLayoutLinesV2, renderStickerBitmap, renderPropCompact, propQrInkLeft, COMPACT_V2_GAP, type RasterPayload, type RasterAtlases, type FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

const AT = Date.UTC(2026, 10, 3, 12, 15);
const LONG = "BudgetUkay Live Selling Shop and Lailine Ukay Warehouse Taipei";
function buyer(): Buyer { return { handle: "amy.ukay2026", name: "Amy Santos", platform: "TikTok", num: 88, totalSpent: 350, totalOrders: 1, orders: [{ orderNum: AT, item: "Black dress M 350", qty: 1, price: 350, total: 350, time: "20:15", handle: "amy.ukay2026", name: "Amy Santos", bNum: 88, platform: "TikTok", status: "New", date: "2026-11-03" }] } as Buyer; }
async function make(w: number, h: number, shop: string, shopOn: boolean, qr = true): Promise<{ np: NativeStickerPayload; img: RasterPayload; atl: RasterAtlases }> {
  const base = buildSettingsFromRedesign({ pp: { shopName: shopOn, shopNameSize: 1, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 }, psType: "bt", psOut: "sticker", psSize: `${w}x${h}mm` });
  setStickerQrEntitled(true); setStickerQrOn(qr); setStickerSpacingAllowed(true); setStickerCompactV2(true);
  const np = buildNativeStickerPayload(buyer(), "NT$", shop, base, AT);
  const img = imageStickerPayload(np, "TikTok");
  return { np, img, atl: await imagePathAtlases(np, img) };
}
const decode = (r: FullRaster) => { const rgba = new Uint8ClampedArray(r.w * r.h * 4); for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const v = (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) ? 0 : 255; const i = (y * r.w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255; } return jsqr(rgba, r.w, r.h)?.data; };
const STACK = ["Buyer", "88", "Amy Santos", "@amy.ukay2026", "Black dress M 350"];
beforeEach(() => { setStickerCompactV2(false); });

describe("60×40 — shop name on the top line", () => {
  it("ON → bold shop line, left, on the date's line (baselines aligned); OFF → exactly today's v2 lines", async () => {
    for (const shop of ["Lailine", "小美的店"]) {
      const on = await make(60, 40, shop, true);
      const v2 = propLayoutLinesV2(on.img, 60, 40, on.atl);
      const shopLine = v2.lines.find((l) => l.line.text === shop)!;
      const date = v2.lines.find((l) => l.line.text === "11/03 20:15")!;
      expect(shopLine.bold).toBe(true);
      expect(shopLine.x).toBe(12);                                   // left edge
      expect(shopLine.top + shopLine.font.base).toBe(date.top + date.font.base); // same line as the date
      expect(shopLine.size).toBe(24);                                 // one step larger than the 20 px date — it fits
      expect(date.x + date.line.inkWidth).toBe(v2.w - 12);           // the date stays top-right
      expect(v2.lines.map((l) => l.line.text)).toEqual([shop, "11/03 20:15", ...STACK]); // everything else unchanged, in order
      const off = await make(60, 40, shop, false);
      expect(propLayoutLinesV2(off.img, 60, 40, off.atl).lines.map((l) => l.line.text)).toEqual([...STACK, "11/03 20:15"]);
    }
  });
  it("a long shop name is cut with '…' at the date's size and NEVER reaches the date; the bold dot stays inside the gap", async () => {
    const { img, atl } = await make(60, 40, LONG, true);
    const v2 = propLayoutLinesV2(img, 60, 40, atl);
    const shopLine = v2.lines[0], date = v2.lines[1];
    expect(shopLine.line.cut).toBe(true);
    expect(shopLine.line.text.endsWith("…")).toBe(true);
    expect(shopLine.size).toBe(20);
    expect(shopLine.x + shopLine.line.inkWidth + 1).toBeLessThan(date.x - COMPACT_V2_GAP); // +1 = the bold dot
  });
  it("nothing overlaps the QR: every line ends before the QR block, the shop row sits above it, and the QR still decodes", async () => {
    for (const shop of ["Lailine", LONG, "小美的店"]) {
      const { img, atl } = await make(60, 40, shop, true);
      const v2 = propLayoutLinesV2(img, 60, 40, atl);
      const qr = v2.qr!;
      // the shop row sits ABOVE the QR (the QR moves below it), so only the rows beside the QR must end before its block
      for (const l of v2.lines.slice(2)) expect(l.x + l.line.inkWidth + 1, l.line.text).toBeLessThanOrEqual(qr.x0);
      const date = v2.lines.find((l) => l.line.text === "11/03 20:15")!;
      expect(date.x).toBeGreaterThanOrEqual(propQrInkLeft(qr) - 40); // the date sits in the QR column, above the block
      const rowBottom = Math.max(v2.lines[0].top + v2.lines[0].font.h, date.top + date.font.h);
      expect(qr.y0).toBeGreaterThanOrEqual(rowBottom + COMPACT_V2_GAP);
      expect(qr.y0 + qr.foot).toBeLessThanOrEqual(v2.h);
      expect(decode(renderStickerBitmap(img, 60, 40, atl))).toBe("https://tiktok.com/@amy.ukay2026");
    }
  });
  it("QR off: the shop line still ends before the date", async () => {
    const { img, atl } = await make(60, 40, LONG, true, false);
    const v2 = propLayoutLinesV2(img, 60, 40, atl);
    expect(v2.qr).toBeNull();
    expect(v2.lines[0].x + v2.lines[0].line.inkWidth + 1).toBeLessThan(v2.lines[1].x - COMPACT_V2_GAP);
  });
});

describe("50×30 and the Niimbot frame are NOT changed (preview only until approved)", () => {
  it("no shop line with Shop name ON; the preview option is opt-in", async () => {
    const { img, atl } = await make(50, 30, "Lailine", true);
    expect(propLayoutLinesV2(img, 50, 30, atl).lines.map((l) => l.line.text)).toEqual([...STACK, "11/03 20:15"]);
    expect(propLayoutLinesV2(img, 50, 30, atl, NIIMBOT_CANVAS).lines.map((l) => l.line.text)).toEqual([...STACK, "11/03 20:15"]);
    expect(propLayoutLinesV2(img, 50, 30, atl, undefined, { shopLine: true }).lines[0].line.text).toBe("Lailine");
    expect(renderPropCompact(img, 50, 30, atl).buf).toEqual(renderPropCompact(img, 50, 30, atl, undefined, false, {}).buf);
  });
});
