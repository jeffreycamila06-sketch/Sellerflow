// DEV-ONLY print-probe payloads — diagnoses the new-motherboard D520BT
// "every glyph doubled" rendering. These are RAW TSPL byte strings sent VERBATIM
// over the SAME BLE/SPP transport as testStickerPrint (native `printRawTspl`),
// NEVER through printStickerNative / buildTsplSticker / the order print path — so
// the production sticker builder and its golden fixtures are untouched.
//
// TRIVIALLY REMOVABLE: delete this file + screens/PrintProbe.tsx + the one
// "printprobe" gate in RedesignApp.tsx (and the additive `printRawTspl` bridge
// member + the two native `printRawTspl` methods). Nothing else references it.

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
