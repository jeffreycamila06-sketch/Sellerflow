// PRINT CONTROLS HARNESS (Nov 3) — shared by printControls.matrix.test.ts (the permanent guard) and
// printControls.evidence.test.ts (the rendered evidence the printer-auditor agent asks for).
// Renders THE print bitmap (printing.stickerBitmapFor — the one function behind every bitmap print
// path and the preview) for a printer path × label size × layout v2 OFF/ON × the LIVE print pattern
// controls, with the real atlases. The control list is read from what PrintPattern / PrinterSettings
// actually show, so a new control cannot ship untested.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { buildNativeStickerPayload, buildSettingsFromRedesign, setStickerQrEntitled, setStickerQrOn, setStickerSpacingAllowed, setStickerCompactV2, setStickerLayoutV2Allowed, stickerBitmapFor, browserStickerPage, type StickerPath, type Settings } from "../printing";
import { DEFAULT_PP, type PrintPatternState, type PpBoolKey, type PpSizeKey } from "../../screens/PrintPattern";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import type { FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";

// "browser" (round 3, item 7) = a laptop: the same bitmap printed as one image on a label-sized page.
export const PATHS: readonly StickerPath[] = ["aimo", "generic", "niimbot", "browser"];
export const SIZES = ["50x30mm", "60x40mm", "70x50mm", "80x50mm", "80x60mm", "100x60mm (Standard)"] as const;
export const SIZES_SHORT = ["50x30mm", "60x40mm", "70x50mm"] as const;
export const AT = Date.UTC(2026, 10, 3, 12, 15); // 11/03 20:15 Taipei

// The controls the screens actually show. PrintPattern: every `{ key, sizeKey }` row of rowsFor(); a row
// marked `fixedSize` shows "Fixed size" instead of a stepper → it is a SWITCH only. PrinterSettings: the
// "Print QR on sticker" toggle (ps-sticker-qr-toggle).
export function screenControls(): { switches: (PpBoolKey | "stickerQr")[]; sizes: PpSizeKey[]; fixed: PpSizeKey[] } {
  const pp = readFileSync("src/redesign/screens/PrintPattern.tsx", "utf8");
  const rows = pp.slice(pp.indexOf("const rowsFor = "), pp.indexOf("];", pp.indexOf("const rowsFor = ")));
  const switches: (PpBoolKey | "stickerQr")[] = [], sizes: PpSizeKey[] = [], fixed: PpSizeKey[] = [];
  for (const m of rows.matchAll(/key: "(\w+)", sizeKey: "(\w+)"[^}]*?(fixedSize: [^,}]+)?\s*\}/g)) {
    switches.push(m[1] as PpBoolKey);
    (m[3] ? fixed : sizes).push(m[2] as PpSizeKey);
  }
  const ps = readFileSync("src/redesign/screens/PrinterSettings.tsx", "utf8");
  if (ps.includes('data-testid="ps-sticker-qr-toggle"')) switches.push("stickerQr");
  return { switches, sizes, fixed };
}

export interface CaseSpec { path: StickerPath; psSize: string; v2: boolean; pp?: Partial<PrintPatternState>; qr?: boolean; shop?: string; buyer?: Buyer }
export const sampleBuyer = (): Buyer => ({ handle: "amy.ukay2026", name: "Amy Santos", platform: "TikTok", num: 88, totalSpent: 350, totalOrders: 1,
  orders: [{ orderNum: AT, item: "Black dress M 350", qty: 1, price: 350, total: 350, time: "20:15", handle: "amy.ukay2026", name: "Amy Santos", bNum: 88, platform: "TikTok", status: "New", date: "2026-11-03" }] } as Buyer);
export function settingsFor(c: CaseSpec): Settings {
  return buildSettingsFromRedesign({ pp: { ...DEFAULT_PP, ...(c.pp || {}) }, psType: "bt", psOut: "sticker", psSize: c.psSize });
}
export function applyModuleState(c: CaseSpec): void {
  setStickerQrEntitled(true); setStickerQrOn(c.qr ?? true); setStickerSpacingAllowed(true); setStickerLayoutV2Allowed(true); setStickerCompactV2(c.v2);
}
// THE print bitmap for the case (what the printer gets and what the preview shows).
export async function renderCase(c: CaseSpec): Promise<FullRaster> {
  applyModuleState(c);
  const payload = buildNativeStickerPayload(c.buyer ?? sampleBuyer(), "NT$", c.shop ?? "BudgetUkay", settingsFor(c), AT);
  return stickerBitmapFor({ path: c.path, payload, platform: "TikTok", ...(c.path === "generic" ? { bold: true } : {}) });
}
// The laptop print page for the case (round 3, item 7): the "browser" bitmap as a BMP image on a label-sized page.
export async function browserCase(c: CaseSpec): Promise<{ html: string; raster: FullRaster }> {
  const raster = await renderCase({ ...c, path: "browser" });
  const st = settingsFor(c);
  const wh = String(st.stickerSize).match(/^(\d+)x(\d+)/)!;
  return { html: browserStickerPage({ wMm: Number(wh[1]), hMm: Number(wh[2]), img: raster, title: "test" }), raster };
}
// The image on a laptop print page, back to a raster (1-bit BMP: bottom-up rows padded to 4 bytes).
export const pageSrc = (html: string): string => /src="(data:image\/bmp;base64,[^"]+)"/.exec(html)?.[1] ?? "";
export function rasterFromBmpDataUrl(src: string): FullRaster {
  const b = Buffer.from(src.replace(/^data:image\/bmp;base64,/, ""), "base64");
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22), stride = ((w + 31) >> 5) << 2, rowBytes = (w + 7) >> 3;
  const buf = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) buf.set(b.subarray(off + (h - 1 - y) * stride, off + (h - 1 - y) * stride + rowBytes), y * rowBytes);
  return { buf, w, h, rowBytes };
}
// Recompose the generic TSPL mode-0 bands back into a raster (what the printer paints).
export function recomposeBands(bytes: Uint8Array, wDots: number, hDots: number): FullRaster {
  const rowBytes = wDots >> 3, buf = new Uint8Array(rowBytes * hDots).fill(0);
  let i = 0;
  const text = (n: number) => { let s = ""; for (let k = 0; k < n; k++) s += String.fromCharCode(bytes[i + k]); return s; };
  while (i < bytes.length) {
    if (text(7) === "BITMAP ") {
      let j = i + 7; let hdr = ""; while (bytes[j] !== 0x2c || hdr.split(",").length < 4) { hdr += String.fromCharCode(bytes[j]); j++; }
      const [x, y, wb, h] = hdr.split(",").map(Number); j++; // skip the comma before mode
      while (bytes[j] !== 0x2c) j++; j++;
      for (let r = 0; r < h; r++) for (let b = 0; b < wb; b++) buf[(y + r) * rowBytes + (x >> 3) + b] = ~bytes[j + r * wb + b] & 0xff; // INK_IS_ZERO
      i = j + wb * h;
    } else i++;
  }
  return { buf, w: wDots, h: hDots, rowBytes };
}
export const rasterKey = (r: FullRaster): string => createHash("sha256").update(r.buf).digest("hex").slice(0, 16);

// ── PNG evidence (8-bit grayscale, no dependency) ──────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function pngBytes(gray: Uint8Array, w: number, h: number): Buffer {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1); }
  const chunk = (type: string, data: Uint8Array) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}
export class Sheet {
  g: Uint8Array;
  w: number;
  h: number;
  constructor(w: number, h: number, bg = 232) { this.w = w; this.h = h; this.g = new Uint8Array(w * h).fill(bg); }
  px(x: number, y: number, v: number) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y * this.w + x] = v; }
  rect(x: number, y: number, w: number, h: number, v: number) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, v); }
  frame(x: number, y: number, w: number, h: number, v = 90) { this.rect(x - 1, y - 1, w + 2, 1, v); this.rect(x - 1, y + h, w + 2, 1, v); this.rect(x - 1, y - 1, 1, h + 2, v); this.rect(x + w, y - 1, 1, h + 2, v); }
  raster(r: FullRaster, x0: number, y0: number) { for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) this.px(x0 + x, y0 + y, (r.buf[y * r.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) ? 0 : 255); }
  text(s: string, x: number, y: number, scale = 1, font: "2" | "3" | "4" = "3", v = 0): number {
    const f = LATIN_ATLAS[font]; const crb = (f.w + 7) >> 3;
    for (const ch of s) { const g = f.glyphs[ch.codePointAt(0) ?? 0]; if (g) { const cell = Buffer.from(g, "base64"); for (let sy = 0; sy < f.h; sy++) for (let sx = 0; sx < f.w; sx++) if (cell[sy * crb + (sx >> 3)] & (0x80 >> (sx & 7))) this.rect(x + sx * scale, y + sy * scale, scale, scale, v); } x += f.w * scale; }
    return x;
  }
  save(path: string) { writeFileSync(path, pngBytes(this.g, this.w, this.h)); }
}
export function savePng(r: FullRaster, path: string): void { const s = new Sheet(r.w, r.h, 255); s.raster(r, 0, 0); s.save(path); }
