// Test photos for the QR reader: REAL stickers (drawn by the app's own sticker code, the QR the printer
// prints) placed on a label roll inside a phone-sized photo — 4032×3024 (12 MP) or 8064×6048 (48 MP) —
// with tilt (perspective), a curve (the label bent over a finger / the roll), blur and noise.
// Pure JS on plain pixel arrays (no canvas needed), deterministic (seeded noise).
import { renderOneSticker, recommendedSettings, layoutSticker } from "../oneSticker";
import type { OneStickerInput } from "../oneSticker";
import { fullFonts } from "./oneSticker.harness";

export interface Gray { w: number; h: number; lum: Uint8Array }
export interface Rgba { width: number; height: number; data: Uint8ClampedArray }

const PAPER = 232, INK = 38; // thermal paper / thermal black, as a phone camera sees them

export function stickerInput(handle: string, buyerNum = 128): OneStickerInput {
  return {
    storeName: "Maria Shop", date: "2026/11/20", time: "14:05", buyerNum, name: "Maria Santos", handle,
    platform: "TikTok", items: ["Red dress 350"],
  } as OneStickerInput;
}

/** The printed sticker (8 dots per mm) as gray pixels, + the QR's module size in dots (0 = no QR). */
export async function stickerImage(size: { w: number; h: number }, handle: string, qr = true): Promise<Gray & { qrModDots: number }> {
  const fonts = await fullFonts();
  const s = { ...recommendedSettings(size), qr: qr && recommendedSettings(size).qr };
  const r = renderOneSticker(s, stickerInput(handle), fonts);
  const lum = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) lum[y * r.w + x] = r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? INK : PAPER;
  const L = layoutSticker(s, stickerInput(handle), fonts);
  return { w: r.w, h: r.h, lum, qrModDots: L.qr ? L.qr.mod : 0 };
}

/** Bend the sticker like a label lying over a finger or the roll: a cylinder across its width.
 *  amount 0 = flat; 0.6 = strong curve (the edges turn away, squeezed and darker). */
export function bend(img: Gray, amount: number): Gray {
  if (amount <= 0) return img;
  const W = img.w, H = img.h, half = W / 2;
  const R = half / Math.sin(Math.min(1.45, amount * 1.6)); // radius; the edge angle grows with amount
  const halfOut = R * Math.sin(half / R);
  const outW = Math.max(2, Math.round(halfOut * 2));
  const lum = new Uint8Array(outW * H).fill(0);
  for (let x = 0; x < outW; x++) {
    const xo = x + 0.5 - outW / 2;
    const t = Math.max(-1, Math.min(1, xo / R));
    const arc = R * Math.asin(t);           // distance along the paper from the centre
    const sx = arc + half - 0.5;
    const shade = 0.72 + 0.28 * Math.sqrt(Math.max(0, 1 - t * t)); // the edges turn away from the light
    const x0 = Math.floor(sx), fx = sx - x0;
    for (let y = 0; y < H; y++) {
      const a = img.lum[y * W + Math.max(0, Math.min(W - 1, x0))], b = img.lum[y * W + Math.max(0, Math.min(W - 1, x0 + 1))];
      lum[y * outW + x] = Math.round((a + (b - a) * fx) * shade);
    }
  }
  return { w: outW, h: H, lum };
}

/** Stack labels the way they sit on the roll: one above the other with a 3 mm gap (24 dots). */
export function roll(imgs: Gray[], gapDots = 24, sideBySide = false): Gray {
  const W = sideBySide ? imgs.reduce((s, i) => s + i.w, 0) + gapDots * (imgs.length - 1) : Math.max(...imgs.map((i) => i.w));
  const H = sideBySide ? Math.max(...imgs.map((i) => i.h)) : imgs.reduce((s, i) => s + i.h, 0) + gapDots * (imgs.length - 1);
  const lum = new Uint8Array(W * H).fill(205); // the liner between the labels (a bit darker than the labels)
  let off = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      const X = sideBySide ? off + x : x, Y = sideBySide ? y : off + y;
      lum[Y * W + X] = im.lum[y * im.w + x];
    }
    off += (sideBySide ? im.w : im.h) + gapDots;
  }
  return { w: W, h: H, lum };
}

// 3×3 matrix helpers (row-major) for the camera picture of a tilted flat label.
type M3 = number[];
const mul = (a: M3, b: M3): M3 => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
function inv(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export interface Place {
  img: Gray;
  cx: number; cy: number;          // where its centre lands in the photo (px)
  pxPerDot: number;                // camera scale (photo px per printed dot = per 1/8 mm)
  rotDeg?: number;                 // turned in the photo
  tiltXDeg?: number; tiltYDeg?: number; // the label plane tilted away from the camera
}

let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/** The phone photo: a table (soft light gradient), the labels placed with perspective, blur, noise. */
export function photo(W: number, H: number, places: Place[], opts: { blur?: number; noise?: number; seed?: number } = {}): Rgba {
  seed = opts.seed ?? 7;
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lum[y * W + x] = 96 + 40 * (x / W) + 18 * (y / H); // table
  const f = Math.max(W, H) * 0.9; // focal length (px) ≈ a phone's main camera
  for (const p of places) {
    const { img } = p;
    const rz = ((p.rotDeg ?? 0) * Math.PI) / 180, rx = ((p.tiltXDeg ?? 0) * Math.PI) / 180, ry = ((p.tiltYDeg ?? 0) * Math.PI) / 180;
    const Rz: M3 = [Math.cos(rz), -Math.sin(rz), 0, Math.sin(rz), Math.cos(rz), 0, 0, 0, 1];
    const Rx: M3 = [1, 0, 0, 0, Math.cos(rx), -Math.sin(rx), 0, Math.sin(rx), Math.cos(rx)];
    const Ry: M3 = [Math.cos(ry), 0, Math.sin(ry), 0, 1, 0, -Math.sin(ry), 0, Math.cos(ry)];
    const R = mul(Rz, mul(Rx, Ry));
    // plane point (X, Y) in dots, centred → camera (s·R·[X,Y,0] + [0,0,f]) → pixel. s = pxPerDot keeps the
    // flat size equal to pxPerDot at the centre.
    const s = p.pxPerDot;
    const Hm: M3 = mul([f, 0, p.cx, 0, f, p.cy, 0, 0, 1], [s * R[0], s * R[1], 0, s * R[3], s * R[4], 0, s * R[6], s * R[7], f]);
    const Hi = inv(Hm);
    const corners = [[-img.w / 2, -img.h / 2], [img.w / 2, -img.h / 2], [img.w / 2, img.h / 2], [-img.w / 2, img.h / 2]].map(([X, Y]) => {
      const u = Hm[0] * X + Hm[1] * Y + Hm[2], v = Hm[3] * X + Hm[4] * Y + Hm[5], w = Hm[6] * X + Hm[7] * Y + Hm[8];
      return [u / w, v / w];
    });
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])))), x1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
    const ss = p.pxPerDot < 1.5 ? 3 : 1; // supersample when the label is small in the photo
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let acc = 0, n = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const u = x + (i + 0.5) / ss, v = y + (j + 0.5) / ss;
        const w = Hi[6] * u + Hi[7] * v + Hi[8];
        const X = (Hi[0] * u + Hi[1] * v + Hi[2]) / w + img.w / 2 - 0.5, Y = (Hi[3] * u + Hi[4] * v + Hi[5]) / w + img.h / 2 - 0.5;
        if (X < 0 || Y < 0 || X > img.w - 1 || Y > img.h - 1) continue;
        const xi = Math.floor(X), yi = Math.floor(Y), fx = X - xi, fy = Y - yi;
        const q = (a: number, b: number) => img.lum[Math.min(img.h - 1, b) * img.w + Math.min(img.w - 1, a)];
        const top = q(xi, yi) + (q(xi + 1, yi) - q(xi, yi)) * fx, bot = q(xi, yi + 1) + (q(xi + 1, yi + 1) - q(xi, yi + 1)) * fx;
        const val = top + (bot - top) * fy;
        if (val === 0) continue; // outside a bent label (its transparent sides)
        acc += val; n++;
      }
      if (n) lum[y * W + x] = (lum[y * W + x] * (ss * ss - n) + acc) / (ss * ss);
    }
  }
  if (opts.blur && opts.blur > 0) boxBlur(lum, W, H, Math.round(opts.blur));
  const noise = opts.noise ?? 6;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const v = lum[k] + (rnd() - 0.5) * 2 * noise;
    data[k * 4] = v + 4; data[k * 4 + 1] = v; data[k * 4 + 2] = v - 6; data[k * 4 + 3] = 255; // a warm indoor light
  }
  return { width: W, height: H, data };
}

// Two passes of a running-sum box blur in each direction ≈ a soft camera blur of about `r` px.
function boxBlur(a: Float32Array, W: number, H: number, r: number): void {
  const tmp = new Float32Array(Math.max(W, H));
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      let sum = 0; const row = y * W;
      for (let x = -r; x <= r; x++) sum += a[row + Math.max(0, Math.min(W - 1, x))];
      for (let x = 0; x < W; x++) { tmp[x] = sum / (2 * r + 1); sum += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
      for (let x = 0; x < W; x++) a[row + x] = tmp[x];
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += a[Math.max(0, Math.min(H - 1, y)) * W + x];
      for (let y = 0; y < H; y++) { tmp[y] = sum / (2 * r + 1); sum += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x]; }
      for (let y = 0; y < H; y++) a[y * W + x] = tmp[y];
    }
  }
}

// ── A fake browser: createImageBitmap + a 2D canvas that draws (area average, like a browser's
// high-quality downscale) and hands back pixels. Lets the REAL decodeQrFromFile run in the test. ──
const photos = new WeakMap<object, Rgba>();
export function photoFile(img: Rgba, name = "IMG_0001.jpg", type = "image/jpeg"): File {
  const f = new File([new Uint8Array(16)], name, { type });
  photos.set(f, img);
  return f;
}

interface FakeBitmap { width: number; height: number; __rgba: Rgba; close(): void }
function drawArea(dst: Uint8ClampedArray, dw: number, dh: number, src: Rgba, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dW: number, dH: number): void {
  const fx = sw / dW, fy = sh / dH;
  for (let y = 0; y < dH; y++) {
    const Y = y + dy; if (Y < 0 || Y >= dh) continue;
    const ya = sy + y * fy, yb = ya + fy;
    for (let x = 0; x < dW; x++) {
      const X = x + dx; if (X < 0 || X >= dw) continue;
      const xa = sx + x * fx, xb = xa + fx;
      let r = 0, g = 0, b = 0, n = 0;
      for (let v = Math.floor(ya); v < Math.max(Math.floor(ya) + 1, Math.ceil(yb)); v++) for (let u = Math.floor(xa); u < Math.max(Math.floor(xa) + 1, Math.ceil(xb)); u++) {
        const uu = Math.max(0, Math.min(src.width - 1, u)), vv = Math.max(0, Math.min(src.height - 1, v));
        const k = (vv * src.width + uu) * 4;
        r += src.data[k]; g += src.data[k + 1]; b += src.data[k + 2]; n++;
      }
      const o = (Y * dw + X) * 4;
      dst[o] = r / n; dst[o + 1] = g / n; dst[o + 2] = b / n; dst[o + 3] = 255;
    }
  }
}

export interface FakeBrowserStats { bitmaps: number; maxCanvasPx: number; drawCalls: number }
/** Installs createImageBitmap + canvas.getContext("2d") on jsdom. Returns an uninstall + counters. */
export function installFakeBrowser(opts: { bitmapFails?: boolean } = {}): { stats: FakeBrowserStats; restore: () => void } {
  const stats: FakeBrowserStats = { bitmaps: 0, maxCanvasPx: 0, drawCalls: 0 };
  const g = globalThis as unknown as { createImageBitmap?: unknown };
  const oldCib = g.createImageBitmap;
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const oldGet = proto.getContext;
  g.createImageBitmap = async (file: Blob): Promise<FakeBitmap> => {
    if (opts.bitmapFails) throw new Error("decode failed");
    const img = photos.get(file);
    if (!img) throw new Error("not a test photo");
    stats.bitmaps++;
    return { width: img.width, height: img.height, __rgba: img, close() { /* nothing */ } };
  };
  proto.getContext = function (this: HTMLCanvasElement, kind: string) {
    return kind === "2d" ? fakeContext(this) : null;
  };
  function fakeContext(cv: HTMLCanvasElement) {
    const state = cv as unknown as { __px?: Uint8ClampedArray; __w?: number; __h?: number };
    const px = () => {
      if (!state.__px || state.__w !== cv.width || state.__h !== cv.height) {
        state.__px = new Uint8ClampedArray(cv.width * cv.height * 4).fill(0);
        state.__w = cv.width; state.__h = cv.height;
        stats.maxCanvasPx = Math.max(stats.maxCanvasPx, cv.width * cv.height);
      }
      return state.__px;
    };
    return {
      imageSmoothingEnabled: true, imageSmoothingQuality: "high",
      drawImage(src: FakeBitmap | HTMLCanvasElement, ...a: number[]) {
        stats.drawCalls++;
        const s: Rgba = (src as FakeBitmap).__rgba ?? { width: (src as HTMLCanvasElement).width, height: (src as HTMLCanvasElement).height, data: px() };
        const [sx, sy, sw, sh, dx, dy, dw, dh] = a.length === 8 ? a : a.length === 4 ? [0, 0, s.width, s.height, a[0], a[1], a[2], a[3]] : [0, 0, s.width, s.height, a[0], a[1], s.width, s.height];
        drawArea(px(), cv.width, cv.height, s, sx, sy, sw, sh, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
      },
      getImageData(x: number, y: number, w: number, h: number) {
        const all = px();
        if (x === 0 && y === 0 && w === cv.width && h === cv.height) return { width: w, height: h, data: new Uint8ClampedArray(all) };
        const out = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) out.set(all.subarray(((y + j) * cv.width + x) * 4, ((y + j) * cv.width + x + w) * 4), j * w * 4);
        return { width: w, height: h, data: out };
      },
    };
  }
  return { stats, restore: () => { g.createImageBitmap = oldCib; proto.getContext = oldGet; } };
}

/** Area-average downscale (the same drawing the fake canvas does), long edge ≤ maxEdge. */
export function downscale(img: Rgba, maxEdge: number, crop?: { x: number; y: number; w: number; h: number }): Rgba {
  const c = crop ?? { x: 0, y: 0, w: img.width, h: img.height };
  const k = Math.min(1, maxEdge / Math.max(c.w, c.h));
  const w = Math.max(1, Math.round(c.w * k)), h = Math.max(1, Math.round(c.h * k));
  const data = new Uint8ClampedArray(w * h * 4);
  drawArea(data, w, h, img, c.x, c.y, c.w, c.h, 0, 0, w, h);
  return { width: w, height: h, data };
}
