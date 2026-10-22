// CPCL raster output for GENERIC label printers (printer setup v2, third language): the SAME
// 1-bit sticker image the app already builds (stickerRaster.renderStickerBitmap), as one
// CPCL label:
//   ! 0 200 200 <h> 1\r\n          start label: offset 0, 200 dpi h/v, height in dots, 1 copy
//   PAGE-WIDTH <w>\r\n             print width in dots
//   EG <rowBytes> <h> 0 0 <hex>\r\n EXPANDED-GRAPHICS: the image as ASCII hex, one row after
//                                  another, MSB-first, bit 1 = black — the CPCL graphics form
//                                  every CPCL printer accepts (CG is the compressed binary twin)
//   FORM\r\nPRINT\r\n              feed to the next label, print
// Our Bitmap buffer is already bit1 = ink, MSB-first, rowBytes per row → hex of it as-is.
// ⚠️ UNVERIFIED ON HARDWARE (no CPCL printer available yet) — reachable only on a printer the
// seller saved as "cpcl" through the v2 flow; the D520BT never sees this.
import type { FullRaster } from "./stickerRaster";

const HEX = "0123456789ABCDEF";

export function cpclRasterBytes(full: FullRaster): Uint8Array {
  const { rowBytes, h, w } = full;
  const body = rowBytes * h;
  const head = `! 0 200 200 ${h} 1\r\nPAGE-WIDTH ${w}\r\nEG ${rowBytes} ${h} 0 0 `;
  const tail = "\r\nFORM\r\nPRINT\r\n";
  const out = new Uint8Array(head.length + body * 2 + tail.length);
  let i = 0;
  for (let k = 0; k < head.length; k++) out[i++] = head.charCodeAt(k) & 0xff;
  for (let k = 0; k < body; k++) {
    const b = full.buf[k];
    out[i++] = HEX.charCodeAt(b >> 4);
    out[i++] = HEX.charCodeAt(b & 0x0f);
  }
  for (let k = 0; k < tail.length; k++) out[i++] = tail.charCodeAt(k) & 0xff;
  return out;
}
