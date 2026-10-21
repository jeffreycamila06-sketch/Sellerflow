// ESC/POS raster output for GENERIC Bluetooth label printers (printer setup v2): the SAME
// 1-bit sticker image the app already builds (stickerRaster.renderStickerBitmap), wrapped as
//   ESC @                       reset
//   GS v 0 m xL xH yL yH <rows> raster bit image, m = 0 (normal), xL/xH = bytes per row,
//                               yL/yH = dot rows; each row MSB-first, bit 1 = black
//   ESC d 3                     feed 3 lines
// Our Bitmap buffer is already bit1 = ink, MSB-first, rowBytes per row → copied as-is.
// ⚠️ UNVERIFIED ON HARDWARE (no ESC/POS label printer available yet) — reachable only on a
// printer the seller saved as "escpos" through the v2 flow; the D520BT never sees this.
import type { FullRaster } from "./stickerRaster";

export function escposRasterBytes(full: FullRaster): Uint8Array {
  const { rowBytes, h } = full;
  const body = rowBytes * h;
  const head = [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, (rowBytes >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff];
  const tail = [0x1b, 0x64, 0x03];
  const out = new Uint8Array(head.length + body + tail.length);
  out.set(head, 0);
  out.set(full.buf.subarray(0, body), head.length);
  out.set(tail, head.length + body);
  return out;
}
