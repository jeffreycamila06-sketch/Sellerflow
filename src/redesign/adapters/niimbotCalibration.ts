// TEMPORARY admin-only calibration label for the Android Niimbot path (Oct 26 position
// investigation: on Android the sticker prints shifted RIGHT vs iOS — bigger left margin,
// the QR runs past the label's right edge — from the SAME 384×224 image and frame).
// The image is exactly the SDK frame (NIIMBOT_FRAME_DOTS, 48×28 mm at 8 dots/mm):
//   • a 1-dot border rectangle on all four sides,
//   • a centre cross (full-width row + full-height column),
//   • tick marks every 8 dots (1 mm) on all four edges — 4 dots long, 10 dots every 40 dots (5 mm),
//     16 dots every 80 dots (10 mm) so the cut ticks can be counted from the nearest 10 mm mark,
//   • a solid 8×8 square inside the top-left corner so left/right and top/bottom are unambiguous.
// Printed through the normal printStickerImage bridge (the saved Niimbot), so whatever the
// printer does to the frame it does to this label too. PURE + unit-tested.
import { NIIMBOT_FRAME_DOTS, NIIMBOT_LABEL } from "./printing";
import { bytesToBase64 } from "./stickerRaster";
import type { NiimbotImage } from "./printerBridge";

export const CAL_TICK_EVERY = 8;   // dots (1 mm)
export const CAL_TICK_SHORT = 4;   // dots
export const CAL_TICK_LONG = 10;   // dots, every 5 mm
export const CAL_TICK_XL = 16;     // dots, every 10 mm
export const CAL_MARKER = 8;       // dots, the top-left square

export interface CalBits { w: number; h: number; rowBytes: number; buf: Uint8Array }
export function calibrationBits(w = NIIMBOT_FRAME_DOTS.w, h = NIIMBOT_FRAME_DOTS.h): CalBits {
  const rowBytes = (w + 7) >> 3;
  const buf = new Uint8Array(rowBytes * h);
  const set = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < w && y < h) buf[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7); };
  for (let x = 0; x < w; x++) { set(x, 0); set(x, h - 1); set(x, h >> 1); }      // top, bottom, centre row
  for (let y = 0; y < h; y++) { set(0, y); set(w - 1, y); set(w >> 1, y); }      // left, right, centre column
  const tickLen = (d: number) => (d % 80 === 0 ? CAL_TICK_XL : d % 40 === 0 ? CAL_TICK_LONG : CAL_TICK_SHORT);
  for (let x = CAL_TICK_EVERY; x < w; x += CAL_TICK_EVERY) {                       // top + bottom ticks
    const len = tickLen(x);
    for (let k = 1; k <= len; k++) { set(x, k); set(x, h - 1 - k); }
  }
  for (let y = CAL_TICK_EVERY; y < h; y += CAL_TICK_EVERY) {                       // left + right ticks
    const len = tickLen(y);
    for (let k = 1; k <= len; k++) { set(k, y); set(w - 1 - k, y); }
  }
  for (let y = 2; y < 2 + CAL_MARKER; y++) for (let x = 2; x < 2 + CAL_MARKER; x++) set(x, y); // top-left marker
  return { w, h, rowBytes, buf };
}
export const calibrationInk = (b: CalBits, x: number, y: number): boolean => (b.buf[y * b.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;

/** The label as the printStickerImage bridge takes it (always the 50×30 Niimbot label). */
export function niimbotCalibrationImage(): NiimbotImage {
  const b = calibrationBits();
  return { w: b.w, h: b.h, rowBytes: b.rowBytes, data: bytesToBase64(b.buf), labelWidthMm: NIIMBOT_LABEL.w, labelHeightMm: NIIMBOT_LABEL.h };
}
