// Approved printers' layout fix (sql/161) on the FINISHED sticker bitmap, for a saved printer whose name
// matches an ACTIVE approved row:
//   • flip  → rotate 180° (same width / height) — a printer that prints the sticker upside down;
//   • shift → move LEFT by `shiftDots`, applied LAST (on the bitmap that is sent): the first columns are
//     dropped and the same number of WHITE columns is added on the right — a printer that cuts its right edge.
// Bitmap = MSB-first rows, bit 1 = ink. PURE. No flip and no shift → the SAME object back (no copy →
// byte-identical output for every other printer).
// A seller's printer tuning (sql/230) may also move it RIGHT: a negative shiftDots (approved rows are never negative).
import { rotateRaster180, type FullRaster } from "./stickerRaster";

export interface ApprovedLayout { flip: boolean; shiftDots: number }
export const NO_LAYOUT: ApprovedLayout = { flip: false, shiftDots: 0 };
export const layoutChanges = (l: ApprovedLayout | null | undefined): boolean => !!l && (l.flip === true || (Number.isFinite(l.shiftDots) && l.shiftDots !== 0));

export function shiftRasterLeft(r: FullRaster, dots: number): FullRaster {
  const d = Math.floor(dots);
  if (!(d > 0)) return r;
  const buf = new Uint8Array(r.buf.length);
  const keep = r.w - d;
  for (let y = 0; y < r.h; y++) {
    const row = y * r.rowBytes;
    for (let x = 0; x < keep; x++) {
      const sx = x + d;
      if (r.buf[row + (sx >> 3)] & (0x80 >> (sx & 7))) buf[row + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { buf, w: r.w, h: r.h, rowBytes: r.rowBytes };
}

// Move RIGHT by `dots`: the last columns are dropped, white columns come in on the left.
export function shiftRasterRight(r: FullRaster, dots: number): FullRaster {
  const d = Math.floor(dots);
  if (!(d > 0)) return r;
  const buf = new Uint8Array(r.buf.length);
  for (let y = 0; y < r.h; y++) {
    const row = y * r.rowBytes;
    for (let x = d; x < r.w; x++) {
      const sx = x - d;
      if (r.buf[row + (sx >> 3)] & (0x80 >> (sx & 7))) buf[row + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { buf, w: r.w, h: r.h, rowBytes: r.rowBytes };
}

// 180° turn, pixel by pixel (same size). A byte-exact width (w = rowBytes × 8, every sticker size) uses
// the D520's rotateRaster180; any other width is turned per dot so padding bits never move into the picture.
export function flipRaster180(r: FullRaster): FullRaster {
  if (r.w === r.rowBytes * 8 && r.buf.length === r.rowBytes * r.h) return rotateRaster180(r);
  const buf = new Uint8Array(r.buf.length);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) {
      const tx = r.w - 1 - x, ty = r.h - 1 - y;
      buf[ty * r.rowBytes + (tx >> 3)] |= 0x80 >> (tx & 7);
    }
  }
  return { buf, w: r.w, h: r.h, rowBytes: r.rowBytes };
}

export function applyApprovedLayout(r: FullRaster, l: ApprovedLayout | null | undefined): FullRaster {
  if (!layoutChanges(l)) return r;
  const turned = l!.flip ? flipRaster180(r) : r;
  return l!.shiftDots < 0 ? shiftRasterRight(turned, -l!.shiftDots) : shiftRasterLeft(turned, l!.shiftDots);
}
