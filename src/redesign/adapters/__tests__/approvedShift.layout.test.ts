// Approved printers' "Flip 180°" + "Shift left (mm)" (sql/161) on a saved CT221B-D4F8: the bitmap that is
// SENT is today's bitmap rotated 180° (flip) and/or moved left round(mm × 8) dots (shift, applied last) —
// same width / height. Decoded from the real bytes (TSPL BITMAP bands / ESC/POS GS v 0), on today's sticker
// AND the one-sticker engine. Plus the pure helpers and the approved-row parsing.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEF_SETTINGS, printOneStickerTest, printStickerBtRouted, __resetNativePrintQueue, __resetWebPrintQueue, setStickerQrEntitled, setStickerQrOn, type Settings } from "../printing";
import { sampleBuyer, __resetOneStickerState, LS_ONE_STICKER } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { buildTestBuyer } from "../printerBridge";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";
import { setApprovedPrinters, approvedLayoutFor, type ApprovedPrinter } from "../printerModels";
import { applyApprovedLayout, flipRaster180, shiftRasterLeft } from "../rasterShift";
import { parseApprovedRows, parseShiftMm } from "../printerTesters";
import { INK_IS_ZERO, type FullRaster } from "../stickerRaster";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";

const AT = Date.UTC(2026, 10, 8, 6, 5);
const NAME = "CT221B-D4F8";
type W = { SellerFlowPrinter?: unknown };
beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterEach(() => { delete (window as unknown as W).SellerFlowPrinter; __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter(); __resetOneStickerState(); setApprovedPrinters(null); vi.useRealTimers(); });

// ── decoders: the bytes the printer receives → a 1-bit canvas (bit 1 = ink) ──
const latin = (b: Uint8Array) => Buffer.from(b).toString("latin1");
function decodeTspl(b: Uint8Array): FullRaster {
  const s = latin(b);
  const size = /SIZE (\d+) mm, (\d+) mm/.exec(s)!;
  const w = Number(size[1]) * 8, h = Number(size[2]) * 8, rowBytes = w >> 3;
  const buf = new Uint8Array(rowBytes * h);
  const re = /BITMAP (\d+),(\d+),(\d+),(\d+),0,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const [x0, y0, rb, bh] = [1, 2, 3, 4].map((i) => Number(m![i]));
    const start = m.index + m[0].length;
    for (let ry = 0; ry < bh; ry++) for (let rx = 0; rx < rb * 8; rx++) {
      const byte = b[start + ry * rb + (rx >> 3)], bit = (byte & (0x80 >> (rx & 7))) !== 0;
      const ink = INK_IS_ZERO ? !bit : bit;
      const x = x0 + rx, y = y0 + ry;
      if (ink && x < w) buf[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
    re.lastIndex = start + rb * bh;
  }
  return { buf, w, h, rowBytes };
}
function decodeEscpos(b: Uint8Array): FullRaster {
  const rowBytes = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
  return { buf: b.slice(10, 10 + rowBytes * h), w: rowBytes * 8, h, rowBytes };
}
const inkCount = (r: FullRaster) => { let n = 0; for (const v of r.buf) for (let i = 0; i < 8; i++) if (v & (1 << i)) n++; return n; };

async function sent(lang: "tspl" | "escpos", approved: ApprovedPrinter[], engine: "today" | "one"): Promise<FullRaster> {
  __resetNativePrintQueue(); __resetWebPrintQueue(); __resetSavedPrinter(); __resetOneStickerState();
  try { localStorage.removeItem(LS_ONE_STICKER); } catch { /* */ }
  setStickerQrEntitled(true); setStickerQrOn(true);
  setApprovedPrinters(approved);
  const ok = () => vi.fn(async (_a: Record<string, unknown>) => ({ ok: true }));
  const br = { printStickerNative: ok(), printStickerBitmap: ok(), printRawTspl: ok(), printStickerImage: ok() };
  rememberSavedPrinter({ address: "AA", name: NAME, model: "generic", lang });
  (window as unknown as W).SellerFlowPrinter = br;
  const cfg: Settings = { ...DEF_SETTINGS, stickerSize: "60x40", printerType: "bluetooth" };
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AT);
  if (engine === "today") await printStickerBtRouted(buildTestBuyer(), "NT$", "Shop", cfg, false, AT, true);
  else await printOneStickerTest({ ...recommendedSettings({ w: 60, h: 40 }), qr: true }, sampleBuyer(undefined, AT), "NT$", "Shop", cfg);
  vi.useRealTimers();
  await vi.waitFor(() => expect(br.printRawTspl.mock.calls.length).toBe(1), { timeout: 20000, interval: 10 });
  const bytes = Uint8Array.from(Buffer.from((br.printRawTspl.mock.calls[0][0] as { data: string }).data, "base64"));
  return lang === "tspl" ? decodeTspl(bytes) : decodeEscpos(bytes);
}
const row = (o: Partial<ApprovedPrinter>): ApprovedPrinter => ({ prefix: "CT221B-", brand: "Clabel", model: "CT221B", lang: "tspl", ...o });

describe("CT221B-D4F8 — the bitmap that is sent", () => {
  for (const engine of ["today", "one"] as const) for (const lang of ["tspl", "escpos"] as const) {
    it(`${engine} / ${lang}: shift 3 → left 24 dots; flip → 180°; flip + shift → rotated THEN shifted (same size)`, async () => {
      const base = await sent(lang, [row({ lang, shiftMm: 0, flip: false })], engine);
      expect(inkCount(base)).toBeGreaterThan(100);
      const shifted = await sent(lang, [row({ lang, shiftMm: 3 })], engine);
      expect([shifted.w, shifted.h]).toEqual([base.w, base.h]);
      expect(shifted.buf).toEqual(shiftRasterLeft(base, 24).buf);
      const flipped = await sent(lang, [row({ lang, flip: true })], engine);
      expect([flipped.w, flipped.h]).toEqual([base.w, base.h]);
      expect(flipped.buf).toEqual(flipRaster180(base).buf);
      const both = await sent(lang, [row({ lang, flip: true, shiftMm: 3 })], engine);
      expect(both.buf).toEqual(shiftRasterLeft(flipRaster180(base), 24).buf);
      expect(both.buf).not.toEqual(flipRaster180(shiftRasterLeft(base, 24)).buf); // order matters: the shift is LAST
    }, 60000);
  }
  it("no approved row = the same bytes as an approved row with flip off + shift 0", async () => {
    const none = await sent("tspl", [], "today");
    const zero = await sent("tspl", [row({ shiftMm: 0, flip: false })], "today");
    expect(zero.buf).toEqual(none.buf);
  }, 60000);
});

describe("helpers", () => {
  const r: FullRaster = { buf: Uint8Array.from([0b10000001, 0b11000000, 0b00000001, 0b00000000]), w: 16, h: 2, rowBytes: 2 };
  it("shiftRasterLeft drops columns on the left, white on the right; 0 = same object", () => {
    expect(shiftRasterLeft(r, 0)).toBe(r);
    expect([...shiftRasterLeft(r, 1).buf]).toEqual([0b00000011, 0b10000000, 0b00000010, 0b00000000]);
    expect([...shiftRasterLeft(r, 16).buf]).toEqual([0, 0, 0, 0]);
  });
  it("flipRaster180: twice = identity; non-byte width turned per dot", () => {
    expect(flipRaster180(flipRaster180(r)).buf).toEqual(r.buf);
    const odd: FullRaster = { buf: Uint8Array.from([0b10000000, 0b00000000]), w: 5, h: 2, rowBytes: 1 };
    expect([...flipRaster180(odd).buf]).toEqual([0, 0b00001000]);
  });
  it("applyApprovedLayout: none = same object", () => {
    expect(applyApprovedLayout(r, { flip: false, shiftDots: 0 })).toBe(r);
    expect(applyApprovedLayout(r, null)).toBe(r);
  });
  it("approvedLayoutFor: only an active approved row; built-in names never", () => {
    setApprovedPrinters([row({ shiftMm: 3, flip: true }), { prefix: "Y41", brand: "x", model: "x", lang: "tspl", shiftMm: 5, flip: true }]);
    expect(approvedLayoutFor(NAME)).toEqual({ flip: true, shiftDots: 24 });
    expect(approvedLayoutFor("Y41BT-0FC4_LE")).toEqual({ flip: false, shiftDots: 0 });
    expect(approvedLayoutFor("XP-420B")).toEqual({ flip: false, shiftDots: 0 });
    expect(approvedLayoutFor("D520BT-Z")).toEqual({ flip: false, shiftDots: 0 });
    expect(approvedLayoutFor("B1 Pro-I616030055")).toEqual({ flip: false, shiftDots: 0 });
    expect(approvedLayoutFor("LabelThing-9")).toEqual({ flip: false, shiftDots: 0 });
    setApprovedPrinters([row({ shiftMm: 2.5 })]);
    expect(approvedLayoutFor(NAME)).toEqual({ flip: false, shiftDots: 20 });
  });
  it("parse: shift_mm 0–8 (number or numeric string), else 0; flip only true", () => {
    expect([parseShiftMm(3), parseShiftMm("2.5"), parseShiftMm(null), parseShiftMm("x"), parseShiftMm(9), parseShiftMm(-1)]).toEqual([3, 2.5, 0, 0, 0, 0]);
    expect(parseApprovedRows([{ prefix: "CT221B-", lang: "tspl", shift_mm: "3.0", flip: true, active: true }, { prefix: "Abc-", lang: "cpcl", flip: "yes" }]))
      .toEqual([{ prefix: "CT221B-", brand: "Other", model: "CT221B-", lang: "tspl", shiftMm: 3, flip: true }, { prefix: "Abc-", brand: "Other", model: "Abc-", lang: "cpcl", shiftMm: 0, flip: false }]);
  });
});
