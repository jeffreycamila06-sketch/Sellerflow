// Live camera frames when the stronger reader CANNOT load (old phone, no network): jsQR, still with the
// place of the QR. jsQR is the last resort: with two stickers in one frame it reads nothing (or both) —
// never a guess of one of them; the seller moves closer to one sticker.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { stickerImage, photo, type Rgba } from "./qrPhoto.harness";

const z = vi.hoisted(() => ({ loads: 0 }));
vi.mock("../qrWasm", () => ({ zxingOverrides: () => { z.loads++; throw new Error("WebAssembly could not load"); } }));
vi.mock("../../analytics", () => ({ track: vi.fn() }));
import { readQrHitsFromPixels } from "../qrDecode";
import { pickCentreQr } from "../../../lib/qrCentrePick";

const URL_A = "https://tiktok.com/@jhun.belle", URL_B = "https://tiktok.com/@maria_live";
const W = 960, H = 960, PX = 0.8;
const A_AT = { cx: 250, cy: 300 }, B_AT = { cx: 700, cy: 660 };
const inside = (hit: { cx: number; cy: number }, at: { cx: number; cy: number }) => Math.abs(hit.cx - at.cx) <= 192 && Math.abs(hit.cy - at.cy) <= 128;
let one: Rgba, two: Rgba, none: Rgba;
beforeAll(async () => {
  const A = await stickerImage({ w: 60, h: 40 }, "jhun.belle"), B = await stickerImage({ w: 60, h: 40 }, "maria_live");
  const N = await stickerImage({ w: 60, h: 40 }, "x", false);
  one = photo(W, H, [{ img: A, ...A_AT, pxPerDot: PX }], { blur: 0.5 });
  two = photo(W, H, [{ img: A, ...A_AT, pxPerDot: PX }, { img: B, ...B_AT, pxPerDot: PX }], { blur: 0.5 });
  none = photo(W, H, [{ img: N, cx: 480, cy: 480, pxPerDot: PX }], { blur: 0.5 });
}, 60000);

describe("readQrHitsFromPixels — jsQR when the stronger reader cannot load", () => {
  it("one sticker → its text and a centre inside the sticker", async () => {
    const hits = (await readQrHitsFromPixels(one))!;
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe(URL_A);
    expect(inside(hits[0], A_AT)).toBe(true);
  }, 30000);
  it("two stickers in one frame → jsQR reads NOTHING (it mixes their corner squares) or BOTH — never just one of them", async () => {
    const hits = (await readQrHitsFromPixels(two))!;
    expect(hits.length === 0 || hits.length === 2).toBe(true); // 0 on these pictures: the seller moves closer to one sticker
    for (const h of hits) expect([URL_A, URL_B]).toContain(h.text);
    if (hits.length === 2) {
      const a = hits.find((h) => h.text === URL_A)!, b = hits.find((h) => h.text === URL_B)!;
      expect(inside(a, A_AT)).toBe(true);
      expect(inside(b, B_AT)).toBe(true);
      expect(pickCentreQr(hits, { cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2, side: 900 })).toEqual({ kind: "tie" });
    }
  }, 30000);
  it("no QR → an empty list; the caller's pixels are not changed by the blanking", async () => {
    const copy = new Uint8ClampedArray(two.data);
    await readQrHitsFromPixels(two);
    expect(Buffer.from(two.data.buffer).equals(Buffer.from(copy.buffer))).toBe(true);
    expect(await readQrHitsFromPixels(none)).toEqual([]);
  }, 30000);
  it("the stronger reader is tried ONCE, not again on every camera frame", async () => {
    const before = z.loads;
    for (let i = 0; i < 5; i++) await readQrHitsFromPixels(none);
    expect(z.loads).toBe(before);
    expect(before).toBeGreaterThanOrEqual(1);
  }, 30000);
});
