// TikTok/Facebook connect + multi-account helpers — copied VERBATIM from App.tsx
// (accountList 259 / accountText 260 / maxAcc 256 / registeredAccountCount 262 /
// canConnectMore 276 / cleanLiveAccount 159) + connectPlatform (4269-4312). Imports
// only the shared supabase singleton.
//
// ⚠️ PREVIEW-UNVERIFIABLE: connect POSTs to the Render live server
// (sellerflow-live-server.onrender.com), which the Vercel preview cannot reach, and
// account activation arrives via server-pushed `platform_status` socket events. This
// only truly works in the merged build with the live socket — on preview the POST
// fails gracefully (toast) and nothing activates.
import { supabase } from "../../supabase";
import type { AccountUser } from "../../accountDb";
// Batch E (#13): server URL + seller/browser identity now come from the ONE
// shared module (was a local copy identical to useLiveFeed's — parity-tested).
import { SERVER, sellerIdOf, browserSessionId } from "./serverIdentity";
import { isAdminRole } from "../../lib/roles";

export type Platform = "TikTok" | "Facebook";

// ── Pure helpers (verbatim) — unit-tested ────────────────────────────────────
export const cleanLiveAccount = (value: string): string => String(value || "").trim().replace(/^@+/, "").toLowerCase(); // 159
export const maxAcc = (plan: string): number => (({ free: 1, trial: 1, basic: 1, pro: 3, master: 5 } as Record<string, number>)[plan] ?? 1); // 256
export const accountList = (value: string): string[] => Array.from(new Set((value || "").split(/[,\n]/).map((v) => v.trim()).filter(Boolean))); // 259
export const accountText = (values: string[]): string => values.map((v) => v.trim()).filter(Boolean).join("\n"); // 260
export const registeredAccountCount = (u: AccountUser): number => accountList(u.profile.tiktok).length + accountList(u.profile.facebook).length; // 262
export const isAdminUser = (u: AccountUser): boolean => isAdminRole(u.role); // Batch E #16 — shared predicate (db-cased "admin")
export const canConnectMore = (u: AccountUser): boolean => isAdminUser(u) || registeredAccountCount(u) < maxAcc(u.plan); // 276

// Plan-capped slot array: parsed accounts (capped to limit) padded with "" to `limit`
// length so the editor renders a fixed number of boxes. Verbatim App.tsx:261.
export const accountSlots = (value: string, limit: number): string[] => {
  const slots = (value || "").split(/[,\n]/).map((v) => v.trim()).filter(Boolean).slice(0, limit);
  while (slots.length < limit) slots.push("");
  return slots;
};

// Preserve already-saved (locked) accounts: at each slot index the ORIGINAL value
// wins over the edited one — a seller can't overwrite a server-known account.
// Verbatim App.tsx:263.
export const keepLockedAccounts = (original: string, next: string, limit: number): string =>
  accountText(accountSlots(next, limit).map((value, index) => accountSlots(original, limit)[index] || value));

// Enforce the COMBINED tiktok+facebook cap: keep all already-saved accounts first,
// then fill from the edited lists until the plan limit is hit. Verbatim App.tsx:264-273.
export const fitProfileAccounts = <P extends { tiktok: string; facebook: string }>(original: P, next: P, limit: number): P => {
  const lockedTikTok = accountList(original.tiktok);
  const lockedFacebook = accountList(original.facebook);
  const resultTikTok = [...lockedTikTok];
  const resultFacebook = [...lockedFacebook];
  let remaining = Math.max(0, limit - resultTikTok.length - resultFacebook.length);
  for (const account of accountList(next.tiktok)) if (remaining > 0 && !resultTikTok.includes(account)) { resultTikTok.push(account); remaining--; }
  for (const account of accountList(next.facebook)) if (remaining > 0 && !resultFacebook.includes(account)) { resultFacebook.push(account); remaining--; }
  return { ...next, tiktok: accountText(resultTikTok), facebook: accountText(resultFacebook) };
};

// Compose the account fields to persist when the seller saves the Channels editor.
// Mirrors App.tsx handleSaveProfile (4230-4238): non-admins can't overwrite locked
// (server-known) slots (keepLockedAccounts) and the COMBINED tiktok+facebook list is
// re-capped to the plan (fitProfileAccounts); admins save the edited lists verbatim.
// Pure → unit-tested; the RedesignApp save handler just upserts the result.
export function composeChannelSave<P extends { tiktok: string; facebook: string }>(
  original: P, lists: { tiktok: string; facebook: string }, limit: number, isAdmin: boolean,
): { tiktok: string; facebook: string } {
  if (isAdmin) return { tiktok: lists.tiktok, facebook: lists.facebook };
  const tiktok = keepLockedAccounts(original.tiktok, lists.tiktok, limit);
  const facebook = keepLockedAccounts(original.facebook, lists.facebook, limit);
  const fitted = fitProfileAccounts(original, { tiktok, facebook }, limit);
  return { tiktok: fitted.tiktok, facebook: fitted.facebook };
}

// Toast decision for a chip connect result — success vs honest error (App.tsx parity:
// success "Connected to …!" vs "Connection failed: <reason>"). Passes r.error through
// verbatim (carries the real server/network reason); empty error → the generic fallback.
// Pure → unit-tested; RedesignApp renders the {msg, kind}.
export function connectToast(r: { ok: boolean; error?: string }, okMsg: string, failMsg: string): { msg: string; kind: "ok" | "err" } {
  return r.ok ? { msg: okMsg, kind: "ok" } : { msg: r.error || failMsg, kind: "err" };
}

// Registered accounts for a platform, capped to the plan limit (ConnectModal 3762-3763).
export function registeredAccountsFor(u: AccountUser, platform: Platform): string[] {
  const field = platform === "TikTok" ? u.profile.tiktok : u.profile.facebook;
  return accountList(field).slice(0, maxAcc(u.plan));
}

// Append a newly-connected account to the profile if there's room (connectPlatform
// 4304-4307). Pure — returns the next profile field value or null when unchanged.
export function appendAccount(u: AccountUser, platform: Platform, account: string): AccountUser | null {
  const field = platform === "TikTok" ? "tiktok" : "facebook";
  const existing = accountList(u.profile[field]);
  if (!account || existing.includes(account) || registeredAccountCount(u) >= maxAcc(u.plan)) return null;
  const connected = [...u.connectedAccounts.filter((a) => a !== platform), platform];
  return { ...u, profile: { ...u.profile, [field]: accountText([...existing, account]) }, connectedAccounts: connected };
}

export interface ConnectResult { ok: boolean; error?: string; account: string; notLive?: boolean }

// connectPlatform — verbatim POST from App.tsx:4269-4296 (without the posthog/toast
// side-effects). Returns the cleaned active account on success.
export async function connectPlatform(platform: Platform, data: Record<string, string>, email: string): Promise<ConnectResult> {
  const ep = platform === "TikTok" ? "/connect/tiktok" : "/connect/facebook";
  const meta = { sellerId: sellerIdOf(email), sessionId: browserSessionId() };
  const tiktokUsername = cleanLiveAccount(data.username || "");
  const facebookPage = (data.liveVideoId || data.username || "").trim();
  const account = platform === "TikTok" ? tiktokUsername : facebookPage;
  const body = platform === "TikTok"
    ? { username: tiktokUsername, ...meta }
    : { username: facebookPage, pageName: facebookPage, liveVideoId: facebookPage, accessToken: data.accessToken, ...meta };
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(`${SERVER}${ep}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({} as { success?: boolean; error?: string }));
    if (r.status === 401) return { ok: false, error: j.error || "Unauthorized", account };
    if (r.status === 500) return { ok: false, error: j.error || "Server error", account };
    // 409 = account resolved connect() but is NOT live (Phase 1 is-LIVE gate). Distinct
    // from a server/network error → surfaces a friendly "start your LIVE first" toast,
    // and never marks the account connected (so Fix B won't auto-retry a non-live room).
    if (r.status === 409 && (j as { notLive?: boolean }).notLive) return { ok: false, notLive: true, error: j.error || "Account is not live right now.", account };
    if (!j.success) return { ok: false, error: j.error || r.statusText || `HTTP ${r.status}`, account };
    return { ok: true, account };
  } catch {
    return { ok: false, error: "Can't reach the live server. Check your connection.", account };
  }
}
