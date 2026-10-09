// F2 — Facebook sold-out message (client side). The server (server/fbSoldout.js) sends ONE
// private text reply to a Facebook buyer whose comment hit a sold-out Auto code. This module:
// the gate, the seller's own toggle + text (sql/91 columns, read/written on their own so the
// existing receipt-format load/save is untouched), and the fire-and-forget send.
import { isSupabaseConfigured, supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";

export const SOLDOUT_TEXT_MAX = 500;

// Who may see / use the sold-out message (the seller's own toggle comes on top):
// the switch AND Messenger receipt access (from the server, never the preview list) AND
// Facebook open AND the platform world does not hide it.
export function soldoutGate(a: { flag: boolean; receiptAccess: boolean; fbEnabled: boolean; hidden: boolean }): boolean {
  return a.flag && a.receiptAccess && a.fbEnabled && !a.hidden;
}

export interface SoldoutComment { platform?: string; msgId?: string; pageId?: string; initial?: boolean }
// A comment the server can answer: a live (not "Earlier comments") Facebook comment with its
// comment id and page id.
export function soldoutTarget(c: SoldoutComment): { commentId: string; pageId: string } | null {
  if (!c || c.platform !== "Facebook" || c.initial === true) return null;
  const commentId = String(c.msgId || "").trim();
  const pageId = String(c.pageId || "").trim();
  return commentId && pageId ? { commentId, pageId } : null;
}

async function ownUserId(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
}
async function bearer(): Promise<string> {
  try { return (await supabase?.auth.getSession())?.data.session?.access_token || ""; } catch { return ""; }
}

export interface SoldoutSettings { enabled: boolean; text: string }
export async function loadSoldoutSettings(): Promise<{ ok: true; settings: SoldoutSettings } | { ok: false }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const uid = await ownUserId();
    if (!uid) return { ok: false };
    const { data, error } = await supabase.from("seller_receipt_settings").select("soldout_enabled, soldout_text").eq("user_id", uid).maybeSingle();
    if (error) return { ok: false };
    const row = (data || {}) as { soldout_enabled?: unknown; soldout_text?: unknown };
    return { ok: true, settings: { enabled: row.soldout_enabled === true, text: String(row.soldout_text ?? "").slice(0, SOLDOUT_TEXT_MAX) } };
  } catch { return { ok: false }; }
}

export async function saveSoldoutSettings(s: SoldoutSettings): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    const { error } = await supabase.from("seller_receipt_settings").upsert(
      { user_id: uid, soldout_enabled: s.enabled, soldout_text: s.text.trim().slice(0, SOLDOUT_TEXT_MAX), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    return !error;
  } catch { return false; }
}

export interface SoldoutSendInput { pageId: string; commentId: string; code: string; lang: string; position?: number | null }
export type SoldoutSendResult = { ok: true } | { ok: false; error: string };
export async function sendSoldOut(input: SoldoutSendInput, fetchImpl: typeof fetch = fetch): Promise<SoldoutSendResult> {
  try {
    const r = await fetchImpl(withCodes(`${SERVER}/fb/soldout/send`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
      body: JSON.stringify({ pageId: input.pageId, commentId: input.commentId, code: input.code, lang: input.lang, ...(input.position ? { position: input.position } : {}) }),
    });
    const j = decodeServerJson(await r.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
    if (r.status === 200 && j && j.ok === true) return { ok: true };
    return { ok: false, error: typeof j?.error === "string" ? j.error : `http_${r.status}` };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}
