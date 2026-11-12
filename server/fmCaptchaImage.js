// FamilyMart (全家) tracking — the captcha picture, made readable for OCR. PURE (no network, no
// OCR, no dependency): GIF bytes → grey → black/white → bigger → BMP bytes for tesseract.
//
// The captcha: 6 digits, LIGHT digits on a GREY dotted background, tilted. Tesseract wants dark
// text on a light background, so the picture is inverted, cut to black/white, the dots removed
// and the result enlarged.
//
// ⚠️ NOT YET MEASURED ON A REAL CAPTCHA. Every value below is a starting point. Change them here,
// or without a deploy through app_settings key `fm_check_captcha` (JSON, same field names — see
// imageSettingsFrom). Each session logs captcha tries / hits so a change can be judged.
/** @typedef {{ invert: boolean, threshold: "auto" | number, despeckle: number, scale: number, border: number }} FmImageSettings */
/** @type {Readonly<FmImageSettings>} */
export const FM_CAPTCHA_IMAGE = Object.freeze({
  invert: true,       // true: light digits on a darker background (the picture is flipped first)
  threshold: "auto",  // "auto" (Otsu) or 0–255: after the flip, pixels DARKER than this are ink
  despeckle: 2,       // an ink pixel with fewer than this many ink neighbours (of 8) is a dot → removed; 0 = off
  scale: 3,           // whole-number enlargement, 1–6
  border: 12,         // white margin around the result, in output pixels, 0–40
});

const fail = (code) => { const e = new Error(code); e.code = code; return e; };
const MAX_SIDE = 2000;
const MAX_PIXELS = 1000 * 1000;

// PURE — settings from the app_settings value (a JSON string or an object). Anything missing or
// invalid keeps the constant above; every number is clamped.
export function imageSettingsFrom(raw) {
  let o = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { o = null; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ...FM_CAPTCHA_IMAGE };
  const int = (v, min, max, def) => (Number.isInteger(v) && v >= min && v <= max ? v : def);
  return {
    invert: typeof o.invert === "boolean" ? o.invert : FM_CAPTCHA_IMAGE.invert,
    threshold: o.threshold === "auto" ? "auto" : int(o.threshold, 0, 255, FM_CAPTCHA_IMAGE.threshold),
    despeckle: int(o.despeckle, 0, 8, FM_CAPTCHA_IMAGE.despeckle),
    scale: int(o.scale, 1, 6, FM_CAPTCHA_IMAGE.scale),
    border: int(o.border, 0, 40, FM_CAPTCHA_IMAGE.border),
  };
}

// ── GIF (first frame) ──────────────────────────────────────────────────────────
function lzw(minCodeSize, data, pixelCount) {
  if (minCodeSize < 2 || minCodeSize > 8) throw fail("gif_bad_code_size");
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let codeSize = minCodeSize + 1, codeMask = (1 << codeSize) - 1, avail = clear + 2, old = -1, first = 0;
  let bits = 0, datum = 0, op = 0, sp = 0, di = 0;
  while (op < pixelCount) {
    if (sp === 0) {
      if (bits < codeSize) {
        if (di >= data.length) break;
        datum |= data[di++] << bits;
        bits += 8;
        continue;
      }
      let code = datum & codeMask;
      datum >>= codeSize;
      bits -= codeSize;
      if (code > avail || code === eoi) break;
      if (code === clear) { codeSize = minCodeSize + 1; codeMask = (1 << codeSize) - 1; avail = clear + 2; old = -1; continue; }
      if (old === -1) {
        if (code >= clear) break; // the first code after a clear must be a plain colour
        stack[sp++] = suffix[code]; old = code; first = code;
        continue;
      }
      const inCode = code;
      if (code === avail) { stack[sp++] = first; code = old; }
      while (code > clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
      first = suffix[code];
      stack[sp++] = first;
      if (avail < 4096) {
        prefix[avail] = old; suffix[avail] = first; avail++;
        if ((avail & codeMask) === 0 && avail < 4096) { codeSize++; codeMask = (1 << codeSize) - 1; }
      }
      old = inCode;
    }
    sp--;
    out[op++] = stack[sp];
  }
  if (op < pixelCount) throw fail("gif_truncated"); // a cut-off file must never read as a blank picture
  return out;
}

// PURE — first frame of a GIF → { width, height, gray } (gray = one 0–255 value per pixel, row by row).
// Throws { code } for anything that is not a readable GIF.
export function decodeGif(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (b.length < 14 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) throw fail("not_gif");
  const le16 = (p) => b[p] | (b[p + 1] << 8);
  const width = le16(6), height = le16(8);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw fail("gif_bad_size");
  let p = 13, gct = null;
  if (b[10] & 0x80) { const n = 3 * (1 << ((b[10] & 7) + 1)); if (p + n > b.length) throw fail("gif_truncated"); gct = b.subarray(p, p + n); p += n; }
  const skipBlocks = () => { while (p < b.length) { const sz = b[p++]; if (!sz) return; p += sz; } };
  while (p < b.length) {
    const block = b[p++];
    if (block === 0x21) { p++; skipBlocks(); continue; }   // extension — not needed
    if (block === 0x3b) break;                              // trailer
    if (block !== 0x2c) throw fail("gif_bad_block");
    const x = le16(p), y = le16(p + 2), w = le16(p + 4), h = le16(p + 6), f = b[p + 8];
    p += 9;
    let ct = gct;
    if (f & 0x80) { const n = 3 * (1 << ((f & 7) + 1)); if (p + n > b.length) throw fail("gif_truncated"); ct = b.subarray(p, p + n); p += n; }
    if (!ct || !w || !h || x + w > width || y + h > height) throw fail("gif_bad_frame");
    const minCode = b[p++];
    const parts = [];
    let total = 0;
    while (p < b.length) { const sz = b[p++]; if (!sz) break; parts.push(b.subarray(p, p + sz)); total += sz; p += sz; }
    const data = new Uint8Array(total);
    let o = 0;
    for (const part of parts) { data.set(part, o); o += part.length; }
    const idx = lzw(minCode, data, w * h);
    // Interlaced frames store the rows in 4 passes.
    const rowOf = new Int32Array(h);
    if (f & 0x40) {
      let n = 0;
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = start; r < h; r += step) rowOf[n++] = r;
    } else for (let r = 0; r < h; r++) rowOf[r] = r;
    const gray = new Uint8Array(width * height).fill(255);
    for (let r = 0; r < h; r++) {
      const dst = (y + rowOf[r]) * width + x;
      for (let c = 0; c < w; c++) {
        const k = idx[r * w + c] * 3;
        gray[dst + c] = k + 2 < ct.length ? Math.round(0.299 * ct[k] + 0.587 * ct[k + 1] + 0.114 * ct[k + 2]) : 255;
      }
    }
    return { width, height, gray };
  }
  throw fail("gif_no_image");
}

// PURE — Otsu's threshold for a 0–255 grey picture.
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT + 1; // pixels DARKER than the returned value are ink
}

// PURE — grey picture → ink mask (1 = ink), after the flip, the cut and the dot removal.
export function inkMask(gray, width, height, settings = FM_CAPTCHA_IMAGE) {
  const g = settings.invert ? Uint8Array.from(gray, (v) => 255 - v) : gray;
  const t = settings.threshold === "auto" ? otsu(g) : settings.threshold;
  let ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = g[i] < t ? 1 : 0;
  if (settings.despeckle > 0) {
    const out = new Uint8Array(ink.length);
    for (let yy = 0; yy < height; yy++) {
      for (let xx = 0; xx < width; xx++) {
        if (!ink[yy * width + xx]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dy && !dx) continue;
            const ny = yy + dy, nx = xx + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width && ink[ny * width + nx]) n++;
          }
        }
        if (n >= settings.despeckle) out[yy * width + xx] = 1;
      }
    }
    ink = out;
  }
  return ink;
}

// PURE — ink mask → 24-bit BMP bytes (black ink on white), enlarged, with a white margin.
export function maskToBmp(ink, width, height, settings = FM_CAPTCHA_IMAGE) {
  const s = settings.scale, m = settings.border;
  const W = width * s + 2 * m, H = height * s + 2 * m;
  const rowBytes = (W * 3 + 3) & ~3;
  const bmp = new Uint8Array(54 + rowBytes * H).fill(255);
  const dv = new DataView(bmp.buffer);
  bmp[0] = 0x42; bmp[1] = 0x4d;
  dv.setUint32(2, bmp.length, true); dv.setUint32(6, 0, true); dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); dv.setInt32(18, W, true); dv.setInt32(22, H, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(30, 0, true);
  dv.setUint32(34, rowBytes * H, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  dv.setUint32(46, 0, true); dv.setUint32(50, 0, true);
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      if (!ink[yy * width + xx]) continue;
      for (let sy = 0; sy < s; sy++) {
        const outY = m + yy * s + sy;
        const row = 54 + (H - 1 - outY) * rowBytes; // BMP rows run bottom-up
        for (let sx = 0; sx < s; sx++) {
          const k = row + (m + xx * s + sx) * 3;
          bmp[k] = 0; bmp[k + 1] = 0; bmp[k + 2] = 0;
        }
      }
    }
  }
  return { bmp, width: W, height: H };
}

// PURE — captcha GIF bytes → { bmp, width, height } ready for OCR. Throws { code } when the bytes
// are not a readable GIF (the caller then hands the original bytes to OCR as they are).
export function captchaToBmp(bytes, settings = FM_CAPTCHA_IMAGE) {
  const img = decodeGif(bytes);
  return maskToBmp(inkMask(img.gray, img.width, img.height, settings), img.width, img.height, settings);
}
