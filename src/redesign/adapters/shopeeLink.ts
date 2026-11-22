// SHOPEE LIVE BETA — the paste-link connect (server/shopeeLiveLink.js, 2026-10-27).
// POST /shopee/live/connect { shareLink, sessionId } with the seller's Supabase JWT; the
// server resolves the share link, checks the sharer is the host, starts the reader and
// answers { ok, uid } — `uid` (the seller's Shopee account) becomes the comment-scoping key.
import { supabase } from "../../supabase";
import { SERVER, browserSessionId } from "./serverIdentity";

export type ShopeeLinkFail = "bad_link" | "not_own" | "ended" | "unreachable" | "no_beta"
  | "shop_limit" | "shop_locked" | "not_covered"; // sql/199 — only ever sent for a seller in the preview / after the switch
// The numbers a refusal carries (sql/199): the "Plan full" popup's countdown uses next_free_at with the server's now.
export interface ShopeeLimitInfo { used: number | null; limit: number | null; nextFreeAt: string | null; serverNow: string | null }
export type ShopeeLinkResult = { ok: true; uid: string; region: string } | { ok: false; error: ShopeeLinkFail; info?: ShopeeLimitInfo };

// Server error code → the i18n key the paste form shows (shopee_off / blocked read as "not
// responding": the seller can only retry; no_beta = the window ended / was removed).
// try_again (a database error at the account step) reads as "not responding" too.
export const SHOPEE_LINK_ERR_KEY: Record<ShopeeLinkFail, string> = {
  bad_link: "rd_sh_err_bad_link", not_own: "rd_sh_err_not_own", ended: "rd_sh_err_ended",
  unreachable: "rd_sh_err_unreach", no_beta: "rd_sh_lock_ended",
  shop_limit: "rd_sh_err_shop_limit", shop_locked: "rd_sh_err_shop_locked", not_covered: "rd_sh_err_not_covered",
};
// The refusals the "Plan full" popup answers (the box keeps its one-line text under it).
export const isShopeeLimitFail = (e: ShopeeLinkFail): boolean => e === "shop_limit" || e === "shop_locked" || e === "not_covered";

export function shopeeLinkFailOf(status: number, code: unknown): ShopeeLinkFail {
  const c = String(code || "");
  if (c === "bad_link" || c === "not_own" || c === "ended" || c === "no_beta") return c;
  if (status === 409 && (c === "shop_limit" || c === "shop_locked" || c === "not_covered")) return c;
  if (status === 403) return "no_beta";
  if (status === 410) return "ended";
  if (status === 400) return "bad_link";
  return "unreachable";
}

export async function shopeeLinkConnect(
  shareLink: string,
  deps: { fetchImpl?: typeof fetch; sessionId?: () => string } = {},
): Promise<ShopeeLinkResult> {
  const f = deps.fetchImpl ?? fetch;
  const token: string = supabase ? await supabase.auth.getSession().then((s) => s.data.session?.access_token || "", () => "") : "";
  try {
    const r = await f(`${SERVER}/shopee/live/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ shareLink: String(shareLink || "").trim(), sessionId: (deps.sessionId ?? browserSessionId)() }),
    });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; uid?: unknown; region?: unknown; error?: unknown; used?: unknown; limit?: unknown; next_free_at?: unknown; now?: unknown };
    if (r.ok && body.ok && body.uid != null) return { ok: true, uid: String(body.uid), region: String(body.region || "") };
    const error = shopeeLinkFailOf(r.status, body.error);
    if (!isShopeeLimitFail(error)) return { ok: false, error };
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const iso = (x: unknown) => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);
    return { ok: false, error, info: { used: num(body.used), limit: num(body.limit), nextFreeAt: iso(body.next_free_at), serverNow: iso(body.now) } };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}
