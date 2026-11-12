// PRODUCT PICTURES (Products tab only; switch product_images_enabled, sql/95). One picture per
// product in the public Storage bucket "product-images" at "{auth.uid()}/{local_id}.jpg"
// (replace = overwrite). products.image_path holds that path; the normal product save never
// writes it (productToRow is unchanged), only the picture actions below.
// Nov 12 2026 — the picture is adjusted on the device automatically (the seller just takes a photo
// or picks one): turned the right way up (EXIF orientation), the WHOLE picture kept (never
// cropped), longest side ≤ 1600 px, JPEG quality 0.85 — lower only when needed to stay under the
// bucket's 400 KB limit (sql/95). HEIC files the browser can't read are converted first.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { fitWithin } from "./receiptSettings";

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const PRODUCT_IMAGE_MAX_SIDE = 1600;
export const PRODUCT_IMAGE_QUALITY = 0.85;
export const PRODUCT_IMAGE_MAX_BYTES = 400 * 1024; // = the bucket's file_size_limit (409600, sql/95)
export const PRODUCT_IMAGE_TARGET_BYTES = 392 * 1024; // a little headroom under the limit
// Tried in this order; the first encoding ≤ the target wins (best quality / biggest size first).
export const PRODUCT_IMAGE_SCALES = [1, 0.85, 0.7, 0.55] as const;
export const PRODUCT_IMAGE_QUALITIES = [PRODUCT_IMAGE_QUALITY, 0.75, 0.65] as const;
export const PRODUCT_IMAGE_CACHE_SECONDS = "300"; // a replaced picture shows on other devices within ~5 min

export const productImagePath = (userId: string, localId: number): string => `${userId}/${localId}.jpg`;

// The encoding to keep (PURE): JPEG 0.85 at full size (≤ 1600 px) first; if over the target,
// lower quality, then smaller sizes; the first result ≤ target wins. Nothing ≤ target → the
// smallest result if it is ≤ maxBytes, else null (refused). encode(scale, quality) → bytes.
export function chooseEncoding<T extends { size: number }>(
  encode: (scale: number, quality: number) => T | null,
  target = PRODUCT_IMAGE_TARGET_BYTES, maxBytes = PRODUCT_IMAGE_MAX_BYTES,
  scales: readonly number[] = PRODUCT_IMAGE_SCALES, qualities: readonly number[] = PRODUCT_IMAGE_QUALITIES,
): T | null {
  let best: T | null = null;
  for (const scale of scales) {
    for (const quality of qualities) {
      const r = encode(scale, quality);
      if (!r || !r.size) continue;
      if (r.size <= target) return r;
      if (!best || r.size < best.size) best = r;
    }
  }
  return best && best.size <= maxBytes ? best : null;
}

// ── EXIF orientation (PURE) ─────────────────────────────────────────────────────────────────
// A phone stores most photos sideways plus a tag saying how to turn them. Current browsers
// turn them when decoding; for one that does not (checked once, see autoRotates), we turn the
// picture ourselves with these.

// JPEG header → EXIF orientation (1–8; 1 = none / not a JPEG / unreadable) and the stored
// (un-turned) size from the SOF marker (0 when not found).
export function readJpegInfo(bytes: Uint8Array): { orientation: number; width: number; height: number } {
  const out = { orientation: 1, width: 0, height: 0 };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return out;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break; // end / start of scan: no more headers
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    const seg = i + 4;
    if (marker === 0xe1 && len >= 8 && bytes[seg] === 0x45 && bytes[seg + 1] === 0x78 && bytes[seg + 2] === 0x69 && bytes[seg + 3] === 0x66) {
      const o = exifOrientation(bytes, seg + 6, Math.min(bytes.length, i + 2 + len));
      if (o) out.orientation = o;
    } else if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && seg + 5 <= bytes.length) {
      out.height = (bytes[seg + 1] << 8) | bytes[seg + 2];
      out.width = (bytes[seg + 3] << 8) | bytes[seg + 4];
    }
    i += 2 + len;
  }
  return out;
}

function exifOrientation(b: Uint8Array, tiff: number, end: number): number {
  if (tiff + 8 > end) return 0;
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!le && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return 0;
  const u16 = (o: number) => (o + 2 <= end ? (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]) : -1);
  const u32 = (o: number) => (o + 4 <= end ? (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0) : -1);
  const ifd = u32(tiff + 4);
  if (ifd < 0) return 0;
  const n = u16(tiff + ifd);
  for (let k = 0; k < n && k < 512; k++) {
    const e = tiff + ifd + 2 + k * 12;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}

// Orientations 5–8 swap width and height.
export const orientedSize = (w: number, h: number, o: number): { w: number; h: number } => (o >= 5 && o <= 8 ? { w: h, h: w } : { w, h });

// Canvas transform that draws a stored picture of dw × dh (drawn at 0,0) the right way up.
export function orientationMatrix(o: number, dw: number, dh: number): [number, number, number, number, number, number] {
  switch (o) {
    case 2: return [-1, 0, 0, 1, dw, 0];
    case 3: return [-1, 0, 0, -1, dw, dh];
    case 4: return [1, 0, 0, -1, 0, dh];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, dh, 0];
    case 7: return [0, -1, -1, 0, dh, dw];
    case 8: return [0, -1, 1, 0, 0, dw];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

// HEIC / HEIF (iPhone): by type, or by the "ftyp" box brand when the type is missing.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
export function isHeic(type: string, head: Uint8Array): boolean {
  if (/^image\/hei[cf](-sequence)?$/i.test(type || "")) return true;
  if (head.length < 12 || head[4] !== 0x66 || head[5] !== 0x74 || head[6] !== 0x79 || head[7] !== 0x70) return false;
  return HEIC_BRANDS.has(String.fromCharCode(head[8], head[9], head[10], head[11]));
}

// ── browser part ────────────────────────────────────────────────────────────────────────────
// A 2 × 1 JPEG tagged "turn 90°" (orientation 6): a decoder that honours the tag gives 1 × 2.
const ORIENT_PROBE = "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDACgcHiMeGSgjISMtKygwPGRBPDc3PHtYXUlkkYCZlo+AjIqgtObDoKrarYqMyP/L2u71////m8H////6/+b9//j/2wBDASstLTw1PHZBQXb4pYyl+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCUAdYf/9k=";

type Decoded = { src: CanvasImageSource; w: number; h: number; rotated: boolean; done: () => void };

const readHead = (file: Blob, n = 256 * 1024): Promise<Uint8Array> => new Promise((resolve) => {
  try {
    const r = new FileReader();
    r.onload = () => resolve(r.result instanceof ArrayBuffer ? new Uint8Array(r.result) : new Uint8Array(0));
    r.onerror = () => resolve(new Uint8Array(0));
    r.readAsArrayBuffer(file.slice(0, n));
  } catch { resolve(new Uint8Array(0)); }
});

const loadImg = (file: Blob): Promise<{ img: HTMLImageElement; done: () => void }> => new Promise((resolve, reject) => {
  let url = "";
  const done = () => { if (url.startsWith("blob:")) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } } };
  const go = (src: string) => {
    url = src;
    const i = new Image();
    i.onload = () => resolve({ img: i, done });
    i.onerror = () => { done(); reject(new Error("decode_failed")); };
    i.src = src;
  };
  try {
    if (typeof URL.createObjectURL === "function") { go(URL.createObjectURL(file)); return; }
  } catch { /* fall back to a data URL */ }
  const r = new FileReader();
  r.onload = () => go(String(r.result || ""));
  r.onerror = () => reject(new Error("read_failed"));
  r.readAsDataURL(file);
});

const bitmapOf = async (file: Blob): Promise<ImageBitmap | null> => {
  if (typeof createImageBitmap !== "function") return null;
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return null; }
};

const probeBlob = (): Blob => {
  const bin = atob(ORIENT_PROBE);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: "image/jpeg" });
};
let bitmapRotates: Promise<boolean> | null = null;
let imgRotates: Promise<boolean> | null = null;
// Does this decoder already turn photos by their EXIF tag? Checked once per decoder.
const decoderRotates = (kind: "bitmap" | "img"): Promise<boolean> => {
  if (kind === "bitmap") return (bitmapRotates ??= bitmapOf(probeBlob()).then((b) => { const ok = !!b && b.width === 1 && b.height === 2; try { b?.close(); } catch { /* ignore */ } return ok; }));
  return (imgRotates ??= loadImg(probeBlob()).then(({ img, done }) => { done(); return img.naturalWidth === 1 && img.naturalHeight === 2; }, () => true));
};

async function decodeOnce(file: Blob, autoRotates?: boolean): Promise<Decoded | null> {
  const bmp = await bitmapOf(file);
  if (bmp && bmp.width && bmp.height) {
    return { src: bmp, w: bmp.width, h: bmp.height, rotated: autoRotates ?? await decoderRotates("bitmap"), done: () => { try { bmp.close(); } catch { /* ignore */ } } };
  }
  try {
    const { img, done } = await loadImg(file);
    if (!img.naturalWidth || !img.naturalHeight) { done(); return null; }
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, rotated: autoRotates ?? await decoderRotates("img"), done };
  } catch { return null; }
}

// HEIC the browser can't read (laptop Chrome / Android) → JPEG, with a decoder loaded only then.
async function heicToJpeg(file: Blob): Promise<Blob | null> {
  try {
    const mod = await import("heic2any");
    const out = await mod.default({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const b = Array.isArray(out) ? out[0] : out;
    return b instanceof Blob && b.size ? b : null;
  } catch { return null; }
}

// One decoded picture, the right way up: its shown size (w × h, after the EXIF turn) and a
// draw(ctx, cw, ch) that paints the WHOLE picture upright into a cw × ch canvas (never cropped).
// Shared by product pictures and the receipt Payment QR (receiptSettings.downscaleQrFile).
export type UprightPicture = { w: number; h: number; draw: (ctx: CanvasRenderingContext2D, cw: number, ch: number) => void; done: () => void };

// Browser-only: decode a picked file (photo, gallery, HEIC the browser can't read → converted
// first) and work out the turn. null = not a picture we can read. opts.autoRotates is for tests.
export async function decodeUpright(file: Blob, opts: { autoRotates?: boolean } = {}): Promise<UprightPicture | null> {
  let head = await readHead(file);
  let decoded = await decodeOnce(file, opts.autoRotates);
  if (!decoded && isHeic((file as Blob).type, head)) {
    const jpeg = await heicToJpeg(file);
    if (jpeg) { head = await readHead(jpeg); decoded = await decodeOnce(jpeg, opts.autoRotates); }
  }
  if (!decoded) return null;
  const d = decoded;
  const info = readJpegInfo(head);
  // Turn it ourselves only when the decoder didn't (the tag is then still to be applied).
  const turn = d.rotated ? 1 : info.orientation;
  const shown = orientedSize(d.w, d.h, turn);
  return {
    w: shown.w, h: shown.h, done: d.done,
    draw: (ctx, cw, ch) => {
      const raw = orientedSize(cw, ch, turn); // the stored picture's size at this canvas size
      if (turn !== 1 && typeof ctx.setTransform === "function") ctx.setTransform(...orientationMatrix(turn, raw.w, raw.h));
      ctx.drawImage(d.src, 0, 0, raw.w, raw.h);
    },
  };
}

export type CompressResult = { ok: true; blob: Blob; width: number; height: number } | { ok: false; reason: "too_big" | "unreadable" };

// Browser-only: decode the picked file (photo, gallery, HEIC), turn it the right way up, draw the
// WHOLE picture at ≤ 1600 px longest side on white, encode JPEG. opts.autoRotates is for tests.
export async function compressProductImage(file: Blob, opts: { autoRotates?: boolean } = {}): Promise<CompressResult> {
  const up = await decodeUpright(file, opts);
  if (!up) return { ok: false, reason: "unreadable" };
  try {
    const base = fitWithin(up.w, up.h, PRODUCT_IMAGE_MAX_SIDE);
    if (!base.w) return { ok: false, reason: "unreadable" };
    const picked = chooseEncoding((scale, quality) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(base.w * scale));
      c.height = Math.max(1, Math.round(base.h * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; } catch { /* older canvas */ }
      up.draw(ctx, c.width, c.height);
      const url = c.toDataURL("image/jpeg", quality);
      const blob = dataUrlToBlob(url);
      return blob ? Object.assign(blob, { w: c.width, h: c.height }) : null;
    });
    if (!picked) return { ok: false, reason: "too_big" };
    const p = picked as Blob & { w: number; h: number };
    return { ok: true, blob: p, width: p.w, height: p.h };
  } finally { up.done(); }
}

function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url || "");
  if (!m || m[1] !== "image/jpeg") return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

async function ownUserId(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
}

// Public URL for a stored path (+ an optional version so a just-replaced picture is not served
// from the browser cache).
export function productImageUrl(path: string, version?: number): string {
  if (!supabase || !path) return "";
  const url = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  return version ? `${url}${url.includes("?") ? "&" : "?"}v=${version}` : url;
}

// local_id → image_path for the seller's products that have one. null = could not read.
export async function loadProductImagePaths(): Promise<Map<number, string> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const uid = await ownUserId();
  if (!uid) return null;
  try {
    const { data, error } = await supabase.from("products").select("local_id,image_path").eq("user_id", uid).not("image_path", "is", null);
    if (error || !Array.isArray(data)) return null;
    const m = new Map<number, string>();
    for (const r of data as { local_id: unknown; image_path: unknown }[]) if (r.image_path) m.set(Number(r.local_id), String(r.image_path));
    return m;
  } catch { return null; }
}

// Upload (overwrite) then store the path. Returns the path, or null on any failure — including
// an update that matched no product row (then the uploaded file is removed again, best effort).
export async function uploadProductImage(localId: number, blob: Blob): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const uid = await ownUserId();
  if (!uid) return null;
  const path = productImagePath(uid, localId);
  try {
    const up = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: PRODUCT_IMAGE_CACHE_SECONDS });
    if (up.error) return null;
    const { data, error } = await supabase.from("products").update({ image_path: path }).eq("user_id", uid).eq("local_id", localId).select("local_id");
    if (!error && Array.isArray(data) && data.length > 0) return path;
    // No product row matched (e.g. it never reached the database): the file would be an orphan.
    try { await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]); } catch { /* best effort */ }
    return null;
  } catch { return null; }
}

// Delete the object, then clear the column. true when both succeeded.
export async function removeProductImage(localId: number): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const uid = await ownUserId();
  if (!uid) return false;
  try {
    const rm = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([productImagePath(uid, localId)]);
    if (rm.error) return false;
    const { error } = await supabase.from("products").update({ image_path: null }).eq("user_id", uid).eq("local_id", localId);
    return !error;
  } catch { return false; }
}

// Product deleted → remove its object (fire-and-forget; never blocks or fails the delete).
export function forgetProductImage(localId: number): void {
  void (async () => {
    try {
      if (!isSupabaseConfigured || !supabase) return;
      const uid = await ownUserId();
      if (uid) await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([productImagePath(uid, localId)]);
    } catch { /* best effort */ }
  })();
}
