// INVOICING → FACEBOOK: the seller's saved edit of one buyer's Messenger receipt (sql/233 fb_receipt_edits).
// One read when a session's Facebook list opens (no timer, no poll), one upsert per save (the editor waits a
// moment after the last change), one delete for "Reset to original". RLS: own rows only. The server's Send all
// reads the same rows (service role) and draws them (server/fbSendAll.js). Nothing here touches an order,
// Sales, a sticker or the saved receipt format.
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { cleanReceiptEdit, type ReceiptEdit } from "../../lib/receiptEdit.js";

export const FB_EDIT_SAVE_MS = 800;
const TABLE = "fb_receipt_edits";
const HASH_RE = /^[0-9a-z]{1,40}$/;
export interface SavedReceiptEdit { edit: ReceiptEdit; basedOn: string | null }

async function ownUserId(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
}
/** A session's saved edits → buyer number → edit. null = the read failed. The table not there yet (sql/233 not
 *  applied) = no edits. */
export async function loadReceiptEdits(sessionId: string): Promise<Map<number, SavedReceiptEdit> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.from(TABLE).select("buyer_number, opening, lines, shipping_fee, note, based_on").eq("session_id", sessionId);
    if (error) return ["42P01", "PGRST205"].includes(String((error as { code?: string }).code)) ? new Map() : null;
    const out = new Map<number, SavedReceiptEdit>();
    for (const r of (data || []) as Record<string, unknown>[]) {
      const n = Number(r.buyer_number);
      if (Number.isInteger(n) && n > 0) out.set(n, { edit: cleanReceiptEdit(r), basedOn: typeof r.based_on === "string" ? r.based_on : null });
    }
    return out;
  } catch { return null; }
}
/** One upsert. true = saved. */
export async function saveReceiptEdit(sessionId: string, buyerNumber: number, edit: ReceiptEdit, basedOn: string | null): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    const e = cleanReceiptEdit(edit);
    const { error } = await supabase.from(TABLE).upsert({
      user_id: uid, session_id: sessionId, buyer_number: buyerNumber,
      opening: e.opening, note: e.note, lines: e.lines, shipping_fee: e.shippingFee,
      based_on: basedOn && HASH_RE.test(basedOn) ? basedOn : null,
    }, { onConflict: "user_id,session_id,buyer_number" });
    return !error;
  } catch { return false; }
}
/** "Reset to original" (or an edit put back exactly as the orders): the row goes. true = gone. */
export async function deleteReceiptEdit(sessionId: string, buyerNumber: number): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    const { error } = await supabase.from(TABLE).delete().eq("user_id", uid).eq("session_id", sessionId).eq("buyer_number", buyerNumber);
    return !error;
  } catch { return false; }
}

/** The saved edits of the session on screen: read once per session; the editor tells it what it saved / reset. */
export function useReceiptEdits(sessionId: string | null): {
  state: "loading" | "ready" | "error"; edits: Map<number, SavedReceiptEdit>; reload: () => void;
  put: (buyerNumber: number, v: SavedReceiptEdit | null) => void;
} {
  const [got, setGot] = useState<{ key: string; edits: Map<number, SavedReceiptEdit> | null; state: "loading" | "ready" | "error" }>({ key: "", edits: null, state: "loading" });
  const [turn, setTurn] = useState(0);
  const key = sessionId || "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void loadReceiptEdits(key).then((m) => { if (alive) setGot({ key, edits: m, state: m ? "ready" : "error" }); });
    return () => { alive = false; };
  }, [key, turn]);
  const reload = useCallback(() => setTurn((n) => n + 1), []);
  const put = useCallback((n: number, v: SavedReceiptEdit | null) => setGot((g) => {
    if (g.key !== key || !g.edits) return g;
    const m = new Map(g.edits);
    if (v) m.set(n, v); else m.delete(n);
    return { ...g, edits: m };
  }), [key]);
  const mine = got.key === key ? got : null;
  return { state: !key ? "ready" : mine ? mine.state : "loading", edits: mine?.edits ?? new Map(), reload, put };
}
