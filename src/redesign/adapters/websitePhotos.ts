// Seller Website — extra product photos (2..8) and the shop's logo / cover, in the SAME public
// product-images bucket (sql/95: public read, a seller writes only into their own folder).
// Photo 1 stays products.image_path (productImages.ts, unchanged). Paths:
//   <uid>/<localId>-p<n>.jpg (n = 2..8, full ≤ 2048 px) + <uid>/<localId>-p<n>-s.jpg (small copy)
//   · <uid>/site-logo-<t>.jpg · <uid>/site-cover-<t>.jpg
import { isSupabaseConfigured, supabase } from "../../supabase";
import { PRODUCT_IMAGE_BUCKET, PRODUCT_IMAGE_CACHE_SECONDS, compressProductImage } from "./productImages";
import { compressWebsitePhoto, type WebsitePhotoResult } from "./websitePhotoQuality";

async function uid(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
}
export const extraPhotoPath = (userId: string, localId: number, n: number) => `${userId}/${localId}-p${n}.jpg`;
/** A free photo number (2..8) not used by `paths`; null when all are used. Pure. */
export function freePhotoNumber(paths: string[]): number | null {
  const used = new Set(paths.map((p) => Number(/-p(\d)\.jpg$/.exec(p)?.[1])).filter(Number.isFinite));
  for (let n = 2; n <= 8; n++) if (!used.has(n)) return n;
  return null;
}

/** Compress + upload one website photo: the FULL photo (≤ 2048 px, JPEG ≥ 0.8, ≤ 1 MB) then its small copy
 *  ("…-p<n>-s.jpg", ~600 px, used in the shop grid / cart / order lists). Small copy failed → the full
 *  one is removed again and the upload counts as failed (never a photo without its small copy).
 *  The full photo goes first: the server accepts a small copy only when its full photo exists. */
export async function uploadExtraPhoto(localId: number, n: number, file: Blob, compress: (f: Blob) => Promise<WebsitePhotoResult> = compressWebsitePhoto): Promise<{ ok: true; path: string } | { ok: false; reason: "too_big" | "unreadable" | "failed" }> {
  const c = await compress(file);
  if (c.ok === false) return { ok: false, reason: c.reason };
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: "failed" };
  const me = await uid();
  if (!me) return { ok: false, reason: "failed" };
  const path = extraPhotoPath(me, localId, n);
  const bucket = supabase.storage.from(PRODUCT_IMAGE_BUCKET);
  const opts = { upsert: true, contentType: "image/jpeg", cacheControl: PRODUCT_IMAGE_CACHE_SECONDS };
  try {
    if ((await bucket.upload(path, c.full, opts)).error) return { ok: false, reason: "failed" };
    if ((await bucket.upload(smallPhotoPath(path), c.small, opts)).error) {
      try { await bucket.remove([path]); } catch { /* best effort */ }
      return { ok: false, reason: "failed" };
    }
    return { ok: true, path };
  } catch { return { ok: false, reason: "failed" }; }
}
export async function removeExtraPhoto(path: string): Promise<boolean> {
  return removeWebsitePhotos([path]);
}
/** The small copy of a website photo ("…-p3.jpg" → "…-p3-s.jpg"); any other path → itself. Pure. */
export const smallPhotoPath = (path: string): string => (/-p\d+\.jpg$/.test(path) ? path.replace(/\.jpg$/, "-s.jpg") : path);
/** Delete website photos together with their small copies (a product deleted, a photo removed). */
export async function removeWebsitePhotos(paths: string[]): Promise<boolean> {
  const all = [...new Set(paths.filter(Boolean).flatMap((p) => (smallPhotoPath(p) !== p ? [p, smallPhotoPath(p)] : [p])))];
  if (!all.length) return true;
  if (!isSupabaseConfigured || !supabase) return false;
  try { return !(await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(all)).error; } catch { return false; }
}

/** The shop logo / cover / payment QR (website editor; public bucket — all three are meant for buyers). Returns the path or null. */
export async function uploadSitePicture(kind: "logo" | "cover" | "qr" | "slide" | "promo" | "cat", file: Blob): Promise<string | null> {
  const c = await compressProductImage(file);
  if (c.ok === false || !isSupabaseConfigured || !supabase) return null;
  const me = await uid();
  if (!me) return null;
  const path = `${me}/site-${kind}-${Date.now()}.jpg`;
  try {
    const up = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, c.blob, { upsert: true, contentType: "image/jpeg", cacheControl: PRODUCT_IMAGE_CACHE_SECONDS });
    return up.error ? null : path;
  } catch { return null; }
}
