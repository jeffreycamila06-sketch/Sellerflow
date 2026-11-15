// Product photo limit per plan (sql/163 part 5): the seller's photos in product-images, counted on the
// server (small copies not counted). Free 50 · Basic 500 · Plus 1,500 · Pro 1,500 · Master 2,500.
// The database refuses an upload at the limit; the app shows the count and, after a refused upload,
// the limit message. Read on open and after an upload / delete — never polled.
import { isSupabaseConfigured, supabase } from "../../supabase";

export interface PhotoQuota { used: number; limit: number }
export async function loadPhotoQuota(): Promise<PhotoQuota | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("my_product_photo_quota");
    if (error || !data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const used = Number(d.used), limit = Number(d.limit);
    return Number.isFinite(used) && Number.isFinite(limit) ? { used, limit } : null;
  } catch { return null; }
}
export const atPhotoLimit = (q: PhotoQuota | null): boolean => !!q && q.used >= q.limit;
/** After an upload failed: the limit message when the server says the seller is at the limit,
 *  else the usual failure text. Pure apart from the one read. */
export async function uploadFailText(limitText: string, otherText: string, load: () => Promise<PhotoQuota | null> = loadPhotoQuota): Promise<{ text: string; quota: PhotoQuota | null }> {
  const quota = await load();
  return { text: atPhotoLimit(quota) ? limitText : otherText, quota };
}
