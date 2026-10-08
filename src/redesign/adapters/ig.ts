// INSTAGRAM LIVE — phase 1 client adapter (admin / preview only). Mirrors adapters/fb.ts:
// SERVER base + the Supabase JWT bearer. Visibility = the server's own lock (GET /ig/access:
// ig_enabled OR the Facebook preview list OR ig_tester_access) — fail closed, so while the
// server runtime is off (IG_ENABLED unset → /ig/access 404) nobody sees any Instagram UI.
// ig_accounts rows are read / deleted through RLS (own rows) and the token column is never
// selected (the column grants also hide it).
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../supabase";
import { SERVER, browserSessionId } from "./serverIdentity";
import { tpl, type RedesignT } from "../i18n";
import { liveRefusedText, ACCOUNT_NOT_COVERED } from "./accountLive";

export const IG_PLATFORM = "Instagram" as const;

async function bearer(): Promise<string> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    return session?.access_token || "";
  } catch {
    return "";
  }
}

// GET /ig/access → true only on a 200 { ok:true, instagram:true }. Anything else → false.
export async function loadIgAccess(): Promise<boolean> {
  try {
    const r = await fetch(`${SERVER}/ig/access`, { method: "GET", headers: { Authorization: `Bearer ${await bearer()}` } });
    if (r.status !== 200) return false;
    const j = (await r.json().catch(() => null)) as { ok?: unknown; instagram?: unknown } | null;
    return !!j && j.ok === true && j.instagram === true;
  } catch {
    return false;
  }
}

// Asked once per signed-in account and again on focus (at most every 5 s). Fail closed: the
// latest answer wins and any failure answers false; another account's answer never counts.
export function useIgAccess(enabled: boolean, userKey: string): boolean {
  const [state, setState] = useState<{ key: string; on: boolean }>({ key: "", on: false });
  const key = enabled ? userKey : "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let last = 0;
    const ask = () => {
      const t = Date.now();
      if (t - last < 5000) return;
      last = t;
      void loadIgAccess().then((on) => { if (alive) setState({ key, on }); });
    };
    ask();
    window.addEventListener("focus", ask);
    return () => { alive = false; window.removeEventListener("focus", ask); };
  }, [key]);
  return key !== "" && state.key === key ? state.on : false;
}

export interface IgAccount { id: string; igUserId: string; username: string; pageName: string; active: boolean }

export async function listIgAccounts(): Promise<IgAccount[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("ig_accounts")
      .select("id,ig_user_id,ig_username,page_name,active")
      .order("ig_user_id", { ascending: true });
    if (error || !Array.isArray(data)) return [];
    return data.map((r) => {
      const row = r as { id?: unknown; ig_user_id?: unknown; ig_username?: unknown; page_name?: unknown; active?: unknown };
      return { id: String(row.id ?? ""), igUserId: String(row.ig_user_id ?? ""), username: row.ig_username == null ? "" : String(row.ig_username), pageName: row.page_name == null ? "" : String(row.page_name), active: row.active !== false };
    });
  } catch {
    return [];
  }
}

export async function removeIgAccount(id: string): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const { error } = await supabase.from("ig_accounts").delete().eq("id", id);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

// The select_account / platform_status scoping key the server uses (username || id).
export const igScopeKey = (a: Pick<IgAccount, "username" | "igUserId">): string => a.username || a.igUserId;

export async function startIgAuth(opts: { app?: boolean } = {}): Promise<{ ok: boolean; url?: string }> {
  try {
    const r = await fetch(`${SERVER}/ig/oauth/start${opts.app ? "?client=app" : ""}`, { method: "GET", headers: { Authorization: `Bearer ${await bearer()}` } });
    const j = await r.json().catch(() => ({} as { url?: string }));
    return r.ok && j.url ? { ok: true, url: String(j.url) } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface IgConnectResult { ok: boolean; reason?: string; error?: string; unreachable?: boolean; igCode?: number }

export async function igConnect(igUserId: string): Promise<IgConnectResult> {
  try {
    const r = await fetch(`${SERVER}/ig/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
      body: JSON.stringify({ ig_user_id: String(igUserId), sessionId: browserSessionId() }),
    });
    const j = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; error?: string; ig_code?: unknown }));
    if (r.status === 429) return { ok: false, error: "too_many_requests" };
    if (r.status >= 200 && r.status < 300 && j.ok === true) return { ok: true };
    return { ok: false, reason: j.reason, error: j.error || `HTTP ${r.status}`, ...(typeof j.ig_code === "number" ? { igCode: j.ig_code } : {}) };
  } catch {
    return { ok: false, unreachable: true };
  }
}

export async function igDisconnect(igUserId: string): Promise<void> {
  try {
    await fetch(`${SERVER}/ig/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
      body: JSON.stringify({ ig_user_id: String(igUserId) }),
    });
  } catch { /* best effort */ }
}

// Never a raw server code.
export function igConnectFailText(r: IgConnectResult, t: RedesignT, live?: { ios: boolean; planName: string; max: number }): string {
  if (r.reason === "not_live") return t.rd_ig_not_live;
  if (r.unreachable) return t.rd_cm_cant_reach;
  const e = r.error || "";
  if (e === ACCOUNT_NOT_COVERED && live) return liveRefusedText(t, live);
  if (e === "needs_reauth" || e === "account_not_found") return t.rd_ig_reauth_toast;
  if (e === "too_many_requests") return t.rd_fb_too_many;
  if (typeof r.igCode === "number") return `${t.rd_cm_conn_failed} (IG ${r.igCode})`;
  return t.rd_cm_conn_failed;
}

// ?ig=connected | ?ig=error&code=… (web return) → toast text; null = cancelled on purpose.
export function parseIgReturn(search: string): { status: "connected" | "error"; code?: string } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(String(search || "").replace(/^\?/, "")); } catch { return null; }
  const s = params.get("ig");
  if (s === "connected") return { status: "connected" };
  if (s === "error") return { status: "error", code: params.get("code") || undefined };
  return null;
}
export function igReturnText(ret: { status: "connected" | "error"; code?: string }, t: RedesignT, max: number): string | null {
  if (ret.status === "connected") return t.rd_ig_authorized_toast;
  if (ret.code === "cancelled") return null;
  if (ret.code === "no_ig_account") return t.rd_ig_no_account;
  if (ret.code === "cap") return tpl(t.rd_ig_cap, { max });
  if (ret.code === "account_limit") return t.rd_acct_limit_generic_ios; // neutral wording on every platform
  return t.rd_ig_auth_error_toast;
}
