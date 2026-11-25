// PREVIEW-ONLY. Makes the "camera" for the preview pictures: short .y4m videos (what Chromium's fake
// camera plays) of REAL SellerFlowLive stickers — drawn by the app's own sticker code, with the QR the
// printer prints — lying on a table, seen by a phone held upright (720×1280).
//   one.y4m   one sticker, its QR in the middle of the picture            → the scanner reads it
//   two.y4m   two stickers, both QRs equally near the middle              → "Point at one QR"
//   desk.y4m  one sticker lower in the picture (its QR outside the frame) → the scanner stays open
// Written to $OUT (not kept in the repository: a few MB each).
import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stickerImage, photo, type Rgba } from "../../../src/redesign/adapters/__tests__/qrPhoto.harness";
import { fullFonts } from "../../../src/redesign/adapters/__tests__/oneSticker.harness";
import { layoutSticker, recommendedSettings } from "../../../src/redesign/adapters/oneSticker";
import { stickerInput } from "../../../src/redesign/adapters/__tests__/qrPhoto.harness";

const W = 720, H = 1280, FPS = 10, FRAMES = 3;
const OUT = process.env.OUT || "";

function y4m(img: Rgba): Buffer {
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`, "ascii");
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2), 128), V = Buffer.alloc((W / 2) * (H / 2), 128);
  for (let i = 0; i < W * H; i++) Y[i] = img.data[i * 4];
  // a warm table: the dark parts (the table, not the paper) get a little colour
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    const l = img.data[(y * 2 * W + x * 2) * 4];
    if (l < 170) { U[y * (W / 2) + x] = 120; V[y * (W / 2) + x] = 138; }
  }
  const frame = Buffer.concat([Buffer.from("FRAME\n", "ascii"), Y, U, V]);
  return Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]);
}

it("writes the fake camera videos", async () => {
  expect(OUT, "set OUT=<folder>").not.toBe("");
  fs.mkdirSync(OUT, { recursive: true });
  const size = { w: 60, h: 40 };
  const A = await stickerImage(size, "jhun.belle"), B = await stickerImage(size, "maria_live");
  // where the QR's centre is inside the sticker (dots from the sticker's centre)
  const fonts = await fullFonts();
  const L = layoutSticker({ ...recommendedSettings(size) }, stickerInput("jhun.belle"), fonts);
  const q = L.qr!;
  expect(q, "the 60×40 sticker has a QR").toBeTruthy();
  const side = q.matrix.length * q.mod;
  const qx = q.x + side / 2 - A.w / 2, qy = q.y + side / 2 - A.h / 2;
  // put the sticker so that its QR's centre lands at (cx, cy) of the picture
  const at = (cx: number, cy: number, px: number) => ({ cx: cx - qx * px, cy: cy - qy * px, pxPerDot: px });
  const scenes: Record<string, Rgba> = {
    one: photo(W, H, [{ img: A, ...at(360, 640, 1.1), rotDeg: -2 }], { blur: 0.7, noise: 2 }),
    two: photo(W, H, [{ img: A, ...at(360, 640 - 135, 0.72), rotDeg: 1 }, { img: B, ...at(360, 640 + 135, 0.72), rotDeg: -1 }], { blur: 0.6, noise: 2 }),
    desk: photo(W, H, [{ img: A, ...at(380, 1010, 0.95), rotDeg: 4 }], { blur: 0.7, noise: 2 }),
  };
  for (const [name, img] of Object.entries(scenes)) fs.writeFileSync(path.join(OUT, `${name}.y4m`), y4m(img));
  fs.writeFileSync(path.join(OUT, "scenes.json"), JSON.stringify({ W, H, qr: { text_one: "https://tiktok.com/@jhun.belle", text_two: ["https://tiktok.com/@jhun.belle", "https://tiktok.com/@maria_live"] } }));
});
