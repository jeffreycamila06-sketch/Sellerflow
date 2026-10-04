// MESSENGER RECEIPT format settings (sql/74 seller_receipt_settings, own row only):
// the seller's opening text, note (how to pay) and their OWN payment QR picture (a data URL).
// One read when a screen opens + one upsert on Save. Zero polling. A missing table or any
// read error is reported to the caller as { ok: false } — the screen shows a note, nothing
// else in the app depends on it.
import { isSupabaseConfigured, supabase } from "../../supabase";

export const OPENING_MAX = 300;
export const NOTE_MAX = 1000;
export const QR_DATA_URL_CAP = 300_000;   // client cap (DB check allows 400 000)
export const QR_MAX_SIDE = 600;

export interface ReceiptSettings { opening: string; note: string; qrImage: string | null }
export const EMPTY_RECEIPT_SETTINGS: ReceiptSettings = { opening: "", note: "", qrImage: null };

export function normalizeReceiptSettings(row: Record<string, unknown> | null | undefined): ReceiptSettings {
  if (!row) return { ...EMPTY_RECEIPT_SETTINGS };
  const qr = typeof row.qr_image === "string" && row.qr_image.startsWith("data:image/") ? row.qr_image : null;
  return {
    opening: String(row.opening ?? "").slice(0, OPENING_MAX),
    note: String(row.note ?? "").slice(0, NOTE_MAX),
    qrImage: qr,
  };
}

async function ownUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function loadReceiptSettings(): Promise<{ ok: true; settings: ReceiptSettings } | { ok: false }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const uid = await ownUserId();
    if (!uid) return { ok: false };
    const { data, error } = await supabase.from("seller_receipt_settings").select("opening, note, qr_image").eq("user_id", uid).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, settings: normalizeReceiptSettings(data as Record<string, unknown> | null) };
  } catch {
    return { ok: false };
  }
}

export async function saveReceiptSettings(s: ReceiptSettings): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    const { error } = await supabase.from("seller_receipt_settings").upsert({
      user_id: uid,
      opening: s.opening.slice(0, OPENING_MAX),
      note: s.note.slice(0, NOTE_MAX),
      qr_image: s.qrImage && s.qrImage.length <= QR_DATA_URL_CAP ? s.qrImage : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}

// ── QR picture downscale ──────────────────────────────────────────────────────
// Longest side ≤ maxSide, never upscaled.
export function fitWithin(w: number, h: number, maxSide = QR_MAX_SIDE): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

// PURE search for an encoding under the cap: PNG first (QR codes compress well and stay
// sharp), then JPEG at falling quality, then smaller sizes. `encode(scale, quality)`
// returns a data URL; quality null = PNG. Returns null when nothing fits.
export function encodeUnderCap(encode: (scale: number, quality: number | null) => string, cap = QR_DATA_URL_CAP): string | null {
  for (const scale of [1, 0.8, 0.6, 0.45, 0.33]) {
    for (const quality of [null, 0.9, 0.8, 0.7, 0.6]) {
      const url = encode(scale, quality);
      if (url && url.length <= cap) return url;
    }
  }
  return null;
}

// Browser-only: read the picked file, draw it at ≤ 600px longest side, encode under the cap.
export async function downscaleQrFile(file: Blob): Promise<string | null> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode_failed"));
    i.src = src;
  });
  const base = fitWithin(img.naturalWidth, img.naturalHeight);
  if (!base.w) return null;
  return encodeUnderCap((scale, quality) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(base.w * scale));
    c.height = Math.max(1, Math.round(base.h * scale));
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";                      // JPEG has no alpha — keep a white backing
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return quality == null ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", quality);
  });
}
