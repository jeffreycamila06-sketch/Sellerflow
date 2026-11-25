// QR reader for Scan QR (7-11 Parcel Scan, FamilyMart Parcel Scan, Blacklist) — reads the buyer's
// @username off the printed SFL sticker. CLIENT-SIDE ONLY, no Capacitor plugin (thin-shell lock intact).
//
// Why this is more than one call (iPhone, Nov 20 2026): a photo of the label roll usually holds 2–3
// stickers. jsQR (the only reader iPhone had — no BarcodeDetector in WKWebView) mixes the finder
// patterns of different QRs and finds nothing; it also gives up on a sticker curved over the fingers.
// So, stopping at the first pass that finds a code:
//   0. the phone's own reader (BarcodeDetector: Android / Chrome) — it returns every QR;
//   1. a stronger reader (ZXing C++ as WebAssembly, `zxing-wasm`, MIT; ZXing C++ is Apache-2.0) — also
//      returns every QR, handles tilt better. Loaded only when the seller taps Scan (and only where the
//      phone has no reader of its own). If it cannot load (old phone, no network), jsQR as before;
//   2. the whole photo (≤ 2400 px), then overlapping parts of it — halves, thirds, quadrants — each drawn
//      from the photo itself at good resolution (a part has one sticker even when the photo has three).
// Two DIFFERENT codes found → "many" (the screens say "2 stickers in the photo — show only one").
// Never a guess. The decoded text is used VERBATIM by the screens.
// Every scan sends one event `qr_scan` (result, reason, sizes, times — never the QR text or a name).
import { track } from "../analytics";
import { log } from "../../lib/log";

const MAX_EDGE = 1000;   // jsQR's quick pass (today's size)
const BASE_EDGE = 2400;  // the picture every pass reads; ≤ 4.3 MP — far under iPhone's canvas limit
const TILE_EDGE = 2400;  // a part of the photo, drawn from the photo itself
const TILE_EDGE_JS = 1400; // jsQR is plain JavaScript: smaller parts keep the slow fallback bearable
const ZX_LOAD_MS = 10000; // the stronger reader not ready after 10 s → jsQR this time (it keeps loading)

// Downscale target: never upscale; cap the long edge at maxEdge.
export function fitDims(w: number, h: number, maxEdge = MAX_EDGE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= maxEdge || long === 0) return { w, h };
  const s = maxEdge / long;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

// Decode from raw RGBA pixels via jsQR (dynamic import → out of the main bundle). One code or null.
export async function decodePixels(data: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  if (!width || !height) return null;
  try {
    const jsQR = (await import("jsqr")).default;
    const res = jsQR(data, width, height);
    return res && typeof res.data === "string" && res.data ? res.data : null;
  } catch { return null; }
}

// ── Result ────────────────────────────────────────────────────────────────────────────────────
export type QrNoneReason =
  | "image_unreadable"     // the photo could not be opened (not an image, or the phone refused it)
  | "canvas_failed"        // no drawing surface (out of memory)
  | "decoder_unavailable"  // neither reader could be loaded
  | "no_code";             // read fine, no QR in it
export interface QrPass { pass: string; ms: number; found: number }
export interface QrDiag {
  decoder: "native" | "zxing" | "jsqr" | "none";
  loader: "bitmap" | "bitmap_small" | "img" | "none";
  imgW: number; imgH: number; fileType: string; fileKb: number;
  ms: number; passes: QrPass[];
}
export type QrOutcome =
  | { kind: "one"; text: string }
  | { kind: "many"; count: number }
  | { kind: "none"; reason: QrNoneReason };
export type QrScanResult = QrOutcome & { diag: QrDiag };

/** What a set of codes means: none · one · many (two DIFFERENT texts; the same sticker twice = one). */
export function judge(texts: Iterable<string>): { kind: "none" } | { kind: "one"; text: string } | { kind: "many"; count: number } {
  const set = new Set<string>();
  for (const t of texts) if (typeof t === "string" && t) set.add(t);
  if (set.size === 0) return { kind: "none" };
  if (set.size === 1) return { kind: "one", text: [...set][0] };
  return { kind: "many", count: set.size };
}

// The parts of the photo tried after the whole photo (fractions: x, y, width, height). Each level is
// read completely before deciding, so two stickers in two parts are seen as two (never a guess).
export const TILE_LEVELS: { name: string; tiles: [number, number, number, number][] }[] = [
  { name: "halves", tiles: [[0, 0, 0.6, 1], [0.4, 0, 0.6, 1], [0, 0, 1, 0.6], [0, 0.4, 1, 0.6]] },
  { name: "thirds", tiles: [[0, 0, 0.45, 1], [0.275, 0, 0.45, 1], [0.55, 0, 0.45, 1], [0, 0, 1, 0.45], [0, 0.275, 1, 0.45], [0, 0.55, 1, 0.45]] },
  { name: "quadrants", tiles: [[0, 0, 0.6, 0.6], [0.4, 0, 0.6, 0.6], [0, 0.4, 0.6, 0.6], [0.4, 0.4, 0.6, 0.6], [0.2, 0.2, 0.6, 0.6]] },
];

// ── The stronger reader (WebAssembly) ─────────────────────────────────────────────────────────
type Pixels = { width: number; height: number; data: Uint8ClampedArray };
type ZxReader = { readBarcodes: (img: Pixels, o: Record<string, unknown>) => Promise<Array<{ isValid: boolean; text: string }>> };
const ZX_OPTIONS = { formats: ["QRCode"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 8 };
let zxing: Promise<ZxReader | null> | null = null;
function loadZxing(): Promise<ZxReader | null> {
  if (!zxing) {
    zxing = (async () => {
      try {
        const [mod, src] = await Promise.all([import("zxing-wasm/reader"), import("./qrWasm")]);
        await mod.prepareZXingModule({ overrides: src.zxingOverrides(), fireImmediately: true });
        return mod as unknown as ZxReader;
      } catch {
        zxing = null; // try again at the next scan
        return null;
      }
    })();
  }
  return zxing;
}
const hasNativeReader = (): boolean => typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector === "function";
/** Start loading the stronger reader when the seller taps Scan (only where the phone has no reader of
 *  its own) — it is then ready by the time the photo is picked. Never throws. */
export function warmQrReader(): void {
  try { if (!hasNativeReader()) void loadZxing(); } catch { /* ignore */ }
}
const within = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  new Promise((res) => { const t = setTimeout(() => res(fallback), ms); p.then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fallback); }); });

async function zxRead(zx: ZxReader, px: Pixels): Promise<string[]> {
  try { return (await zx.readBarcodes(px, ZX_OPTIONS)).filter((r) => r.isValid && r.text).map((r) => r.text); } catch { return []; }
}

// jsQR returns ONE code; blank it out and look again so a second sticker is seen (never a guess).
type Pt = { x: number; y: number };
async function jsqrAll(px: Pixels): Promise<string[]> {
  let jsQR: typeof import("jsqr").default;
  try { jsQR = (await import("jsqr")).default; } catch { return []; }
  const data = new Uint8ClampedArray(px.data);
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    let r: ReturnType<typeof jsQR>;
    try { r = jsQR(data, px.width, px.height); } catch { break; }
    if (!r || typeof r.data !== "string" || !r.data) break;
    out.push(r.data);
    const L = r.location;
    blank(data, px.width, px.height, [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner]);
  }
  return out;
}
function blank(d: Uint8ClampedArray, W: number, H: number, quad: Pt[]): void {
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4, cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  const q = quad.map((p) => ({ x: cx + (p.x - cx) * 1.3, y: cy + (p.y - cy) * 1.3 })); // + the quiet zone
  const x0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p.x)))), x1 = Math.min(W - 1, Math.ceil(Math.max(...q.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p.y)))), y1 = Math.min(H - 1, Math.ceil(Math.max(...q.map((p) => p.y))));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let inside = true;
    for (let k = 0; k < 4 && inside; k++) {
      const a = q[k], b = q[(k + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      const crossC = (b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x);
      if (cross * crossC < 0) inside = false;
    }
    if (inside) { const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; }
  }
}

// ── Opening the photo ─────────────────────────────────────────────────────────────────────────
interface Source { src: CanvasImageSource; w: number; h: number; via: QrDiag["loader"]; close: () => void }
async function openPhoto(file: File): Promise<Source | null> {
  const cib = (globalThis as { createImageBitmap?: (b: Blob, o?: ImageBitmapOptions) => Promise<ImageBitmap> }).createImageBitmap;
  if (typeof cib === "function") {
    try {
      const b = await cib(file);
      if (b && b.width > 0 && b.height > 0) return { src: b, w: b.width, h: b.height, via: "bitmap", close: () => { try { b.close?.(); } catch { /* ignore */ } } };
    } catch { /* below: a smaller copy */ }
    try { // a very large photo the phone would not open whole: ask for a 2400-px-wide copy
      const b = await cib(file, { resizeWidth: BASE_EDGE, resizeQuality: "high" });
      if (b && b.width > 0 && b.height > 0) return { src: b, w: b.width, h: b.height, via: "bitmap_small", close: () => { try { b.close?.(); } catch { /* ignore */ } } };
    } catch { /* below: an <img> */ }
  }
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    try { await within(img.decode().then(() => true), 15000, false); } catch { /* checked below */ }
    if (img.naturalWidth > 0 && img.naturalHeight > 0) return { src: img, w: img.naturalWidth, h: img.naturalHeight, via: "img", close: () => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } } };
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  } catch { /* nothing else to try */ }
  return null;
}

// Draw (part of) the photo onto a fresh canvas, long edge ≤ maxEdge; hand back the pixels + the canvas.
function draw(s: Source, rect: [number, number, number, number], maxEdge: number): { canvas: HTMLCanvasElement; px: Pixels } | null {
  const sx = Math.round(rect[0] * s.w), sy = Math.round(rect[1] * s.h);
  const sw = Math.max(1, Math.min(s.w - sx, Math.round(rect[2] * s.w))), sh = Math.max(1, Math.min(s.h - sy, Math.round(rect[3] * s.h)));
  const { w, h } = fitDims(sw, sh, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try { (ctx as CanvasRenderingContext2D).imageSmoothingQuality = "high"; } catch { /* ignore */ }
  ctx.drawImage(s.src, sx, sy, sw, sh, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  return { canvas, px: { width: id.width, height: id.height, data: id.data } };
}
const free = (c: HTMLCanvasElement | null | undefined): void => { if (c) { c.width = 0; c.height = 0; } }; // iPhone frees the memory now

type NativeDetector = new (o?: { formats?: string[] }) => { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> };

/** Read every QR in a photo; one / many / none (+ why). Never throws. */
export async function readQrFromFile(file: File): Promise<QrScanResult> {
  const t0 = now();
  const passes: QrPass[] = [];
  const diag: QrDiag = { decoder: "none", loader: "none", imgW: 0, imgH: 0, fileType: String(file?.type || "").slice(0, 24), fileKb: Math.round((file?.size || 0) / 1024), ms: 0, passes };
  const done = (r: QrOutcome): QrScanResult => {
    diag.ms = Math.round(now() - t0);
    const res = { ...r, diag } as QrScanResult;
    report(res);
    return res;
  };
  const step = async (pass: string, run: () => Promise<string[]>): Promise<ReturnType<typeof judge>> => {
    const t = now();
    const texts = await run();
    const j = judge(texts);
    passes.push({ pass, ms: Math.round(now() - t), found: j.kind === "none" ? 0 : j.kind === "one" ? 1 : j.count });
    return j;
  };

  let src: Source | null = null;
  let base: { canvas: HTMLCanvasElement; px: Pixels } | null = null;
  try {
    src = await openPhoto(file);
    if (!src) return done({ kind: "none", reason: "image_unreadable" });
    diag.loader = src.via; diag.imgW = src.w; diag.imgH = src.h;
    try { base = draw(src, [0, 0, 1, 1], BASE_EDGE); } catch { base = null; }
    if (!base) return done({ kind: "none", reason: "canvas_failed" });
    const whole = base;

    // 0. The phone's own reader.
    const BD = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector;
    if (typeof BD === "function") {
      diag.decoder = "native";
      const j = await step("native", async () => {
        try { return (await new BD({ formats: ["qr_code"] }).detect(whole.canvas)).map((c) => c.rawValue || ""); } catch { return []; }
      });
      if (j.kind !== "none") return done(j);
    }

    // 1. The stronger reader, else jsQR.
    const tz = now();
    const zx = await within(loadZxing(), ZX_LOAD_MS, null);
    passes.push({ pass: zx ? "zxing_load" : "zxing_unavailable", ms: Math.round(now() - tz), found: 0 });
    const read = zx ? (px: Pixels) => zxRead(zx, px) : (px: Pixels) => jsqrAll(px);
    if (!zx) {
      try { await import("jsqr"); } catch { return done({ kind: "none", reason: "decoder_unavailable" }); }
    }
    diag.decoder = zx ? "zxing" : "jsqr";

    // The parts of one level, each drawn from the photo itself; every code they hold.
    const readLevel = async (tiles: [number, number, number, number][]): Promise<string[]> => {
      const texts: string[] = [];
      for (const rect of tiles) {
        let tile: ReturnType<typeof draw>;
        try { tile = draw(src!, rect, zx ? TILE_EDGE : TILE_EDGE_JS); } catch { tile = null; }
        if (!tile) continue;
        texts.push(...(await read(tile.px)));
        free(tile.canvas);
      }
      return texts;
    };
    // jsQR sees ONE code per look and misses a second sticker next to it (or half inside the same part):
    // before answering "one", it reads every remaining level of parts and answers from ALL codes found.
    // Slower, but never a guess — and only when the stronger reader could not load (it returns every code).
    const settle = async (j: ReturnType<typeof judge>, after: number): Promise<QrScanResult> => {
      if (zx || j.kind !== "one") return done(j as QrOutcome);
      const t = now();
      const texts: string[] = [j.text];
      for (const level of TILE_LEVELS.slice(after)) texts.push(...(await readLevel(level.tiles)));
      const all = judge(texts);
      passes.push({ pass: "confirm", ms: Math.round(now() - t), found: all.kind === "many" ? all.count : 1 });
      return done(all as QrOutcome);
    };

    if (!zx) { // jsQR's quick pass first (today's size)
      const q = (() => { try { return draw(src, [0, 0, 1, 1], MAX_EDGE); } catch { return null; } })();
      if (q) {
        const j = await step("quick", () => read(q.px));
        free(q.canvas);
        if (j.kind !== "none") return settle(j, 0);
      }
    }
    const j0 = await step("whole", () => read(whole.px));
    if (j0.kind !== "none") return settle(j0, 0);
    free(base.canvas); base = null;

    // 2. Parts of the photo, drawn from the photo itself (each level read completely before deciding).
    for (const [i, level] of TILE_LEVELS.entries()) {
      const j = await step(level.name, () => readLevel(level.tiles));
      if (j.kind !== "none") return settle(j, i + 1);
    }
    return done({ kind: "none", reason: "no_code" });
  } catch {
    return done({ kind: "none", reason: diag.loader === "none" ? "image_unreadable" : "no_code" });
  } finally {
    if (base) free(base.canvas);
    src?.close();
  }
}

/** The text of the ONE QR in the photo, else null (no QR, or more than one). */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const r = await readQrFromFile(file);
  return r.kind === "one" ? r.text : null;
}

function now(): number { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }

// One event per scan. Sizes, times and the step names only — never the QR text, a username or a name.
function report(r: QrScanResult): void {
  const d = r.diag;
  const props = {
    result: r.kind, reason: r.kind === "none" ? r.reason : null, count: r.kind === "many" ? r.count : r.kind === "one" ? 1 : 0,
    decoder: d.decoder, loader: d.loader, img_w: d.imgW, img_h: d.imgH, file_type: d.fileType, file_kb: d.fileKb, ms: d.ms,
    passes: d.passes.map((p) => `${p.pass}:${p.found}:${p.ms}`).join(","),
  };
  try { track("qr_scan", props); } catch { /* analytics never breaks a scan */ }
  log.info("[QR] scan", props);
}

// ── The live camera (admin only today) — unchanged: the phone's reader, else jsQR, one frame. ──
async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const BD = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector;
  if (BD) {
    try {
      const codes = await new BD({ formats: ["qr_code"] }).detect(canvas);
      const v = codes && codes[0] && codes[0].rawValue;
      if (v) return v;
    } catch { /* fall through to jsQR */ }
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodePixels(img.data, img.width, img.height);
}
function drawDownscaled(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement | null {
  const { w: dw, h: dh } = fitDims(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = dw; canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, dw, dh);
  return canvas;
}
// Decode a QR from the live <video> preview (a frame grab — no file round-trip).
export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = drawDownscaled(video, video.videoWidth, video.videoHeight);
  return canvas ? decodeCanvas(canvas) : null;
}

// ── Live camera frames for the in-page scanner (adapters/webQrScanner) — ADDED, nothing above changed ──
// Every QR in one frame's pixels WITH its centre (the centre rule needs positions). Only used where the
// phone has no reader of its own: the stronger reader (the SAME loader as the photo flow), else jsQR.
// null = no reader could be loaded. Never throws.
export interface QrPixelHit { text: string; cx: number; cy: number }
type ZxPlaced = { isValid: boolean; text: string; position?: { topLeft: Pt; topRight: Pt; bottomRight: Pt; bottomLeft: Pt } };
const ZX_LIVE_OPTIONS = { formats: ["QRCode"], tryHarder: false, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 4 };
let zxLiveGaveUp = false; // the stronger reader did not load once → jsQR for the rest of this app open
export async function readQrHitsFromPixels(px: Pixels): Promise<QrPixelHit[] | null> {
  if (!px || !px.width || !px.height) return [];
  const centre = (q: Pt[]): { cx: number; cy: number } => ({ cx: q.reduce((s, p) => s + p.x, 0) / q.length, cy: q.reduce((s, p) => s + p.y, 0) / q.length });
  if (!zxLiveGaveUp) {
    const zx = await within(loadZxing(), ZX_LOAD_MS, null);
    if (zx) {
      try {
        const out: QrPixelHit[] = [];
        for (const r of (await zx.readBarcodes(px, ZX_LIVE_OPTIONS)) as ZxPlaced[]) {
          const p = r.position;
          if (!r.isValid || !r.text || !p) continue;
          out.push({ text: r.text, ...centre([p.topLeft, p.topRight, p.bottomRight, p.bottomLeft]) });
        }
        return out;
      } catch { return []; }
    }
    zxLiveGaveUp = true;
  }
  let jsQR: typeof import("jsqr").default;
  try { jsQR = (await import("jsqr")).default; } catch { return null; }
  // jsQR sees ONE code per look: blank it and look once more, so a second sticker is seen (never a guess).
  const data = new Uint8ClampedArray(px.data);
  const out: QrPixelHit[] = [];
  for (let i = 0; i < 2; i++) {
    let r: ReturnType<typeof jsQR>;
    try { r = jsQR(data, px.width, px.height); } catch { break; }
    if (!r || typeof r.data !== "string" || !r.data) break;
    const L = r.location;
    const quad = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner];
    out.push({ text: r.data, ...centre(quad) });
    blank(data, px.width, px.height, quad);
  }
  return out;
}
