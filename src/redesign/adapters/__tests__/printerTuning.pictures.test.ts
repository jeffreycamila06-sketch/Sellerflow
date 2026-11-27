// TODAY | TUNED sticker pictures, decoded from the bytes the printer receives (Admin-approved TSPL printers):
// shift right 2 mm, shift left 2 mm, flip — CT221B (its approved row already flips + shifts 2 mm left) and AE241,
// 60×40 and 100×60. The media / density / speed lines change no picture (header only — tuned-header-diff.txt).
// TUNING_PICTURES=<folder> writes one PNG per case (today left, tuned right). Always checked: same size, moved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { BUYERS, SAVED, handed, todayPrint, beforeGolden, afterGolden, type Fam } from "./printerTuning.harness";
import { setMyPrinterTuning, __resetPrinterTuning, type PrinterTuning } from "../printerTuning";
import { decodeTsplBands } from "./oneSticker.decode";
import type { FullRaster } from "../stickerRaster";

const OUT = process.env.TUNING_PICTURES || "";
const px = (r: FullRaster, x: number, y: number) => (r.buf[y * r.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pair(a: FullRaster, b: FullRaster): Buffer {
  const pad = 12, gap = 24, W = pad + a.w + 2 + gap + b.w + 2 + pad, H = pad + Math.max(a.h, b.h) + 2 + pad;
  const g = new Uint8Array(W * H).fill(0xd8);
  const put = (r: FullRaster, ox: number) => { for (let y = -1; y <= r.h; y++) for (let x = -1; x <= r.w; x++) g[(pad + 1 + y) * W + ox + 1 + x] = y < 0 || x < 0 || y === r.h || x === r.w ? 0x70 : px(r, x, y) ? 0 : 0xff; };
  put(a, pad); put(b, pad + a.w + 2 + gap);
  const chunk = (type: string, data: Uint8Array) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((W + 1) * H); for (let y = 0; y < H; y++) Buffer.from(g.buffer, y * W, W).copy(raw, y * (W + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}
const inkLeft = (r: FullRaster) => { for (let x = 0; x < r.w; x++) for (let y = 0; y < r.h; y++) if (px(r, x, y)) return x; return -1; };
const picture = async (f: Fam, w: number, h: number, t: PrinterTuning | null) => {
  setMyPrinterTuning(t ? { enabled: true, tester: true, tuning: t, version: 1, printerName: SAVED[f].name } : null);
  const r = await handed(f, todayPrint(f, w, h, BUYERS.latin()));
  return decodeTsplBands(Uint8Array.from(Buffer.from((JSON.parse(r.arg) as { data: string }).data, "base64")), w * 8, h * 8);
};
beforeAll(beforeGolden);
afterAll(() => { afterGolden(); __resetPrinterTuning(); });

const CASES: [string, PrinterTuning][] = [["shift-right-2mm", { shiftMm: -2 }], ["shift-left-2mm", { shiftMm: 2 }], ["flip", { flip: true }]];
describe("today | tuned pictures", () => {
  for (const f of ["ct221b", "ae241"] as Fam[]) for (const [w, h] of [[60, 40], [100, 60]] as [number, number][]) for (const [label, t] of CASES) {
    it(`${f} · ${w}×${h} · ${label}`, async () => {
      const a = await picture(f, w, h, null), b = await picture(f, w, h, t);
      expect([b.w, b.h]).toEqual([a.w, a.h]);
      const same = Buffer.from(b.buf).equals(Buffer.from(a.buf));
      // CT221B's approved row already flips + moves 2 mm left: the tuning REPLACES those values, so "flip" and
      // "left 2 mm" print exactly today's picture there; "right 2 mm" moves it 4 mm (32 dots) from today's.
      if (f === "ct221b") expect(same).toBe(label !== "shift-right-2mm");
      else expect(same).toBe(false);
      // (at 100×60 today's CT221B sticker already touches the left edge after its 2 mm move — only "moved right" is exact)
      if (f === "ct221b" && label === "shift-right-2mm") { if (w === 60) expect(inkLeft(b) - inkLeft(a)).toBe(32); else expect(inkLeft(b)).toBeGreaterThan(inkLeft(a)); }
      if (f === "ae241" && label === "shift-right-2mm") expect(inkLeft(b) - inkLeft(a)).toBe(16);      // 2 mm = 16 dots
      if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${f}_${w}x${h}_${label}.png`, pair(a, b)); }
    }, 60000);
  }
});
