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
import { decodeServerJson } from "../../lib/errCodes.js";
import { tpl, type RedesignT } from "../i18n";

export type Platform = "TikTok" | "Facebook";

// ── Pure helpers (verbatim) — unit-tested ────────────────────────────────────
export const cleanLiveAccount = (value: string): string => String(value || "").trim().replace(/^@+/, "").toLowerCase(); // 159
export const maxAcc = (plan: string): number => (({ free: 1, trial: 1, basic: 1, plus: 2, pro: 3, master: 5 } as Record<string, number>)[plan] ?? 1); // 256
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
// Verbatim App.tsx:263 EXCEPT the optional `unlocked` indices: a slot whose 4-hour
// cooldown has expired (server-verified) accepts the new value instead of the locked
// original. unlocked = [] (default) → byte-identical to the original behavior.
export const keepLockedAccounts = (original: string, next: string, limit: number, unlocked: number[] = []): string =>
  accountText(accountSlots(next, limit).map((value, index) =>
    unlocked.includes(index) ? value : (accountSlots(original, limit)[index] || value)));

// Blank the given slot indices in a saved list — used to build the "still-locked"
// original for cap accounting so a cooldown-unlocked REPLACEMENT doesn't resurrect the
// old handle or double-count against the plan cap. unlocked = [] → returns the input.
const blankUnlockedSlots = (value: string, limit: number, unlocked: number[]): string =>
  unlocked.length === 0 ? value : accountText(accountSlots(value, limit).map((v, i) => (unlocked.includes(i) ? "" : v)));


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
  // Slot indices the 4-hour cooldown has UNLOCKED (server-verified), per platform.
  // Default {} → byte-identical to the pre-cooldown behavior (all saved slots locked).
  // A still-locked slot (index NOT listed) can never be overwritten here.
  unlocked: { tiktok?: number[]; facebook?: number[] } = {},
): { tiktok: string; facebook: string } {
  if (isAdmin) return { tiktok: lists.tiktok, facebook: lists.facebook };
  const ttU = unlocked.tiktok ?? [];
  const fbU = unlocked.facebook ?? [];
  // Account total, Build 2: a seller with MORE saved names than the plan (e.g. after a
  // downgrade) must never lose the ones beyond the plan size on save. Slot handling and
  // the combined cap widen to what is already saved; within the plan (saved ≤ limit) both
  // equal `limit` → byte-identical to before.
  const ttCap = Math.max(limit, accountList(original.tiktok).length);
  const fbCap = Math.max(limit, accountList(original.facebook).length);
  const totalCap = Math.max(limit, accountList(original.tiktok).length + accountList(original.facebook).length);
  const tiktok = keepLockedAccounts(original.tiktok, lists.tiktok, ttCap, ttU);
  const facebook = keepLockedAccounts(original.facebook, lists.facebook, fbCap, fbU);
  // For the COMBINED-cap step, the "locked-first" originals must DROP the unlocked
  // slots' old values (they are being replaced) so a replacement neither resurrects the
  // old handle nor counts twice against the cap. Still-locked slots stay in the original
  // → preserved-first → protected.
  const capOriginal = { ...original, tiktok: blankUnlockedSlots(original.tiktok, ttCap, ttU), facebook: blankUnlockedSlots(original.facebook, fbCap, fbU) };
  const fitted = fitProfileAccounts(capOriginal, { tiktok, facebook }, totalCap);
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

// unreachable = the fetch itself threw (client network failure, no server reason) —
// the app shows a localized "can't reach the live server" toast for this case
// (F-batch i18n; the English error string stays as the analytics/log reason).
export interface ConnectResult { ok: boolean; error?: string; account: string; notLive?: boolean; unreachable?: boolean }

// Build 10b: minutes to wait from the cooldown answer (E41 "…in {n} minutes." / E42 "…in about
// {n} minute(s)|hour(s)." — the app decodes both back to those sentences), else null.
export function cooldownMinutes(error: string | undefined): number | null {
  const s = String(error || "");
  const a = /Try again in (\d+) minutes\.$/.exec(s);
  if (a) return Number(a[1]);
  const b = /Try again in about (\d+) (minute|hour)\(s\)\.$/.exec(s);
  if (b) return Number(b[1]) * (b[2] === "hour" ? 60 : 1);
  return null;
}

// The text a failed TikTok/Facebook connect shows (toast + Connect modal). Build 10: never the
// server's own words or a code — not live / can't reach / wait N minutes keep their texts,
// anything else is the generic "Couldn't connect. Try again."
export function connectFailText(r: Pick<ConnectResult, "notLive" | "unreachable" | "error">, t: RedesignT): string {
  if (r.notLive) return t.rd_cm_not_live;
  if (r.unreachable) return t.rd_cm_cant_reach;
  if ((r.error || "").includes("plan_expired")) return t.rd_cm_plan_ended;
  const mins = cooldownMinutes(r.error);
  if (mins !== null) return tpl(t.rd_cm_tt_cooldown, { n: mins });
  return t.rd_cm_conn_try_again;
}

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
    const j = decodeServerJson(await r.json().catch(() => ({} as { success?: boolean; error?: string })));
    if (r.status === 401) return { ok: false, error: j.error || "Unauthorized", account };
    if (r.status === 500) return { ok: false, error: j.error || "Server error", account };
    // 409 = account resolved connect() but is NOT live (Phase 1 is-LIVE gate). Distinct
    // from a server/network error → surfaces a friendly "start your LIVE first" toast,
    // and never marks the account connected (so Fix B won't auto-retry a non-live room).
    if (r.status === 409 && (j as { notLive?: boolean }).notLive) return { ok: false, notLive: true, error: j.error || "Account is not live right now.", account };
    if (!j.success) return { ok: false, error: j.error || r.statusText || `HTTP ${r.status}`, account };
    return { ok: true, account };
  } catch {
    return { ok: false, error: "Can't connect right now. Check your internet and try again.", account, unreachable: true };
  }
}

// fb_connect_v2 — a CONFIRMED platform switch stops the caller's own TikTok live on the server
// (POST /disconnect/tiktok). Best-effort: 3 s timeout, never throws; false = not confirmed.
export async function ttDisconnect(username: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), 3000) : null;
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetchImpl(`${SERVER}/disconnect/tiktok`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ username: cleanLiveAccount(username) }),
      ...(ac ? { signal: ac.signal } : {}),
    });
    const j = decodeServerJson(await r.json().catch(() => null)) as { ok?: unknown } | null;
    return r.ok && !!j && j.ok === true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
