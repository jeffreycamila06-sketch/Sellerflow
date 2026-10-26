// SHOPEE LIVE BETA — the paste-link connect (server/shopeeLiveLink.js, 2026-10-27).
// POST /shopee/live/connect { shareLink, sessionId } with the seller's Supabase JWT; the
// server resolves the share link, checks the sharer is the host, starts the reader and
// answers { ok, uid } — `uid` (the seller's Shopee account) becomes the comment-scoping key.
import { supabase } from "../../supabase";
import { SERVER, browserSessionId } from "./serverIdentity";

export type ShopeeLinkFail = "bad_link" | "not_own" | "ended" | "unreachable" | "no_beta";
export type ShopeeLinkResult = { ok: true; uid: string; region: string } | { ok: false; error: ShopeeLinkFail };

// Server error code → the i18n key the paste form shows (shopee_off / blocked read as "not
// responding": the seller can only retry; no_beta = the window ended / was removed).
export const SHOPEE_LINK_ERR_KEY: Record<ShopeeLinkFail, string> = {
  bad_link: "rd_sh_err_bad_link", not_own: "rd_sh_err_not_own", ended: "rd_sh_err_ended",
  unreachable: "rd_sh_err_unreach", no_beta: "rd_sh_lock_ended",
};

export function shopeeLinkFailOf(status: number, code: unknown): ShopeeLinkFail {
  const c = String(code || "");
  if (c === "bad_link" || c === "not_own" || c === "ended" || c === "no_beta") return c;
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
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; uid?: unknown; region?: unknown; error?: unknown };
    if (r.ok && body.ok && body.uid != null) return { ok: true, uid: String(body.uid), region: String(body.region || "") };
    return { ok: false, error: shopeeLinkFailOf(r.status, body.error) };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}
