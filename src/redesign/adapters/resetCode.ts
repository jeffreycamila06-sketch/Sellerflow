// Self-service password reset with a 6-digit email code (Forgot password? modal).
//
// ON only when app_settings reset_code_enabled = 'true' (read before login through the
// public boolean function reset_code_enabled(), sql/114), or in an owner-preview tab
// opened with ?reset_preview=1. Anything unreadable → OFF (today's Telegram modal).
//
// verifyOtp(type 'recovery') creates a real session. It exists ONLY to save the new
// password: while a reset is in flight (RESET_INFLIGHT_KEY, shared by all tabs) the auth
// hook ignores it, and it is always signed out afterwards (global after a save, local on
// close / back / a reload mid-flow). Nothing here logs or stores the email, code or password.
import { isSupabaseConfigured, supabase } from "../../supabase";

export const RESET_CODE_LEN = 6;
export const RESET_RESEND_SECONDS = 60;   // Supabase's per-user email limit
export const RESET_MAX_WRONG = 5;         // wrong codes in one modal → only "Send a new code"
export const RESET_MIN_DELAY_MS = 800;    // same answer time whether the account exists or not
const PREVIEW_KEY = "sfl_rd_reset_preview";
const RESET_INFLIGHT_KEY = "sfl_rd_reset_inflight";
const INFLIGHT_MAX_MS = 30 * 60 * 1000;   // a stale marker never blocks a normal login for long

// Owner preview: ?reset_preview=1 once → kept for this tab only.
export function readResetPreview(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("reset_preview") === "1") sessionStorage.setItem(PREVIEW_KEY, "1");
    return sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch { return false; }
}

export async function loadResetCodeEnabled(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { data, error } = await supabase.rpc("reset_code_enabled");
    return !error && data === true;
  } catch { return false; }
}

// ── in-flight marker (holds a timestamp only) ──
export function resetInFlight(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(RESET_INFLIGHT_KEY));
    return Number.isFinite(at) && at > 0 && now - at < INFLIGHT_MAX_MS;
  } catch { return false; }
}
export function beginResetSession(): void {
  try { localStorage.setItem(RESET_INFLIGHT_KEY, String(Date.now())); } catch { /* the hook then just sees a session */ }
}
export function endResetSession(): void {
  try { localStorage.removeItem(RESET_INFLIGHT_KEY); } catch { /* nothing to clear */ }
}

// Paste-friendly: digits only, at most 6.
export const cleanCode = (v: string): string => String(v || "").replace(/\D+/g, "").slice(0, RESET_CODE_LEN);

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isTooMany = (e: unknown): boolean => {
  const x = e as { status?: number; code?: string } | null;
  return !!x && (x.status === 429 || /rate_limit/i.test(String(x.code || "")));
};

// Step 1 — "sent" is the same answer for a real account, an unknown email and any error;
// only "too many requests" is different. Never a redirect link (the email shows the code).
export async function sendResetCode(email: string): Promise<"sent" | "wait"> {
  const minDelay = wait(RESET_MIN_DELAY_MS);
  let tooMany = false;
  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
      tooMany = isTooMany(error);
    } catch { /* same neutral answer */ }
  }
  await minDelay;
  return tooMany ? "wait" : "sent";
}

// Step 2 — single-use code → a reset-only session (marker set BEFORE the call, so the
// auth hook ignores the PASSWORD_RECOVERY / SIGNED_IN event it fires).
export async function verifyResetCode(email: string, code: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  beginResetSession();
  try {
    const { data, error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "recovery" });
    if (!error && data && data.session) return true;
  } catch { /* wrong / expired / network */ }
  endResetSession();
  return false;
}

// Step 3 — save, then sign out EVERY session (no auto-login).
export async function saveNewPassword(password: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return false;
  } catch { return false; }
  try {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) await supabase.auth.signOut({ scope: "local" });
  } catch {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* the marker below still keeps the app logged out */ }
  }
  endResetSession();
  return true;
}

// Closed / back before saving → drop the reset-only session on this device.
export async function abandonReset(): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* best effort */ }
  }
  endResetSession();
}
