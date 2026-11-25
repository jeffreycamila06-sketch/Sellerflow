// Live camera frames for the in-page scanner: every QR in a frame WITH where it is (readQrHitsFromPixels).
// Real stickers (the app's own sticker drawing, the QR the printer prints) in a camera-sized frame, read
// by the stronger reader (WebAssembly) — the same loader as the photo flow. The positions feed the centre
// rule (src/lib/qrCentrePick.ts): one sticker in the frame is read; two close ones are never guessed.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { stickerImage, photo, type Rgba } from "./qrPhoto.harness";

vi.mock("../qrWasm", async () => {
  const fs = await import("node:fs");
  const b = fs.readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
  return { zxingOverrides: () => ({ wasmBinary: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }) };
});
vi.mock("../../analytics", () => ({ track: vi.fn() }));
import { readQrHitsFromPixels } from "../qrDecode";
import { pickCentreQr } from "../../../lib/qrCentrePick";

const URL_A = "https://tiktok.com/@jhun.belle", URL_B = "https://tiktok.com/@maria_live";
const W = 960, H = 960, PX = 0.8;            // a read frame of the scanner; a 60×40 sticker = 384×256 px in it
const A_AT = { cx: 250, cy: 300 }, B_AT = { cx: 700, cy: 660 };
const inside = (hit: { cx: number; cy: number }, at: { cx: number; cy: number }) => Math.abs(hit.cx - at.cx) <= 192 && Math.abs(hit.cy - at.cy) <= 128;
let one: Rgba, two: Rgba, none: Rgba;
beforeAll(async () => {
  const A = await stickerImage({ w: 60, h: 40 }, "jhun.belle"), B = await stickerImage({ w: 60, h: 40 }, "maria_live");
  const N = await stickerImage({ w: 60, h: 40 }, "x", false);
  one = photo(W, H, [{ img: A, ...A_AT, pxPerDot: PX, rotDeg: 2 }], { blur: 0.6 });
  two = photo(W, H, [{ img: A, ...A_AT, pxPerDot: PX, rotDeg: 2 }, { img: B, ...B_AT, pxPerDot: PX, rotDeg: -3 }], { blur: 0.6 });
  none = photo(W, H, [{ img: N, cx: 480, cy: 480, pxPerDot: PX }], { blur: 0.6 });
}, 60000);

describe("readQrHitsFromPixels — the stronger reader", () => {
  it("one sticker → its QR text (verbatim) and a centre INSIDE that sticker", async () => {
    const hits = (await readQrHitsFromPixels(one))!;
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe(URL_A);
    expect(inside(hits[0], A_AT)).toBe(true);
  }, 30000);
  it("two stickers → both, each with its own place", async () => {
    const hits = (await readQrHitsFromPixels(two))!;
    expect(hits.map((h) => h.text).sort()).toEqual([URL_A, URL_B].sort());
    expect(inside(hits.find((h) => h.text === URL_A)!, A_AT)).toBe(true);
    expect(inside(hits.find((h) => h.text === URL_B)!, B_AT)).toBe(true);
  }, 30000);
  it("no QR in the frame → an empty list (not 'no reader')", async () => {
    expect(await readQrHitsFromPixels(none)).toEqual([]);
  }, 30000);
  it("an empty picture → an empty list", async () => {
    expect(await readQrHitsFromPixels({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toEqual([]);
  });
  it("with the centre rule: the frame on sticker A reads A; a frame that holds both, equally near, reads nothing", async () => {
    const hits = (await readQrHitsFromPixels(two))!;
    const a = hits.find((h) => h.text === URL_A)!, b = hits.find((h) => h.text === URL_B)!;
    expect(pickCentreQr(hits, { cx: a.cx, cy: a.cy, side: 300 })).toEqual({ kind: "one", text: URL_A });
    expect(pickCentreQr(hits, { cx: b.cx, cy: b.cy, side: 300 })).toEqual({ kind: "one", text: URL_B });
    expect(pickCentreQr(hits, { cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2, side: 900 })).toEqual({ kind: "tie" });
    expect(pickCentreQr(hits, { cx: 480, cy: 30, side: 40 })).toEqual({ kind: "none" });
  }, 30000);
});
