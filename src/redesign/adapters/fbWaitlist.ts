// F3 — Facebook waitlist (sql/92). A sold-out Facebook comment (the F2 moment) joins the line
// for its code; in Orders the seller sees this session's line per code, oldest first, and may
// "Give" (the EXISTING order path — pin-to-print precedent) or "Skip". Nothing here creates an
// order and nothing is ever sent to the buyer on Give.
import { isSupabaseConfigured, supabase } from "../../supabase";
import type { Comment as ProdComment } from "../../lib/orderTypes";

export interface WaitlistRow {
  id: number; sessionId: string | null; code: string; productLocalId: number | null;
  commentId: string; pageId: string; liveVideoId: string | null; commenterId: string | null;
  commenterName: string; handle: string; createdAt: string; status: "waiting" | "given" | "skipped";
}

export function mapWaitlistRow(r: Record<string, unknown>): WaitlistRow {
  const s = String(r.status);
  return {
    id: Number(r.id), sessionId: r.session_id == null ? null : String(r.session_id), code: String(r.code ?? ""),
    productLocalId: r.product_local_id == null ? null : Number(r.product_local_id),
    commentId: String(r.comment_id ?? ""), pageId: String(r.page_id ?? ""),
    liveVideoId: r.live_video_id == null ? null : String(r.live_video_id), commenterId: r.commenter_id == null ? null : String(r.commenter_id),
    commenterName: String(r.commenter_name ?? ""), handle: String(r.handle ?? ""), createdAt: String(r.created_at ?? ""),
    status: s === "given" || s === "skipped" ? s : "waiting",
  };
}

// Waiting rows grouped by code (case-insensitive), each group oldest first; groups in the order
// their first row arrived. Pure.
export function groupWaitlist(rows: WaitlistRow[]): { code: string; rows: WaitlistRow[] }[] {
  const waiting = rows.filter((r) => r.status === "waiting").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const out: { code: string; rows: WaitlistRow[] }[] = [];
  for (const r of waiting) {
    const k = r.code.trim().toLowerCase();
    const g = out.find((x) => x.code.trim().toLowerCase() === k);
    if (g) g.rows.push(r); else out.push({ code: r.code, rows: [r] });
  }
  return out;
}

// The comment handed to createOrder on "Give" — the same shape the live Facebook lane delivers
// (handle / name / platform / comment = the code / msgId = the Facebook comment id / page meta).
export function rebuildWaitlistComment(r: WaitlistRow): ProdComment & { msgId: string; pageId: string; liveVideoId?: string; commenterId?: string } {
  return {
    handle: r.handle || r.commenterName || "unknown",
    name: r.commenterName || r.handle || "unknown",
    comment: r.code,
    platform: "Facebook",
    isBuy: false, buyerNum: null, buyerData: null,
    time: "", timestamp: r.createdAt,
    msgId: r.commentId, pageId: r.pageId,
    ...(r.liveVideoId ? { liveVideoId: r.liveVideoId } : {}),
    ...(r.commenterId ? { commenterId: r.commenterId } : {}),
  };
}

// "Is there already a buyer number with this display name this session?" (warn before Give:
// Facebook names are display names, two people can share one). Pure.
export function nameHasBuyer(name: string, buyers: { name?: string; handle?: string }[]): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return buyers.some((b) => (b.name || "").trim().toLowerCase() === n || (b.handle || "").trim().toLowerCase() === n);
}

export async function joinWaitlist(a: { sessionId: string | null; code: string; productLocalId: number | null; commentId: string; pageId: string; liveVideoId?: string; commenterId?: string; commenterName: string; handle: string }): Promise<number | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("fb_waitlist_join", {
      p_session_id: a.sessionId, p_code: a.code, p_product_local_id: a.productLocalId, p_comment_id: a.commentId, p_page_id: a.pageId,
      p_live_video_id: a.liveVideoId || "", p_commenter_id: a.commenterId || "", p_commenter_name: a.commenterName, p_handle: a.handle,
    });
    if (error || data == null) return null;
    const n = Number(data);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

// This session's rows only (null session = rows with no session). null = could not read.
export async function loadWaitlist(sessionId: string | null): Promise<WaitlistRow[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return null;
    let q = supabase.from("fb_waitlist").select("*").eq("user_id", uid).eq("status", "waiting");
    q = sessionId ? q.eq("session_id", sessionId) : q.is("session_id", null);
    const { data, error } = await q.order("created_at", { ascending: true }).limit(500);
    if (error || !Array.isArray(data)) return null;
    return (data as Record<string, unknown>[]).map(mapWaitlistRow);
  } catch { return null; }
}

export async function setWaitlistStatus(id: number, status: "given" | "skipped"): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from("fb_waitlist").update({ status }).eq("id", id);
    return !error;
  } catch { return false; }
}
