// Decoders for what each printer RECEIVES → back to a 1-bit raster (bit 1 = ink), so a test can
// compare the paper picture of every path with the exact preview, pixel by pixel.
import { lzo1xDecompress } from "lzo1x";
import { rotateRaster180, type FullRaster } from "../stickerRaster";

const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));
const findAscii = (bytes: Uint8Array, needle: string, from = 0): number => {
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
};
const readNumbers = (bytes: Uint8Array, at: number, count: number): { nums: number[]; end: number } => {
  const nums: number[] = []; let i = at, cur = "";
  while (nums.length < count) { const c = String.fromCharCode(bytes[i++]); if (c === ",") { nums.push(Number(cur)); cur = ""; } else cur += c; }
  return { nums, end: i };
};

/** AIMO D520BT SDK stream → the label raster (un-rotated, ink bits). */
export function decodeSdkStream(b: Uint8Array): FullRaster {
  const at = findAscii(b, "BITMAP 4,0,");
  const { nums: [rowBytes, h], end } = readNumbers(b, at + 11, 3);
  const packed = new Uint8Array(rowBytes * h);
  let i = end, off = 0;
  for (;;) {
    const len = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24); i += 4;
    if (len === 0) break;
    const out = lzo1xDecompress(b.subarray(i, i + len)); i += len;
    packed.set(out, off); off += out.length;
  }
  const buf = packed.map((x) => ~x & 0xff); // printer bit 1 = white
  return rotateRaster180({ buf, w: rowBytes * 8, h, rowBytes });
}
/** Generic TSPL (SIZE/GAP/BITMAP mode-0 bands) → the label raster. */
export function decodeTsplBands(b: Uint8Array, wDots: number, hDots: number): FullRaster {
  const rowBytes = (wDots + 7) >> 3, buf = new Uint8Array(rowBytes * hDots);
  let p = 0;
  for (;;) {
    const at = findAscii(b, "BITMAP ", p);
    if (at < 0) break;
    const { nums: [x, y, rb, h], end } = readNumbers(b, at + 7, 5);
    const data = b.subarray(end, end + rb * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < rb * 8; c++) {
      if (data[r * rb + (c >> 3)] & (0x80 >> (c & 7))) continue; // bit 1 = white
      const X = x + c, Y = y + r;
      if (X < wDots && Y < hDots) buf[Y * rowBytes + (X >> 3)] |= 0x80 >> (X & 7);
    }
    p = end + rb * h;
  }
  return { buf, w: wDots, h: hDots, rowBytes };
}
export function decodeEscpos(b: Uint8Array): FullRaster {
  const rowBytes = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
  return { buf: b.slice(10, 10 + rowBytes * h), w: rowBytes * 8, h, rowBytes };
}
export function decodeCpcl(b: Uint8Array): FullRaster {
  const s = Buffer.from(b).toString("latin1");
  const m = /EG (\d+) (\d+) 0 0 ([0-9A-F]+)/.exec(s)!;
  const rowBytes = Number(m[1]), h = Number(m[2]);
  return { buf: Uint8Array.from(Buffer.from(m[3], "hex")), w: rowBytes * 8, h, rowBytes };
}
export function decodeNiimbot(img: { w: number; h: number; rowBytes: number; data: string }): FullRaster {
  return { buf: b64(img.data), w: img.w, h: img.h, rowBytes: img.rowBytes };
}
/** The laptop page: the <img> BMP data URL + its printed size in mm. */
export function decodeLaptopPage(html: string): { raster: FullRaster; pageMm: [number, number]; imgMm: [number, number] } {
  const page = /@page\{size:(\d+)mm (\d+)mm;margin:0\}/.exec(html)!;
  const img = /img\{display:block;width:(\d+)mm;height:(\d+)mm/.exec(html)!;
  const src = /src="data:image\/bmp;base64,([^"]+)"/.exec(html)!;
  const bmp = b64(src[1]);
  const u32 = (i: number) => bmp[i] | (bmp[i + 1] << 8) | (bmp[i + 2] << 16) | (bmp[i + 3] << 24);
  const off = u32(10), w = u32(18), h = u32(22);
  const stride = ((w + 31) >> 5) << 2, rowBytes = (w + 7) >> 3;
  const buf = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) buf.set(bmp.subarray(off + (h - 1 - y) * stride, off + (h - 1 - y) * stride + rowBytes), y * rowBytes);
  return { raster: { buf, w, h, rowBytes }, pageMm: [Number(page[1]), Number(page[2])], imgMm: [Number(img[1]), Number(img[2])] };
}
export function sameRaster(a: FullRaster, b: FullRaster): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const pa = (a.buf[y * a.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0, pb = (b.buf[y * b.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
    if (pa !== pb) return false;
  }
  return true;
}
