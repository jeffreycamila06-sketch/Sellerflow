// DEV-ONLY print-probe payloads — diagnoses the new-motherboard D520BT
// "every glyph doubled" rendering. These are RAW TSPL byte strings sent VERBATIM
// over the SAME BLE/SPP transport as testStickerPrint (native `printRawTspl`),
// NEVER through printStickerNative / buildTsplSticker / the order print path — so
// the production sticker builder and its golden fixtures are untouched.
//
// TRIVIALLY REMOVABLE: delete this file + screens/PrintProbe.tsx + the one
// "printprobe" gate in RedesignApp.tsx (and the additive `printRawTspl` bridge
// member + the two native `printRawTspl` methods). Nothing else references it.

import { rasterizeTextStrip, encodeBandBytes } from "./stickerRaster";
import { LATIN_ATLAS } from "./glyphAtlas.latin";

const CRLF = "\r\n";

export interface Probe {
  id: string;
  label: string;   // button text (dev screen — plain English, not i18n)
  note: string;    // one-line "what it proves"
  bytes: Uint8Array;
}

// "100x60mm (Standard)" / "100x60" → { w:100, h:60 }. Fallback 100x60.
export function parseSizeMm(psSize: string): { w: number; h: number } {
  const m = /(\d+)\s*x\s*(\d+)/i.exec(psSize || "");
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 100, h: 60 };
}

function bytesOf(parts: (string | Uint8Array)[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += typeof p === "string" ? p.length : p.length;
  const out = new Uint8Array(len);
  let i = 0;
  for (const p of parts) {
    if (typeof p === "string") { for (let k = 0; k < p.length; k++) out[i++] = p.charCodeAt(k) & 0xff; }
    else { out.set(p, i); i += p.length; }
  }
  return out;
}

// Preamble mirrors the production sticker preamble EXCEPT the two tunables the
// probe varies: density === "omit" drops the DENSITY line; speed adds a SPEED line.
function preamble(w: number, h: number, opts: { density?: number | "omit"; speed?: number } = {}): string {
  let p = `SIZE ${w} mm, ${h} mm${CRLF}GAP 2 mm, 0${CRLF}DIRECTION 1${CRLF}REFERENCE 0,0${CRLF}`;
  if (opts.speed != null) p += `SPEED ${opts.speed}${CRLF}`;
  if (opts.density !== "omit") p += `DENSITY ${opts.density ?? 8}${CRLF}`;
  return p + `CLS${CRLF}`;
}

const textCmd = (x: number, y: number, font: string, xMul: number, yMul: number, content: string): string =>
  `TEXT ${x},${y},"${font}",0,${xMul},${yMul},"${content}"${CRLF}`;

// (a) Minimal one-line TEXT probe. If THIS doubles, the doubling is the firmware's
//     ROM-font renderer (our stream is fully exonerated).
function minimalText(w: number, h: number, opts?: { density?: number | "omit"; speed?: number }, tag = ""): Uint8Array {
  const label = tag ? `${tag}: ABC 123` : "ABC 123";
  return bytesOf([preamble(w, h, opts), textCmd(16, 10, "3", 1, 1, label), `PRINT 1${CRLF}`]);
}

// (b) Font sweep at one magnification — one label, self-identifying lines
//     ("F3 M2: ..."). Isolates whether ALL internal fonts double or only some.
function fontSweep(w: number, h: number, mul: number): Uint8Array {
  const step = mul === 1 ? 40 : 70; // leave room for the taller 2x glyphs
  const lines = ["1", "2", "3", "4"].map((f, idx) =>
    textCmd(16, 16 + idx * step, f, mul, mul, `F${f} M${mul}: ABC123 Ag8`));
  return bytesOf([preamble(w, h), ...lines, `PRINT 1${CRLF}`]);
}

// (c) BITMAP smoke test — proves whether the new board renders RASTER at all (the
//     Labelife route). Polarity-proof: top half one value, bottom half the other,
//     so ONE half prints black regardless of the firmware's bit convention.
function bitmapTest(w: number, h: number): Uint8Array {
  const widthBytes = 16;      // 128 dots wide
  const height = 64;          // dots
  const raster = new Uint8Array(widthBytes * height);
  for (let row = 0; row < height; row++) {
    const val = row < height / 2 ? 0x00 : 0xff;
    for (let b = 0; b < widthBytes; b++) raster[row * widthBytes + b] = val;
  }
  return bytesOf([
    preamble(w, h),
    textCmd(16, 10, "3", 1, 1, "BITMAP TEST"),
    `BITMAP 16,60,${widthBytes},${height},0,`,
    raster,
    CRLF,
    `PRINT 1${CRLF}`,
  ]);
}

// (e) TSPL SELFTEST — standalone, no preamble/PRINT. May be ignored on some
//     firmware (owner falls back to holding the feed button).
function selfTest(): Uint8Array {
  return bytesOf([`SELFTEST${CRLF}`]);
}

// ── BITMAP TEXT TRIAD (2026-09-07, new-board glyph-doubling isolation) ───────
// The original probe (d) was a SOLID box — a doubled solid box still looks
// solid, so it proved bitmap is ACCEPTED, not that it renders clean. These
// three print the SAME real glyph raster ("ABC 123", font 4 at 2x, from the
// production atlas/blitter/polarity) as a BITMAP under the three x-alignment
// regimes. Whichever prints clean identifies the firmware constraint:
//   (a) x=0, full-width row  — the production default after the H1 fix
//   (b) x=16 (byte-aligned), cropped band
//   (c) x=13 (NON-aligned),  cropped band — sub-byte shift stress
// The TEXT label line doubles on the new board but stays legible; tap order
// also identifies the print.
function bitmapTextProbe(w: number, h: number, variant: "a" | "b" | "c"): Uint8Array {
  const wDots = w * 8; // 203dpi = 8 dots/mm; all label widths are byte-exact
  const strip = rasterizeTextStrip("ABC 123", LATIN_ATLAS, "4", 2);
  const y = 70;
  let label: string, bmpCmd: string, data: Uint8Array;
  if (variant === "a") {
    label = "(a) x=0 full row";
    data = encodeBandBytes(strip, wDots, 16);
    bmpCmd = `BITMAP 0,${y},${wDots >> 3},${strip.h},0,`;
  } else {
    const bandW = strip.w; // byte-granular width; the variable is the X ORIGIN
    data = encodeBandBytes(strip, bandW, 0);
    const x = variant === "b" ? 16 : 13;
    label = variant === "b" ? "(b) x=16 aligned" : "(c) x=13 NOT aligned";
    bmpCmd = `BITMAP ${x},${y},${(bandW + 7) >> 3},${strip.h},0,`;
  }
  return bytesOf([
    preamble(w, h),
    textCmd(16, 10, "3", 1, 1, label),
    bmpCmd,
    data,
    CRLF,
    `PRINT 1${CRLF}`,
  ]);
}

export function buildProbes(psSize: string): Probe[] {
  const { w, h } = parseSizeMm(psSize);
  return [
    { id: "min", label: "1. Minimal TEXT", note: "One TEXT line. Doubles ⇒ firmware ROM-font rendering.", bytes: minimalText(w, h) },
    { id: "sweepM1", label: "2. Font sweep 1×", note: "Fonts 1-4 at 1×, labeled per line.", bytes: fontSweep(w, h, 1) },
    { id: "sweepM2", label: "3. Font sweep 2×", note: "Fonts 1-4 at 2×, labeled per line.", bytes: fontSweep(w, h, 2) },
    { id: "bitmap", label: "4. BITMAP test", note: "Raster block. Prints ⇒ new board supports bitmap (Labelife route).", bytes: bitmapTest(w, h) },
    { id: "density4", label: "5. Density 4", note: "Minimal TEXT with DENSITY 4.", bytes: minimalText(w, h, { density: 4 }, "DEN4") },
    { id: "nodensity", label: "6. No density", note: "Minimal TEXT, DENSITY line omitted.", bytes: minimalText(w, h, { density: "omit" }, "NODEN") },
    { id: "speed2", label: "7. Speed 2 added", note: "Minimal TEXT with SPEED 2 added.", bytes: minimalText(w, h, { speed: 2 }, "SPD2") },
    { id: "selftest", label: "8. Self-test (may be ignored)", note: "SELFTEST command; else hold the feed button.", bytes: selfTest() },
    { id: "bmpTextA", label: "9. BMP text (a) x=0 full row", note: "Glyphs as raster, full-width band at x=0. Clean ⇒ production default is right.", bytes: bitmapTextProbe(w, h, "a") },
    { id: "bmpTextB", label: "10. BMP text (b) x=16 aligned", note: "Same glyph raster, cropped band at byte-aligned x=16.", bytes: bitmapTextProbe(w, h, "b") },
    { id: "bmpTextC", label: "11. BMP text (c) x=13 NOT aligned", note: "Same raster at x=13 — stresses sub-byte x shifting (doubling suspect).", bytes: bitmapTextProbe(w, h, "c") },
  ];
}

// Binary-safe base64 for the native `printRawTspl` bridge (handles the BITMAP
// probe's non-ASCII raster bytes). Chunked so a large raster never blows the
// String.fromCharCode arg limit.
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  }
  return typeof btoa === "function" ? btoa(bin) : "";
}
