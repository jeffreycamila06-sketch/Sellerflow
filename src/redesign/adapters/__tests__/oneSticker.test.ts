// ONE STICKER engine — behaviour (not structure): what prints, the layout rules of the approved spec,
// fit warnings, custom sizes, printer limits. The fallback drawer is a deterministic stub here (it
// records every run it is asked to draw and paints a solid box) so "no character is ever removed" is
// proven without depending on the fonts of the machine running the tests.
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeSettings, recommendedSettings, renderOneSticker, layoutSticker, SCALE_STEPS, snapScale, validCustomMm, isSmallClass, tooWideFor, printerLimitFor, baseSizes, type OneStickerInput, type OneStickerSettings } from "../oneSticker";
import { printableText, measure, type Fonts } from "../oneStickerText";
import { setFallbackRunDrawer, type RunDrawer } from "../oneStickerFonts";
import { oneStickerInputFrom, stickerShopName, textStickerSizeFor } from "../oneStickerPrint";
import { fullFonts } from "./oneSticker.harness";
import type { Buyer } from "../../../lib/orderTypes";

const drawn: string[] = [];
const stub: RunDrawer = {
  drawRun(text, px) {
    drawn.push(text);
    const w = Math.max(1, Math.round(px * 0.6 * Array.from(text).length)), h = Math.round(px * 0.9);
    const rowBytes = (w + 7) >> 3; const buf = new Uint8Array(rowBytes * h).fill(0xff);
    return { w, h, rowBytes, buf, x0: 0, y0: -Math.round(px * 0.75), adv: w };
  },
};
let F: Fonts;
beforeAll(async () => { F = await fullFonts(); setFallbackRunDrawer(stub); });

const AT0 = Date.UTC(2026, 10, 6, 17, 30);
const inp = (o: Partial<OneStickerInput> = {}): OneStickerInput => ({ storeName: "Maria Ukay", date: "2026/11/07", time: "14:05", buyerNum: 12, name: "Amy Chen", handle: "amy.shop", platform: "TikTok", items: ["A2 x2"], ...o });
const S = (w = 100, h = 60, patch?: (s: OneStickerSettings) => void) => { const s = recommendedSettings({ w, h }); patch?.(s); return s; };
const ink = (r: { buf: Uint8Array }) => r.buf.reduce((a, b) => a + (b ? 1 : 0), 0);
const texts = (s: OneStickerSettings, i: OneStickerInput) => layoutSticker(s, i, F).lines.map((l) => l.run.text);

describe("what prints", () => {
  it("fancy letters become normal letters, emoji are removed, full-width and kana stay", () => {
    expect(printableText("🔥𝓐𝓶𝔂 𝐋𝐢𝐦🔥")).toBe("Amy Lim");
    expect(printableText("Ⓐⓜⓨ 🅰🄱")).toBe("Amy AB");
    expect(printableText("田中さん「ワンピース」１２３Ｍ ｶﾅ")).toBe("田中さん「ワンピース」１２３Ｍ ｶﾅ"); // NOT folded to ASCII
    expect(printableText("ok 👍🏽❤️ 🇵🇭")).toBe("ok");
  });
  it("no printable character is ever removed — every script reaches a glyph source", () => {
    const words = ["田中さん「ワンピース」１２３", "、。「」", "ｶﾅ", "김민지 한국어", "ไทย ขอบคุณค่ะ", "العربية مرحبا", "Български", "Nguyễn Thị Hằng", "連衣裙 连衣裙"];
    for (const w of words) {
      drawn.length = 0;
      const run = measure(w, 30, 700, F);
      const covered = run.pieces.map((p) => p.text).join("");
      expect(covered, w).toBe(w.replace(/ /g, " ")); // every character is in a piece (none dropped)
      for (const p of run.pieces) expect(p.adv, `${w} ${p.text}`).toBeGreaterThan(p.text === " " ? 0 : 0.5);
    }
  });
  it("Japanese kana, CJK punctuation and full-width are drawn from the bundled Sans (not the device font)", () => {
    const run = measure("さん「１２３」ｶﾅ", 30, 700, F);
    expect(run.pieces.every((p) => p.src === "cjkx")).toBe(true);
  });
  it("Bulgarian and Vietnamese use the Sans outlines; Hangul, Thai and Arabic go to the device font as whole words", () => {
    expect(measure("Мария Nguyễn", 30, 700, F).pieces.every((p) => p.src === "sans")).toBe(true);
    drawn.length = 0;
    measure("한국어 ไทย", 30, 400, F);
    expect(drawn).toEqual(["한국어", "ไทย"]);
    drawn.length = 0;
    const ar = measure("العربية مرحبا", 30, 400, F);
    expect(ar.pieces).toHaveLength(1); // the right-to-left phrase is one run (order + joining by the device)
    expect(ar.pieces[0].rtl).toBe(true);
  });
});

describe("layout (approved spec)", () => {
  it("date & time always top-right; the shop name is never the app brand; blank shop = no header", () => {
    const l = layoutSticker(S(), inp(), F);
    const date = l.lines[0];
    expect(date.run.text).toBe("2026/11/07 14:05");
    expect(date.x + date.run.width).toBeLessThanOrEqual(l.w);
    expect(date.x).toBeGreaterThan(l.w / 2);
    expect(stickerShopName("SellerFlowLive")).toBe("");
    expect(texts(S(), inp({ storeName: "" }))).not.toContain("SellerFlowLive");
    expect(texts(S(), inp({ storeName: "" }))[1]).toBe("Buyer"); // first line under the date = the buyer line
  });
  it("50×30-class: the shop name never prints", () => {
    expect(isSmallClass(50, 30)).toBe(true);
    expect(isSmallClass(40, 30)).toBe(true);
    expect(isSmallClass(60, 40)).toBe(false);
    expect(texts(S(50, 30), inp())).not.toContain("Maria Ukay");
    expect(texts(S(60, 40), inp())).toContain("Maria Ukay");
  });
  it("'Buyer 12' = a small word and a big number on one baseline", () => {
    const l = layoutSticker(S(), inp(), F);
    const word = l.lines.find((x) => x.run.text === "Buyer")!, num = l.lines.find((x) => x.run.text === "12")!;
    expect(word.baseline).toBe(num.baseline);
    expect(num.px).toBeGreaterThan(word.px * 2);
    expect(num.x).toBeGreaterThan(word.x + word.run.width);
  });
  it("Facebook: no @username, no QR, the name may use 2 lines", () => {
    const fb = inp({ storeName: "", platform: "Facebook", name: "Maria Clara Dela Cruz Santos Reyes Mendoza", handle: "Maria Clara" });
    const l = layoutSticker(S(60, 40), fb, F);
    expect(l.qr).toBeNull();
    expect(l.lines.some((x) => x.run.text.startsWith("@"))).toBe(false);
    const nameLines = l.lines.filter((x) => /Maria|Mendoza|Reyes|Santos/.test(x.run.text));
    expect(nameLines.length).toBe(2);
    const tt = layoutSticker(S(60, 40), inp(), F);
    expect(tt.qr).not.toBeNull();
    expect(tt.lines.some((x) => x.run.text === "@amy.shop")).toBe(true);
  });
  it("text next to the date/QR stays left of them with a clear gap (never touching)", () => {
    for (const [w, h] of [[50, 30], [60, 40], [70, 50], [80, 50], [80, 60], [100, 60], [40, 30], [75, 45]]) {
      const l = layoutSticker(S(w, h), inp({ items: ["x".repeat(400)] }), F);
      if (!l.qr) continue;
      const qrLeft = l.qr.x, qrTop = l.qr.y, qrBottom = l.qr.y + l.qr.matrix.length * l.qr.mod;
      for (const line of l.lines.slice(1)) {
        const top = line.baseline - line.px, bottom = line.baseline + Math.round(line.px * 0.3);
        if (bottom < qrTop || top > qrBottom) continue;
        expect(line.x + Math.min(line.run.width, line.clip - line.x), `${w}x${h} ${line.run.text}`).toBeLessThanOrEqual(qrLeft - l.qr.mod * 4);
      }
    }
  });
  it("comment: starts at the chosen size, shrinks step by step but never below the minimum, then '…'; never grows", () => {
    const short = layoutSticker(S(), inp({ items: ["A2"] }), F);
    expect(short.commentPx).toBe(baseSizes(100, 60).comment); // 1× = never bigger than chosen
    const long = layoutSticker(S(), inp({ items: ["please reserve the black dress size M and the red one too ".repeat(3)] }), F);
    expect(long.commentPx!).toBeLessThan(baseSizes(100, 60).comment);
    expect(long.commentPx!).toBeGreaterThanOrEqual(baseSizes(100, 60).minComment);
    const huge = layoutSticker(S(50, 30), inp({ items: ["word ".repeat(200)] }), F);
    expect(huge.commentPx).toBe(baseSizes(50, 30).minComment);
    const commentLines = huge.lines.filter((x) => x.px === huge.commentPx);
    expect(commentLines.length).toBeGreaterThan(1); // uses every free line
    expect(commentLines[commentLines.length - 1].run.text.endsWith("…")).toBe(true);
  });
  it("a part switched OFF frees its space for the comment", () => {
    const text = "please reserve the black dress size M and the red one too and the blue one ".repeat(2);
    const on = layoutSticker(S(60, 40), inp({ items: [text] }), F);
    const off = layoutSticker(S(60, 40, (s) => { s.parts.name.on = false; s.parts.user.on = false; }), inp({ items: [text] }), F);
    expect(off.commentPx!).toBeGreaterThanOrEqual(on.commentPx!);
    expect(off.lines.filter((x) => x.px === off.commentPx).length).toBeGreaterThanOrEqual(on.lines.filter((x) => x.px === on.commentPx).length);
  });
  it("every control changes the picture (0.6× / 1× / 2×, Normal / Bold / Extra, OFF)", () => {
    for (const k of ["shop", "buyer", "name", "user", "comment"] as const) {
      const pics = new Set<string>();
      for (const scale of [0.6, 1, 2]) pics.add(Buffer.from(renderOneSticker(S(100, 60, (s) => { s.parts[k].scale = scale; }), inp(), F).buf).toString("base64"));
      for (const weight of ["normal", "bold", "extra"] as const) pics.add(Buffer.from(renderOneSticker(S(100, 60, (s) => { s.parts[k].weight = weight; }), inp(), F).buf).toString("base64"));
      pics.add(Buffer.from(renderOneSticker(S(100, 60, (s) => { s.parts[k].on = false; }), inp(), F).buf).toString("base64"));
      expect(pics.size, k).toBe(6); // 1× + bold are the same picture → 3 + 3 + 1 − 1
    }
  });
  it("a part that does not fit → a fit warning, but the sticker still prints", () => {
    const r = renderOneSticker(S(50, 30, (s) => { s.parts.buyer.scale = 2; }), inp({ buyerNum: 8888 }), F);
    expect(r.warnings.map((w) => w.part)).toContain("buyer");
    expect(ink(r)).toBeGreaterThan(100);
  });
});

describe("settings, sizes, printers", () => {
  it("steps are exactly the approved ladder; anything stored wrong becomes recommended", () => {
    expect([...SCALE_STEPS]).toEqual([0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2]);
    expect(snapScale(1.4)).toBe(1.3);
    const n = normalizeSettings({ size: { w: 999, h: 5 }, parts: { name: { on: false, weight: "huge", scale: 9 } }, qr: false });
    expect(n.size).toEqual({ w: 100, h: 60 });
    expect(n.parts.name).toEqual({ on: false, weight: "bold", scale: 2 });
    expect(n.qr).toBe(false);
    expect(recommendedSettings().parts.comment).toEqual({ on: true, weight: "bold", scale: 1 });
  });
  it("custom size: 30–110 mm each", () => {
    expect([29, 30, 110, 111, 45.5].map(validCustomMm)).toEqual([false, true, true, false, false]);
    for (const [w, h] of [[40, 30], [75, 45], [30, 30], [110, 110]]) {
      const r = renderOneSticker(S(w, h), inp(), F);
      expect([r.w, r.h]).toEqual([w * 8, h * 8]);
    }
  });
  it("printer width limits come from each model's spec", () => {
    expect(printerLimitFor("B1-H123")?.maxLabelMm).toBe(50);
    expect(printerLimitFor("B3S_P-1234")?.maxLabelMm).toBe(75);
    expect(printerLimitFor("Y41BT-0FC4_LE")?.printMm).toBe(108);
    expect(printerLimitFor("D520BT-Z")?.printMm).toBe(108);
    expect(tooWideFor("B21-AB", 60)?.model).toBe("B21");
    expect(tooWideFor("B21-AB", 50)).toBeNull();
    expect(tooWideFor(null, 110)).toBeNull();
  });
  it("the order's input: Taipei date + order time, items of every order, the brand never as shop", () => {
    const b = { num: 7, name: "Amy", handle: "amy", platform: "TikTok", orders: [{ orderNum: Date.UTC(2026, 10, 6, 17, 30), item: "A1" }, { orderNum: Date.UTC(2026, 10, 6, 17, 31), item: "B2 x2" }] } as unknown as Buyer;
    const i = oneStickerInputFrom(b, "SellerFlowLive", Date.UTC(2026, 10, 6, 17, 30));
    expect(i).toMatchObject({ storeName: "", date: "2026/11/07", time: "01:30", items: ["A1", "B2 x2"] });
    // Facebook post-sales prints carry buyer number 0 → no buyer line (today: printBuyerNumber off)
    const post = oneStickerInputFrom({ ...b, num: 0, platform: "Facebook" } as Buyer, "Shop", AT0);
    expect(post.buyerNum).toBeUndefined();
    expect(layoutSticker(S(60, 40), post, F).lines.some((l) => l.run.text === "Buyer")).toBe(false);
  });
});

describe("TEXT fallback size", () => {
  it("the TEXT sticker never gets a layout bigger than the chosen label (no 50×30 row there)", () => {
    expect(textStickerSizeFor({ w: 100, h: 60 })).toBe("100x60");
    expect(textStickerSizeFor({ w: 75, h: 45 })).toBe("60x40");
    expect(textStickerSizeFor({ w: 80, h: 50 })).toBe("80x50");
    expect(textStickerSizeFor({ w: 50, h: 30 })).toBe("60x40"); // nothing fits → the smallest TEXT size
  });
});
