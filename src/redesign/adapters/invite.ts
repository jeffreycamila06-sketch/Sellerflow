// Invite friends — invite CODES + the referral reward (sql/164). Every call the app makes for it
// lives here. CODE ONLY: no link catching, no ?ref= in any URL.
//   • check / choose / claim a code (seller)
//   • my_referral_summary (the Invite friends screen, one call per open — zero poll)
//   • admin: overview, history, revoke, change a code, reward months
// Every function answers instead of throwing: a failure is null / { ok:false } so a sign-up or a
// screen never breaks because of an invite call.
import { isSupabaseConfigured, supabase } from "../../supabase";

export const INVITE_CODE_RE = /^[A-Z0-9]{4,12}$/;
export const INVITE_CODE_MAX = 12;
// The random-code alphabet: uppercase letters + digits without 0 / O / 1 / I (same as the database).
export const RANDOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// What the seller typed → the stored form. NFKC first (full-width letters / digits from a Chinese
// keyboard → plain ASCII, same as the database's referral_norm_code), then UPPERCASE, no spaces at
// the ends.
const nfkc = (raw: string): string => { const v = String(raw ?? ""); try { return v.normalize("NFKC"); } catch { return v; } };
export const normInviteCode = (raw: string): string => nfkc(raw).trim().toUpperCase();
export const inviteCodeFormatOk = (raw: string): boolean => INVITE_CODE_RE.test(normInviteCode(raw));
// Typing filter for the code boxes: letters and numbers only, uppercase, max 12.
export const typedInviteCode = (raw: string): string => nfkc(raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, INVITE_CODE_MAX);

// 6 characters, client-side (the database checks it again on save).
export function randomInviteCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += RANDOM_ALPHABET[Math.floor(rand() * RANDOM_ALPHABET.length) % RANDOM_ALPHABET.length];
  return s;
}

// The share message. `template` = the translated rd_ref_share_text ("… {code}"); English by default.
export const SHARE_TEXT_EN = "Use my SellerFlowLive invite code: {code}";
export const shareTextFor = (code: string, template: string = SHARE_TEXT_EN): string =>
  (template && template.includes("{code}") ? template : SHARE_TEXT_EN).split("{code}").join(code);

const client = () => (isSupabaseConfigured && supabase ? supabase : null);

// Sign-up "Code found / Not found". true/false, or null when the check itself failed.
export async function checkInviteCode(code: string): Promise<boolean | null> {
  const c = normInviteCode(code);
  if (!INVITE_CODE_RE.test(c)) return false;
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("check_invite_code", { p_code: c });
    if (error) return null;
    return data === true;
  } catch { return null; }
}

export type CodeProblem = "" | "format" | "reserved" | "taken";
// Choose-code live check. null = the check failed (the save still checks again).
export async function inviteCodeAvailable(code: string): Promise<CodeProblem | null> {
  const c = normInviteCode(code);
  if (!INVITE_CODE_RE.test(c)) return "format";
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("invite_code_available", { p_code: c });
    if (error || typeof data !== "string") return null;
    return (["", "format", "reserved", "taken"] as string[]).includes(data) ? (data as CodeProblem) : null;
  } catch { return null; }
}

export interface RpcAnswer { ok: boolean; reason?: string; code?: string }
const asAnswer = (data: unknown): RpcAnswer => {
  const x = (data || {}) as Record<string, unknown>;
  return { ok: x.ok === true, reason: typeof x.reason === "string" ? x.reason : undefined, code: typeof x.code === "string" ? x.code : undefined };
};

// Save MY code once. code null = a random code from the database.
export async function setMyInviteCode(code: string | null): Promise<RpcAnswer> {
  const sb = client(); if (!sb) return { ok: false, reason: "offline" };
  try {
    const { data, error } = await sb.rpc("set_my_invite_code", { p_code: code == null ? null : normInviteCode(code) });
    if (error) return { ok: false, reason: "error" };
    return asAnswer(data);
  } catch { return { ok: false, reason: "error" }; }
}

export type ClaimSource = "signup" | "settings";
export async function claimReferral(code: string, source: ClaimSource): Promise<RpcAnswer> {
  const c = normInviteCode(code);
  if (!c) return { ok: false, reason: "not_found" };
  const sb = client(); if (!sb) return { ok: false, reason: "offline" };
  try {
    const { data, error } = await sb.rpc("claim_referral", { p_code: c, p_source: source });
    if (error) return { ok: false, reason: "error" };
    return asAnswer(data);
  } catch { return { ok: false, reason: "error" }; }
}

// ── sign-up code kept for the rest of THIS sign-up only (sessionStorage) ─────────────────────
// Used when the claim could not run at sign-up (no session yet, no profile yet, network, too slow):
// saved as {code, email} and claimed the first time THIS tab is signed in with THAT email. Another
// account signing in on the tab drops it. Nothing goes in a URL.
export const PENDING_INVITE_KEY = "sfl_rd_pending_invite";
const normEmail = (e: string | null | undefined): string => String(e ?? "").trim().toLowerCase();
export function savePendingInvite(code: string, email: string): void {
  const c = normInviteCode(code);
  const e = normEmail(email);
  if (!INVITE_CODE_RE.test(c) || !e) return;
  try { sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ code: c, email: e })); } catch { /* private mode: nothing kept */ }
}
// The code, only when it was saved for `email`; read once (always removed).
export function takePendingInvite(email: string | null | undefined): string {
  try {
    const raw = sessionStorage.getItem(PENDING_INVITE_KEY);
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    if (!raw) return "";
    const x = JSON.parse(raw) as { code?: unknown; email?: unknown };
    const c = typeof x.code === "string" ? x.code : "";
    const e = typeof x.email === "string" ? x.email : "";
    return INVITE_CODE_RE.test(c) && e && e === normEmail(email) ? c : "";
  } catch { return ""; }
}

// The sign-up claim never waits longer than this ("Creating account…" can never hang on it).
export const SIGNUP_CLAIM_TIMEOUT_MS = 4000;

// The sign-up claim: never throws, never blocks longer than SIGNUP_CLAIM_TIMEOUT_MS. Returns what
// happened (for tests / logs only).
export async function claimSignupCode(code: string | undefined, email: string, timeoutMs = SIGNUP_CLAIM_TIMEOUT_MS): Promise<"none" | "claimed" | "kept" | "refused"> {
  const c = normInviteCode(code || "");
  if (!INVITE_CODE_RE.test(c)) return "none";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((res) => { timer = setTimeout(() => res("timeout"), timeoutMs); });
  const r = await Promise.race([claimReferral(c, "signup"), late]).finally(() => { if (timer) clearTimeout(timer); });
  if (r === "timeout") { savePendingInvite(c, email); return "kept"; }
  if (r.ok) return "claimed";
  // No session / no profile yet / network → keep it for the first sign-in of this tab.
  if (r.reason === "not_signed_in" || r.reason === "no_profile" || r.reason === "offline" || r.reason === "error") {
    savePendingInvite(c, email);
    return "kept";
  }
  return "refused";
}

// ── the Invite friends screen ───────────────────────────────────────────────────────────────
export type InviteStatus = "linked" | "rewarded" | "no_reward" | "revoked";
export interface InviteRow { email: string; status: InviteStatus; days: number; date: string }
export interface ReferralSummary {
  code: string | null;
  monthDays: number;
  eligible: boolean;
  hasInviter: boolean;
  canEnterCode: boolean;
  invites: InviteRow[];
}
const STATUSES: InviteStatus[] = ["linked", "rewarded", "no_reward", "revoked"];
export function parseSummary(raw: unknown): ReferralSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const invites = Array.isArray(x.invites) ? (x.invites as unknown[]).flatMap((r) => {
    const y = (r || {}) as Record<string, unknown>;
    if (!STATUSES.includes(y.status as InviteStatus)) return [];
    return [{ email: String(y.email ?? ""), status: y.status as InviteStatus, days: Number(y.days) || 0, date: String(y.date ?? "") }];
  }) : [];
  return {
    code: typeof x.code === "string" && x.code ? x.code : null,
    monthDays: Math.max(0, Number(x.month_days) || 0),
    eligible: x.eligible === true,
    hasInviter: x.has_inviter === true,
    canEnterCode: x.can_enter_code === true,
    invites,
  };
}
export async function loadReferralSummary(): Promise<ReferralSummary | null> {
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("my_referral_summary");
    if (error) return null;
    return parseSummary(data);
  } catch { return null; }
}

// ── admin ───────────────────────────────────────────────────────────────────────────────────
export type PreviewReason = "" | "already_done" | "not_first_plan" | "inviter_gone" | "month_off" | "inviter_not_paid";
export interface ReferralPreview {
  code: string | null;
  linked: boolean;
  status?: InviteStatus;
  inviterEmail?: string;
  inviterPlan?: string;
  rewardDays?: number;
  wouldReward?: boolean;
  days?: number;
  reason?: PreviewReason;
}
export function parsePreview(raw: unknown): ReferralPreview | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const p: ReferralPreview = { code: typeof x.code === "string" && x.code ? x.code : null, linked: x.linked === true };
  if (!p.linked) return p;
  return {
    ...p,
    status: STATUSES.includes(x.status as InviteStatus) ? (x.status as InviteStatus) : "linked",
    inviterEmail: typeof x.inviter_email === "string" ? x.inviter_email : "",
    inviterPlan: typeof x.inviter_plan === "string" ? x.inviter_plan : "",
    rewardDays: Number(x.reward_days) || 0,
    wouldReward: x.would_reward === true,
    days: Number(x.days) || 0,
    reason: (typeof x.reason === "string" ? x.reason : "") as PreviewReason,
  };
}
// Manage sellers: one call per panel open → { userId: preview }.
export async function loadReferralOverview(): Promise<Record<string, ReferralPreview> | null> {
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("admin_referral_overview");
    if (error || !data || typeof data !== "object") return null;
    const out: Record<string, ReferralPreview> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) { const p = parsePreview(v); if (p) out[k] = p; }
    return out;
  } catch { return null; }
}

export interface HistoryRow {
  id: string; inviterExpiry: string | null;
  inviteeUserId: string | null; inviteeEmail: string; inviterUserId: string | null; inviterEmail: string; inviterCode: string;
  source: string; status: InviteStatus; rewardDays: number; rewardMonth: string | null; rewardedAt: string | null;
  skipReason: string | null; createdAt: string; revokedAt: string | null;
}
export async function loadReferralHistory(search = "", limit = 50, offset = 0): Promise<{ total: number; rows: HistoryRow[] } | null> {
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("admin_referrals_list", { p_limit: limit, p_offset: offset, p_search: search.trim() || null });
    if (error || !data || typeof data !== "object") return null;
    const x = data as Record<string, unknown>;
    const rows = Array.isArray(x.rows) ? (x.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id ?? ""), inviterExpiry: typeof r.inviter_expiry === "string" ? r.inviter_expiry : null,
      inviteeUserId: typeof r.invitee_user_id === "string" ? r.invitee_user_id : null, inviteeEmail: String(r.invitee_email ?? ""),
      inviterUserId: typeof r.inviter_user_id === "string" ? r.inviter_user_id : null, inviterEmail: String(r.inviter_email ?? ""),
      inviterCode: String(r.inviter_code ?? ""), source: String(r.source ?? ""),
      status: (STATUSES.includes(r.status as InviteStatus) ? r.status : "linked") as InviteStatus,
      rewardDays: Number(r.reward_days) || 0, rewardMonth: typeof r.reward_month === "string" ? r.reward_month : null,
      rewardedAt: typeof r.rewarded_at === "string" ? r.rewarded_at : null, skipReason: typeof r.skip_reason === "string" ? r.skip_reason : null,
      createdAt: String(r.created_at ?? ""), revokedAt: typeof r.revoked_at === "string" ? r.revoked_at : null,
    })) : [];
    return { total: Number(x.total) || 0, rows };
  } catch { return null; }
}

// By the referral row's id (works when the friend's account was deleted).
export async function adminRevokeReferral(referralId: string): Promise<RpcAnswer & { daysRemoved?: number }> {
  const sb = client(); if (!sb) return { ok: false, reason: "offline" };
  try {
    const { data, error } = await sb.rpc("admin_referral_revoke", { p_referral: referralId });
    if (error) return { ok: false, reason: "error" };
    const a = asAnswer(data);
    return { ...a, daysRemoved: Number((data as Record<string, unknown>)?.days_removed) || 0 };
  } catch { return { ok: false, reason: "error" }; }
}

export async function adminSetInviteCode(userId: string, code: string): Promise<RpcAnswer> {
  const sb = client(); if (!sb) return { ok: false, reason: "offline" };
  try {
    const { data, error } = await sb.rpc("admin_set_invite_code", { p_user: userId, p_code: normInviteCode(code) });
    if (error) return { ok: false, reason: "error" };
    return asAnswer(data);
  } catch { return { ok: false, reason: "error" }; }
}

export interface RewardMonth { month: string; days: number | null; isNow: boolean }
export async function loadRewardMonths(): Promise<RewardMonth[] | null> {
  const sb = client(); if (!sb) return null;
  try {
    const { data, error } = await sb.rpc("admin_invite_reward_months_get");
    if (error || !Array.isArray(data)) return null;
    return (data as Record<string, unknown>[]).map((m) => ({
      month: String(m.month ?? ""), days: m.days == null ? null : Number(m.days) || 0, isNow: m.is_now === true,
    }));
  } catch { return null; }
}
export async function saveRewardMonth(month: string, days: number | null): Promise<RpcAnswer> {
  const sb = client(); if (!sb) return { ok: false, reason: "offline" };
  try {
    const { data, error } = await sb.rpc("admin_invite_reward_months_set", { p_month: month, p_days: days ?? 0 });
    if (error) return { ok: false, reason: "error" };
    return asAnswer(data);
  } catch { return { ok: false, reason: "error" }; }
}

// Admin seller card: the line above the plan buttons — what a paid plan would give the inviter.
const cap = (s: string | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
export function referralLine(t: Record<string, string>, p: ReferralPreview | undefined): { text: string; tone: "ok" | "muted" } | null {
  if (!p || !p.linked) return null;
  const email = p.inviterEmail || "—";
  const plan = cap(p.inviterPlan);
  if (p.status !== "linked") {
    const st = p.status === "rewarded" ? fill(t.rd_ref_st_days, { n: p.rewardDays ?? 0 })
      : p.status === "revoked" ? t.rd_ref_st_revoked : t.rd_ref_st_noreward;
    return { text: fill(t.rd_adm_ref_line_done, { email, status: st }), tone: "muted" };
  }
  if (p.wouldReward) return { text: fill(t.rd_adm_ref_line_yes, { email, plan, n: p.days ?? 0 }), tone: "ok" };
  const why = p.reason === "month_off" ? t.rd_adm_ref_r_month_off
    : p.reason === "inviter_not_paid" ? t.rd_adm_ref_r_inviter_not_paid
    : p.reason === "not_first_plan" ? t.rd_adm_ref_r_not_first
    : t.rd_adm_ref_r_gone;
  return { text: fill(t.rd_adm_ref_line_no, { email, plan, why }), tone: "muted" };
}


// Revoke is offered only on a row that really gave days.
export const canRevoke = (r: Pick<HistoryRow, "status" | "rewardDays">): boolean => r.status === "rewarded" && r.rewardDays > 0;
// The inviter's expiry after taking back `days` (null when there is no current expiry).
export function expiryAfterRevoke(currentIso: string | null, days: number): string | null {
  if (!currentIso) return null;
  const t = new Date(currentIso).getTime();
  return isNaN(t) ? null : new Date(t - days * 86_400_000).toISOString();
}
// Invite rewards days box: whole number 0–365 ("" = Off).
export const REWARD_DAYS_MAX = 365;
export const rewardDaysValid = (typed: string): boolean => typed === "" || (/^\d+$/.test(typed) && Number(typed) <= REWARD_DAYS_MAX);
