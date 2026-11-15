// Seller Website (audit B) — website photos at shop quality, like Shopify: the FULL photo up to
// 2048 px on its longest side, JPEG 0.85 (lowered step by step, never below 0.8), at most 1 MB; plus a
// SMALL copy (~600 px) used only in the shop grid, the cart and order lists. The product page shows
// the full photo. Photo 1 (the live product picture from the normal Edit form, productImages.ts)
// is NOT changed by this.
import { chooseEncoding, decodeUpright } from "./productImages";
import { fitWithin } from "./receiptSettings";

export const WEBSITE_PHOTO_MAX_SIDE = 2048;
export const WEBSITE_PHOTO_MAX_BYTES = 1024 * 1024;              // = the bucket limit set by sql/163
export const WEBSITE_PHOTO_QUALITIES = [0.85, 0.82, 0.8] as const;  // never below 0.8
export const WEBSITE_PHOTO_SCALES = [1, 0.9, 0.8, 0.7, 0.6] as const;
export const WEBSITE_SMALL_SIDE = 600;
export const WEBSITE_SMALL_MAX_BYTES = 300 * 1024;
export const WEBSITE_SMALL_QUALITIES = [0.8] as const;
export const WEBSITE_SMALL_SCALES = [1, 0.85] as const;

/** Which encoding to keep for the FULL photo (PURE over an injected encoder): the first ≤ 1 MB in the
 *  order quality 0.85 → 0.82 → 0.8 at full size, then smaller sizes. Nothing ≤ 1 MB → null. */
export function pickFullEncoding<T extends { size: number }>(encode: (scale: number, quality: number) => T | null): T | null {
  return chooseEncoding(encode, WEBSITE_PHOTO_MAX_BYTES, WEBSITE_PHOTO_MAX_BYTES, WEBSITE_PHOTO_SCALES, WEBSITE_PHOTO_QUALITIES);
}
export function pickSmallEncoding<T extends { size: number }>(encode: (scale: number, quality: number) => T | null): T | null {
  return chooseEncoding(encode, WEBSITE_SMALL_MAX_BYTES, WEBSITE_SMALL_MAX_BYTES, WEBSITE_SMALL_SCALES, WEBSITE_SMALL_QUALITIES);
}

function jpegBlob(url: string): Blob | null {
  const m = /^data:image\/jpeg;base64,(.*)$/.exec(url || "");
  if (!m) return null;
  const bin = atob(m[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

export type WebsitePhotoResult = { ok: true; full: Blob; small: Blob } | { ok: false; reason: "too_big" | "unreadable" };
/** Browser-only: picked file → { full, small } JPEGs, upright, white background. */
export async function compressWebsitePhoto(file: Blob): Promise<WebsitePhotoResult> {
  const up = await decodeUpright(file);
  if (!up) return { ok: false, reason: "unreadable" };
  try {
    const encodeAt = (maxSide: number) => (scale: number, quality: number) => {
      const base = fitWithin(up.w, up.h, maxSide);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(base.w * scale));
      c.height = Math.max(1, Math.round(base.h * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; } catch { /* older canvas */ }
      up.draw(ctx, c.width, c.height);
      return jpegBlob(c.toDataURL("image/jpeg", quality));
    };
    if (!fitWithin(up.w, up.h, WEBSITE_PHOTO_MAX_SIDE).w) return { ok: false, reason: "unreadable" };
    const full = pickFullEncoding(encodeAt(WEBSITE_PHOTO_MAX_SIDE));
    if (!full) return { ok: false, reason: "too_big" };
    const small = pickSmallEncoding(encodeAt(WEBSITE_SMALL_SIDE));
    if (!small) return { ok: false, reason: "too_big" };
    return { ok: true, full, small };
  } finally { up.done(); }
}
