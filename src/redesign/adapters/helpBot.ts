// Help bot — client side (sql/116 + POST /support/ask). Seller: ask, rate, quick questions,
// "Admin answered" messages, bubble position. Admin: stats, the two review queues, FAQ list.
// Every read is on demand (chat open / admin panel open) — zero poll.
import { useEffect, useState } from "react";
import { SERVER } from "./serverIdentity";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";

export type HelpSource = "faq" | "faq_ai_match" | "ai" | "handoff" | "limit";
export interface AskResult { ok: boolean; id?: string; source?: HelpSource; answer?: string; saved?: boolean; contact?: boolean; error?: string }

// Shown only when the switch is on AND the seller is in preview (admins always are).
export const helpBotVisible = (switchOn: boolean, preview: boolean, isAdmin: boolean): boolean => switchOn && (preview || isAdmin);

// app_settings.support_ai_enabled — one small read per sign-in. Fail closed: only 'true' = on.
export async function loadHelpBotSwitch(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", "support_ai_enabled").maybeSingle();
    return !error && (data as { value?: unknown } | null)?.value === "true";
  } catch {
    return false;
  }
}
export function useHelpBotSwitch(userKey: string): boolean {
  const [st, setSt] = useState<{ key: string; on: boolean }>({ key: "", on: false });
  useEffect(() => {
    if (!userKey) return;
    let alive = true;
    void loadHelpBotSwitch().then((on) => { if (alive) setSt({ key: userKey, on }); });
    return () => { alive = false; };
  }, [userKey]);
  return !!userKey && st.key === userKey && st.on;
}

export async function askHelpBot(question: string, lang: string): Promise<AskResult> {
  const q = String(question || "").trim();
  if (!q) return { ok: false, error: "empty" };
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(withCodes(`${SERVER}/support/ask`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ question: q.slice(0, 500), lang }),
    });
    const j = decodeServerJson(await r.json().catch(() => ({}))) as Partial<AskResult> & { success?: boolean };
    if (!r.ok || !j.success) return { ok: false, error: r.status === 403 ? "not_available" : r.status === 429 ? "too_fast" : "failed" };
    return { ok: true, id: j.id, source: j.source, answer: j.answer, saved: !!j.saved, contact: !!j.contact };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export async function rateChat(id: string, rating: -1 | 0 | 1): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("support_rate", { p_chat_id: id, p_rating: rating });
  return !error && data === true;
}

// Fixed starter set (i18n keys) when there are no saved FAQs yet.
export const STARTER_KEYS = ["rd_hb_q1", "rd_hb_q2", "rd_hb_q3", "rd_hb_q4", "rd_hb_q5"] as const;
export async function loadQuickQuestions(lang: string): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc("support_quick_questions", { p_lang: lang, p_limit: 6 });
    if (error || !Array.isArray(data)) return [];
    return (data as { question: string }[]).map((r) => r.question).filter(Boolean).slice(0, 6);
  } catch {
    return [];
  }
}

export interface AdminAnswer { id: string; question: string; admin_answer: string; admin_answered_at: string; seen: boolean }
export async function loadAdminAnswers(): Promise<AdminAnswer[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc("support_admin_answers");
    return error || !Array.isArray(data) ? [] : (data as AdminAnswer[]);
  } catch {
    return [];
  }
}
export async function markAdminAnswersSeen(): Promise<void> {
  if (!supabase) return;
  try { await supabase.rpc("support_admin_answers_seen"); } catch { /* the dot stays; harmless */ }
}

// ── bubble position ─────────────────────────────────────────────────────────────
export const BUBBLE = 56;
export const TAP_SLOP = 6; // px of movement below which a press is a tap
const POS_KEY = "sfl_rd_helpbot_pos";
export interface BubblePos { side: "left" | "right"; y: number } // y = top, px
export interface Box { w: number; h: number; top: number; bottom: number } // top = header + safe area, bottom = nav + safe area

export function clampY(y: number, box: Box): number {
  const min = box.top + 8, max = box.h - box.bottom - BUBBLE - 8;
  return Math.round(Math.min(Math.max(y, min), Math.max(min, max)));
}
// Snap a drop point (bubble's top-left) to the nearest edge.
export function snapPos(x: number, y: number, box: Box): BubblePos {
  return { side: x + BUBBLE / 2 < box.w / 2 ? "left" : "right", y: clampY(y, box) };
}
export const defaultPos = (box: Box): BubblePos => ({ side: "right", y: clampY(box.h - box.bottom - BUBBLE - 16, box) });

export function loadBubblePos(): BubblePos | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || "null") as BubblePos | null;
    return p && (p.side === "left" || p.side === "right") && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}
export function saveBubblePos(p: BubblePos): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* per-device convenience only */ }
}

// ── admin ───────────────────────────────────────────────────────────────────────
export interface SupportStats { total: number; faq: number; faq_ai_match: number; ai: number; handoff: number; limit: number; cost_usd: number; cap_usd: number; saved: number }
export async function loadSupportStats(): Promise<SupportStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_support_stats");
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  const n = (k: string) => Number(d[k]) || 0;
  return { total: n("total"), faq: n("faq"), faq_ai_match: n("faq_ai_match"), ai: n("ai"), handoff: n("handoff"), limit: n("limit"), cost_usd: n("cost_usd"), cap_usd: n("cap_usd"), saved: n("saved") };
}
export const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0);

export interface QueueRow { id: string; question: string; answer: string | null; source: HelpSource; needs_admin: string | null; seller_rating: number; lang: string | null; created_at: string; total: number }
export async function loadQueue(tab: "approve" | "answer", offset = 0): Promise<QueueRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_support_queue", { p_tab: tab, p_offset: offset });
  return error || !Array.isArray(data) ? null : (data as QueueRow[]);
}
// Tab B: billing questions default to NOT saving as FAQ (the answer is about one seller).
export const saveFaqDefault = (row: Pick<QueueRow, "needs_admin">): boolean => row.needs_admin !== "billing";

export interface ApproveItem { id: string; ok: boolean; save_faq: boolean; question?: string; answer?: string }
export async function approveBatch(items: ApproveItem[]): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_support_approve_batch", { p_items: items });
  return error ? null : Number(data) || 0;
}
export interface AnswerItem { id: string; answer: string; save_faq: boolean }
// Empty boxes are skipped (they stay in the list).
export const answerItems = (rows: { id: string; answer: string; save_faq: boolean }[]): AnswerItem[] =>
  rows.filter((r) => r.answer.trim() !== "").map((r) => ({ id: r.id, answer: r.answer.trim(), save_faq: r.save_faq }));
export async function answerBatch(items: AnswerItem[]): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_support_answer_batch", { p_items: items });
  return error ? null : Number(data) || 0;
}

export interface FaqRow { id: number; question: string; answer: string; enabled: boolean; needs_recheck: boolean; lang: string | null }
export async function loadFaqs(): Promise<FaqRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_support_faq_list");
  return error || !Array.isArray(data) ? null : (data as FaqRow[]);
}
export async function updateFaq(id: number, patch: { question?: string; answer?: string; enabled?: boolean }): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("admin_support_faq_update", { p_id: id, p_question: patch.question ?? null, p_answer: patch.answer ?? null, p_enabled: patch.enabled ?? null });
  return !error && data === true;
}
