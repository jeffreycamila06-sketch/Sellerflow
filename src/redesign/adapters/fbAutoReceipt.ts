// B1 — automatic Messenger receipt after a Facebook live (client side). The server
// (server/fbAutoReceipt.js) sends it; this module: who sees the seller's toggle, and the toggle
// itself (sql/100 columns, read/written on their own so the receipt-format load/save and the
// sold-out section are untouched). The app's language and currency are saved with the toggle so
// the server draws the picture the way the seller sees it.
import { isSupabaseConfigured, supabase } from "../../supabase";

export const AUTO_RECEIPT_PLANS = ["plus", "pro", "master"] as const;

// The switch AND Messenger receipt access (from the server) AND Facebook open AND the platform
// world does not hide Facebook AND the plan is Plus or higher. Anything else → no toggle at all.
export function autoReceiptGate(a: { flag: boolean; receiptAccess: boolean; fbEnabled: boolean; hidden: boolean; plan: string | null | undefined }): boolean {
  const plan = String(a.plan || "").trim().toLowerCase();
  return a.flag && a.receiptAccess && a.fbEnabled && !a.hidden && (AUTO_RECEIPT_PLANS as readonly string[]).includes(plan);
}

async function ownUserId(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
}

export async function loadAutoReceipt(): Promise<{ ok: true; enabled: boolean } | { ok: false }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const uid = await ownUserId();
    if (!uid) return { ok: false };
    const { data, error } = await supabase.from("seller_receipt_settings").select("auto_receipt_enabled").eq("user_id", uid).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, enabled: (data as { auto_receipt_enabled?: unknown } | null)?.auto_receipt_enabled === true };
  } catch { return { ok: false }; }
}

export async function saveAutoReceipt(s: { enabled: boolean; lang: string; currency: string }): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    const { error } = await supabase.from("seller_receipt_settings").upsert(
      { user_id: uid, auto_receipt_enabled: s.enabled, auto_receipt_lang: String(s.lang || "en").slice(0, 8), auto_receipt_currency: String(s.currency || "NT$").slice(0, 8), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    return !error;
  } catch { return false; }
}
