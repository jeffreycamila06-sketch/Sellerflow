// Compact layout v2 — PREVIEW (printing.ts STICKER_COMPACT_V2_PREVIEW). Flag OFF = nothing changes
// (the payload carries no flag, today's goldens stay green); flag ON (settings.printCompactV2) =
// "Buyer" + the big number, date top-right above the QR, comment wrapped to ≤3 lines, QR decodes.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import { stickerCompactV2Allowed, setStickerCompactV2, imagePathAtlases as loadImageAtlases, imageStickerPayload, imagePathAtlases, buildNativeStickerPayload, buildSettingsFromRedesign, setStickerQrEntitled, setStickerQrOn, NIIMBOT_CANVAS, type NativeStickerPayload } from "../printing";
import { renderStickerBitmap, stickerDrawOps, propLayoutLinesV2, propLayoutLines, propQrInkLeft, COMPACT_V2_MAX_COMMENT_LINES, COMPACT_V2_GAP, type RasterPayload, type RasterAtlases, type FullRaster } from "../stickerRaster";
import { setFeatureAccess } from "../featureAccess";
import { SWITCHES_OFF, parseSwitches } from "../featureSwitches";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { loadCjkAtlas } from "../cjkAtlasLoader";
import type { Buyer } from "../../../lib/orderTypes";

const AT = Date.UTC(2026, 9, 31, 12, 15);
const buyerOf = (item: string, name = "陳美玲 Amy"): Buyer => ({ handle: "amy.ukay2026", name, platform: "TikTok", num: 88, totalSpent: 350, totalOrders: 1,
  orders: [{ orderNum: AT, item, qty: 1, price: 350, total: 350, time: "20:15", handle: "amy.ukay2026", name, bNum: 88, platform: "TikTok", status: "New", date: "2026-10-31" }] } as Buyer);
const cfg = (w: number, h: number) => buildSettingsFromRedesign({ pp: { shopName: true, shopNameSize: 1, dateTime: true, dateTimeSize: 1, buyerNum: true, buyerNumSize: 1, tiktokName: true, tiktokNameSize: 1, tiktokUser: true, tiktokUserSize: 1, comment: true, commentSize: 1 }, psType: "bt", psOut: "sticker", psSize: `${w}x${h}mm` });
async function make(w: number, h: number, item: string, qr: boolean, v2: boolean): Promise<{ np: NativeStickerPayload; img: RasterPayload; atl: RasterAtlases }> {
  setStickerQrEntitled(true); setStickerQrOn(qr); setStickerCompactV2(v2);
  const np = buildNativeStickerPayload(buyerOf(item), "NT$", "Jeff Live Shop", cfg(w, h), AT);
  const img = imageStickerPayload(np, "TikTok");
  return { np, img, atl: await imagePathAtlases(np, img) };
}
beforeEach(() => { setStickerCompactV2(false); });

describe("compact v2 preview flag", () => {
  it("switch: OFF for a plain seller; ON for admins, for feature 'sticker_v2', and for everyone with app_settings sticker_layout_v2", () => {
    setFeatureAccess(null);
    expect(stickerCompactV2Allowed("seller@x.com", "seller", false)).toBe(false);
    expect(stickerCompactV2Allowed("seller@x.com", "admin", false)).toBe(true);
    expect(stickerCompactV2Allowed("seller@x.com", "seller", true)).toBe(true);
    setFeatureAccess({ sticker_v2: true });
    expect(stickerCompactV2Allowed("seller@x.com", "seller", false)).toBe(true);
    expect(stickerCompactV2Allowed("", "seller", false)).toBe(false);
    setFeatureAccess(null);
    expect(SWITCHES_OFF.stickerLayoutV2).toBe(false);
    expect(parseSwitches([{ key: "sticker_layout_v2", value: "true" }]).stickerLayoutV2).toBe(true);
    expect(parseSwitches([{ key: "sticker_layout_v2", value: "TRUE" }]).stickerLayoutV2).toBe(false);
  });
  it("OFF: the payload carries no printCompactV2 (today's bytes — the goldens stay green)", async () => {
    const { img } = await make(60, 40, "黑色洋裝 M NT$350", true, false);
    expect(img.settings?.printCompactV2).toBeUndefined();
  });
  it("ON: 'Buyer' word + today's number size, date top-right above the QR, text never inside the QR block", async () => {
    for (const [w, h] of [[50, 30], [60, 40]] as const) {
      const { img, atl } = await make(w, h, "黑色洋裝 M NT$350", true, true);
      const today = propLayoutLines(img, w, h, atl);
      const v2 = propLayoutLinesV2(img, w, h, atl);
      const num = v2.lines.find((l) => l.line.text === "88")!;
      const word = v2.lines.find((l) => l.line.text === "Buyer")!;
      expect(num.size).toBe(today.lines[0].size);                // the number is as big as today
      expect(word.x + word.line.width + COMPACT_V2_GAP).toBe(num.x); // small word right before it
      expect(word.top + word.font.base).toBe(num.top + num.font.base); // baselines aligned
      const date = v2.lines.find((l) => l.line.text === "10/31 20:15")!;
      expect(date.x + date.line.inkWidth).toBe(v2.w - (w === 50 ? 4 : 12)); // ink ends `edge` before the right edge
      expect(v2.qr!.y0).toBeGreaterThanOrEqual(date.top + date.font.h + COMPACT_V2_GAP); // QR below the date band
      expect(v2.qr!.y0 + v2.qr!.foot).toBeLessThanOrEqual(v2.h);
      const inkL = propQrInkLeft(v2.qr!);
      for (const l of v2.lines) if (l !== date) expect(l.x + l.line.inkWidth).toBeLessThanOrEqual(v2.qr!.x0); // stack stops before the block
      expect(date.x).toBeGreaterThanOrEqual(inkL - 40); // the date sits in the QR column (right-aligned)
    }
  });
  it("ON, QR off: full-width text, date still top-right, buyer line stops before the date", async () => {
    const { img, atl } = await make(60, 40, "黑色洋裝 M NT$350", false, true);
    const v2 = propLayoutLinesV2(img, 60, 40, atl);
    expect(v2.qr).toBeNull();
    const date = v2.lines.find((l) => l.line.text === "10/31 20:15")!;
    const num = v2.lines.find((l) => l.line.text === "88")!;
    expect(num.size).toBe(64);
    expect(num.x + num.line.inkWidth + 2 * COMPACT_V2_GAP).toBeLessThanOrEqual(date.x);
    expect(date.x + date.line.inkWidth).toBe(v2.w - 12);
  });
  it("ON: a long comment WRAPS FIRST at the normal size, shrinks only when 3 lines still cut, the last line cut with '…'", async () => {
    const mid = "Black dress M size 350, pa-reserve po 2 pcs";
    for (const [w, h] of [[50, 30], [60, 40]] as const) {
      const { img, atl } = await make(w, h, mid, true, true);
      const v2 = propLayoutLinesV2(img, w, h, atl);
      const normal = w === 50 ? 20 : 24;
      const comment = v2.lines.filter((l) => !["Buyer", "88", "Amy Santos", "@amy.ukay2026", "10/31 20:15"].includes(l.line.text));
      expect(comment.length).toBeGreaterThan(1);               // wrapped…
      for (const l of comment) { expect(l.size).toBe(normal); expect(l.line.cut).toBe(false); } // …at the NORMAL size, nothing cut
    }
    const long = "黑色洋裝 M NT$350 at isa pang 白色上衣 size L para sa ate ko salamat po, saka yung 紅色裙子 size S at 藍色外套 XL para kay mama, bayad na lahat";
    for (const [w, h] of [[50, 30], [60, 40]] as const) {
      const { img, atl } = await make(w, h, long, true, true);
      const v2 = propLayoutLinesV2(img, w, h, atl);
      const comment = v2.lines.filter((l) => l.size === 18 && l.line.text !== "10/31 20:15");
      expect(comment.length).toBeGreaterThan(1);                // shrunk to the smallest size only because 3 normal-size lines still cut
      expect(comment.length).toBeLessThanOrEqual(COMPACT_V2_MAX_COMMENT_LINES);
      expect(comment[comment.length - 1].line.text.endsWith("…")).toBe(true);
      for (let i = 1; i < comment.length; i++) expect(comment[i].top).toBeGreaterThan(comment[i - 1].top);
      expect(propLayoutLines(img, w, h, atl).lines.filter((l) => l.line.cut).length).toBe(1); // today: one cut line
    }
  });
  it("ON: the QR decodes on EVERY size, on the Niimbot frame, and on the AIMO D520BT stream's atlases at 60×40", async () => {
    const decode = (r: FullRaster) => { const rgba = new Uint8ClampedArray(r.w * r.h * 4); for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const ink = (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0; const v = ink ? 0 : 255; const i = (y * r.w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255; } return jsQR(rgba, r.w, r.h)?.data; };
    for (const [w, h] of [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60]] as const) {
      const { img, atl } = await make(w, h, "Black dress M 350", true, true);
      expect(decode(renderStickerBitmap(img, w, h, atl)), `${w}x${h}`).toBe("https://tiktok.com/@amy.ukay2026");
    }
    const nii = await make(50, 30, "Black dress M 350", true, true);
    expect(decode(renderStickerBitmap(nii.img, 50, 30, nii.atl, "extended", NIIMBOT_CANVAS))).toBe("https://tiktok.com/@amy.ukay2026");
    // AIMO 60×40: today = {latin, cjk} → fixed-cell, NO QR; ON = the imagePathAtlases the SDK path now loads → compact v2 WITH the QR
    const aimo = await make(60, 40, "Black dress M 350", true, true);
    const todayAtl: RasterAtlases = { latin: LATIN_ATLAS, cjk: await loadCjkAtlas() };
    expect(decode(renderStickerBitmap({ ...aimo.img, settings: { ...aimo.img.settings, printCompactV2: undefined } }, 60, 40, todayAtl))).toBeUndefined();
    expect(decode(renderStickerBitmap(aimo.img, 60, 40, await loadImageAtlases(aimo.np, aimo.img)))).toBe("https://tiktok.com/@amy.ukay2026");
    const src = readFileSync(join(process.cwd(), "src/redesign/adapters/printing.ts"), "utf8");
    expect(src).toMatch(/stickerCompactV2Effective\(\) && isPropCompactSize\(payload\.labelWidthMm, payload\.labelHeightMm\) \? await imagePathAtlases\(payload, qrPayload\) : null/);
  });
});

describe("layout v2 preview — line order and the big-size header", () => {
  it("compact: name BEFORE @username (today: @username first)", async () => {
    const { img, atl } = await make(60, 40, "Black dress M 350", true, true);
    const v2 = propLayoutLinesV2(img, 60, 40, atl);
    const name = v2.lines.find((l) => l.line.text === "陳美玲 Amy")!, handle = v2.lines.find((l) => l.line.text === "@amy.ukay2026")!;
    expect(name.top).toBeLessThan(handle.top);
    const today = propLayoutLines(img, 60, 40, atl).lines.map((l) => l.line.text);
    expect(today.indexOf("@amy.ukay2026")).toBeLessThan(today.indexOf("陳美玲 Amy"));
  });
  it("big sizes ON: header = the seller's shop name + date and time, no 'SellerFlowLive', no second shop line; OFF = today", async () => {
    for (const [w, h] of [[70, 50], [100, 60]] as const) {
      const on = (await make(w, h, "Black dress M 350", true, true)).img;
      const ops = stickerDrawOps(on, w, h, "extended", null).ops.filter((o) => o.k === "txt");
      const texts = ops.map((o) => o.s);
      expect(texts).not.toContain("SellerFlowLive");
      expect(texts.filter((t) => t === "Jeff Live Shop")).toHaveLength(1);
      expect(ops.find((o) => o.s === "Jeff Live Shop")!.y).toBe(10);
      expect(texts).toContain("10/31/2026 20:15");
      expect(texts).not.toContain("20:15"); // the v2 time slot is not drawn twice
      expect(ops.find((o) => o.s === "Buyer")!.y).toBe(60); // the stack starts right under the bar
      const off = stickerDrawOps((await make(w, h, "Black dress M 350", true, false)).img, w, h, "extended", null).ops.filter((o) => o.k === "txt").map((o) => o.s);
      expect(off).toContain("SellerFlowLive");
      expect(off).toContain("10/31/2026");
    }
  });
  it("big sizes ON, no shop name: date + time only in the header", async () => {
    setStickerQrEntitled(true); setStickerQrOn(false); setStickerCompactV2(true);
    const np = buildNativeStickerPayload(buyerOf("Black dress M 350"), "NT$", "", cfg(80, 50), AT);
    const texts = stickerDrawOps(imageStickerPayload(np, "TikTok"), 80, 50, "extended", null).ops.filter((o) => o.k === "txt").map((o) => o.s);
    expect(texts[0]).toBe("10/31/2026 20:15");
    expect(texts).not.toContain("SellerFlowLive");
  });
});

describe("layout v2 — Facebook long name wraps first", () => {
  it("a long Facebook name takes 2 lines at the normal size; the comment keeps a line", async () => {
    setStickerQrEntitled(true); setStickerQrOn(true); setStickerCompactV2(true);
    const b = buyerOf("Black dress M 350", "Maria Cristina Dela Cruz Santos Reyes Villanueva");
    b.platform = "Facebook"; b.handle = b.name; b.orders[0].platform = "Facebook"; b.orders[0].handle = b.name;
    const np = buildNativeStickerPayload(b, "NT$", "BudgetUkay", { ...cfg(50, 30), printBuyerUsername: false }, AT);
    const img = imageStickerPayload(np, "Facebook", true);
    const v2 = propLayoutLinesV2(img, 50, 30, await imagePathAtlases(np, img));
    const name = v2.lines.filter((l) => /^(Maria|Cristina|Dela|Cruz|Santos|Reyes|Villanueva)/.test(l.line.text));
    expect(name.length).toBe(2);
    for (const l of name) { expect(l.size).toBe(20); expect(l.line.cut).toBe(false); }
    expect(v2.lines.some((l) => l.line.text === "Black dress M 350")).toBe(true);
    expect(v2.qr).toBeNull(); // Facebook → no QR
  });
});
