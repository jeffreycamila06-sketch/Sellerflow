// TIKTOK API — Branch 1 (docs/plans/tiktok-api.md): the "TikTok videos — sell from comments" card.
// Server routes /tiktok/* (server/tiktokBiz.js). The server answers 404 { error:"off" } while the
// kill switch (TIKTOK_API_ENABLED) is off → the card hides itself (ttOff). Nothing here touches the
// live TikTok connect flow.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";
import type { RedesignT } from "../i18n";

// The ONE client gate: the switch (app_settings tiktok_api_enabled), admins, or the preview key.
export function tiktokApiGate(a: { switchOn: boolean; isAdmin: boolean; hasKey: boolean }): boolean {
  return a.switchOn === true || a.isAdmin === true || a.hasKey === true;
}

export interface TtAccount {
  id: string; ttAccountId: string; username: string; displayName: string; avatarUrl: string; followers: number;
  status: "active" | "revoked" | "error"; expiresAt: string | null; refreshExpiresAt: string | null;
  lastPollAt: string | null; lastWebhookAt: string | null; updatedAt: string | null; email?: string;
}
export type TtStatus = { kind: "off" } | { kind: "error" } | { kind: "ok"; account: TtAccount | null };

async function bearer(): Promise<string> {
  try { return (supabase ? (await supabase.auth.getSession()).data.session?.access_token : "") || ""; } catch { return ""; }
}
async function call(path: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> | null }> {
  try {
    const r = await fetch(withCodes(`${SERVER}${path}`), { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await bearer()}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    const j = decodeServerJson(await r.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: r.status, json: j };
  } catch { return { status: 0, json: null }; }
}
// 404 "off" → the card hides (ttOff); anything else that is not ok → "error" (the card shows a retry line).
export function readStatus(status: number, j: Record<string, unknown> | null): TtStatus {
  if (status === 404 && j && j.error === "off") return { kind: "off" };
  if (status !== 200 || !j || j.ok !== true) return { kind: "error" };
  return { kind: "ok", account: (j.account as TtAccount | null) ?? null };
}
export const loadTtStatus = async (): Promise<TtStatus> => { const r = await call("/tiktok/status"); return readStatus(r.status, r.json); };
// GET /tiktok/oauth/start → { url }: rendered as a REAL <a href> (iOS-safe, the SLIDE→BUTTON lesson).
export async function startTtAuth(opts: { app?: boolean } = {}): Promise<{ ok: boolean; url?: string; error?: string }> {
  const r = await call(`/tiktok/oauth/start${opts.app ? "?client=app" : ""}`);
  if (r.status === 200 && r.json && typeof r.json.url === "string") return { ok: true, url: r.json.url };
  return { ok: false, error: String((r.json && r.json.error) || (r.status ? `http_${r.status}` : "unreachable")) };
}
export async function ttDisconnect(): Promise<{ ok: boolean }> { const r = await call("/tiktok/disconnect", { method: "POST" }); return { ok: r.status === 200 && !!r.json && r.json.ok === true }; }
// Best effort before an account deletion (the FK cascade deletes the rows; this revokes at TikTok first).
export async function ttRevokeAll(): Promise<void> { await call("/tiktok/revoke-all", { method: "POST" }); }
export async function ttAdminRevokeUser(who: { userId?: string; email?: string }): Promise<void> { await call("/tiktok/admin/revoke-user", { method: "POST", body: JSON.stringify(who) }); }
export async function loadTtAdminAccounts(): Promise<TtAccount[] | null> {
  const r = await call("/tiktok/admin/accounts");
  return r.status === 200 && r.json && r.json.ok === true && Array.isArray(r.json.accounts) ? (r.json.accounts as TtAccount[]) : null;
}

// Pure — the OAuth-callback return on app load (?tt=connected | ?tt=error&code=…). Mirror parseFbReturn.
export const TT_RETURN_PARAMS = ["tt", "code"];
export interface TtReturn { status: "connected" | "error"; code?: string }
export function parseTtReturn(search: string): TtReturn | null {
  let p: URLSearchParams;
  try { p = new URLSearchParams(String(search || "").replace(/^\?/, "")); } catch { return null; }
  const s = p.get("tt");
  if (s === "connected") return { status: "connected" };
  if (s === "error") return { status: "error", code: p.get("code") || undefined };
  return null;
}
// Seller words for the return (no technical codes). not_business / not_registered have their own lines.
export function ttReturnText(ret: TtReturn, t: RedesignT): string {
  if (ret.status === "connected") return t.rd_tt_connected_toast;
  if (ret.code === "cancelled") return "";
  if (ret.code === "not_business") return t.rd_tt_not_business_toast;
  if (ret.code === "not_registered") return t.rd_tt_not_registered_toast;
  return t.rd_tt_connect_failed;
}

// One status read per open of the card screen + manual reload; never polls.
export function useTtAccount(enabled: boolean): { status: TtStatus | null; reload: () => Promise<void> } {
  const [status, setStatus] = useState<TtStatus | null>(null);
  const reload = useCallback(async () => { if (!enabled) return; setStatus(await loadTtStatus()); }, [enabled]);
  useEffect(() => { let live = true; if (!enabled) return; void loadTtStatus().then((s) => { if (live) setStatus(s); }); return () => { live = false; }; }, [enabled]);
  return { status, reload };
}

// Display helpers for the card (kept out of the component file: react-refresh only-export-components).
export function initialsOf(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.length ? parts.slice(0, 2).map((p) => p[0]).join("") : "@").toUpperCase();
}
export function followersText(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return String(n || 0);
}
