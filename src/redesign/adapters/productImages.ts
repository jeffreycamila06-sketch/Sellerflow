// PRODUCT PICTURES (Products tab only; switch product_images_enabled, sql/95). One picture per
// product in the public Storage bucket "product-images" at "{auth.uid()}/{local_id}.jpg"
// (replace = overwrite). products.image_path holds that path; the normal product save never
// writes it (productToRow is unchanged), only the picture actions below. The picture is
// compressed on the device first: longest side ≤ 800 px, JPEG, aim ≤ ~150 KB, refuse > 400 KB.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { fitWithin } from "./receiptSettings";

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const PRODUCT_IMAGE_MAX_SIDE = 800;
export const PRODUCT_IMAGE_TARGET_BYTES = 150 * 1024;
export const PRODUCT_IMAGE_MAX_BYTES = 400 * 1024;
export const PRODUCT_IMAGE_CACHE_SECONDS = "300"; // a replaced picture shows on other devices within ~5 min

export const productImagePath = (userId: string, localId: number): string => `${userId}/${localId}.jpg`;

// The encoding to keep (PURE): JPEG 0.8 at full size first; if over the target, lower quality,
// then smaller sizes; the first result ≤ target wins. Nothing ≤ target → the smallest result if
// it is ≤ maxBytes, else null (refused). encode(scale, quality) → bytes (0 = failed).
export function chooseEncoding<T extends { size: number }>(
  encode: (scale: number, quality: number) => T | null,
  target = PRODUCT_IMAGE_TARGET_BYTES, maxBytes = PRODUCT_IMAGE_MAX_BYTES,
): T | null {
  let best: T | null = null;
  for (const scale of [1, 0.8, 0.6]) {
    for (const quality of [0.8, 0.7, 0.6, 0.5]) {
      const r = encode(scale, quality);
      if (!r || !r.size) continue;
      if (r.size <= target) return r;
      if (!best || r.size < best.size) best = r;
    }
  }
  return best && best.size <= maxBytes ? best : null;
}

export type CompressResult = { ok: true; blob: Blob; width: number; height: number } | { ok: false; reason: "too_big" | "unreadable" };

// Browser-only: decode the picked file, draw at ≤ 800 px longest side on white, encode JPEG.
export async function compressProductImage(file: Blob): Promise<CompressResult> {
  let img: HTMLImageElement;
  try {
    const src = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("read_failed"));
      r.readAsDataURL(file);
    });
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode_failed"));
      i.src = src;
    });
  } catch { return { ok: false, reason: "unreadable" }; }
  const base = fitWithin(img.naturalWidth, img.naturalHeight, PRODUCT_IMAGE_MAX_SIDE);
  if (!base.w) return { ok: false, reason: "unreadable" };
  const picked = chooseEncoding((scale, quality) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(base.w * scale));
    c.height = Math.max(1, Math.round(base.h * scale));
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", quality);
    const blob = dataUrlToBlob(url);
    return blob ? Object.assign(blob, { w: c.width, h: c.height }) : null;
  });
  if (!picked) return { ok: false, reason: "too_big" };
  const p = picked as Blob & { w: number; h: number };
  return { ok: true, blob: p, width: p.w, height: p.h };
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
