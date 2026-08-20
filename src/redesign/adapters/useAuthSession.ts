// Phase 5a — AUTH adapter. Wires the redesign preview to REAL Supabase auth by
// COMPOSING the already-exported safe pieces:
//   • the `supabase` singleton from src/supabase.ts (shared session via the
//     localStorage storageKey "sf_supabase_auth" — same client the production
//     app uses), and
//   • getMyProfile() from src/accountDb.ts (RLS-scoped to the signed-in row).
//
// It imports ONLY those exports — it does NOT touch App.tsx / supabase.ts /
// accountDb.ts / db.ts / lib/*. Auth is tangled-zone-6, so we adapter-compose
// here rather than extract/refactor the production auth.
//
// Zone-6 (split-brain) handling: the redesign is a SEPARATE React root from
// production App.tsx, so each root keeps its own user state. To never show stale
// auth we (a) restore the session on mount, (b) subscribe to onAuthStateChange
// for same-tab login/logout/token-refresh, and (c) listen to the cross-tab
// `storage` event on the shared auth key so a logout in the production tab is
// mirrored here.
import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { getMyProfile, createMyProfile, type AccountUser } from "../../accountDb";
import { selfDeleteAccount } from "./adminDelete";
import { validatePhone, DEFAULT_COUNTRY } from "./phone";
import { initials as deriveInitials } from "../data";

export type AuthStatus = "loading" | "authed" | "anon";

export interface RegisterFields { email: string; password: string; confirm: string; fullName: string; storeName: string; phone: string; phoneCountry?: string }
export interface RegisterResult { ok: boolean; error?: string; needsConfirm?: boolean }

export interface UseAuthSession {
  status: AuthStatus;
  profile: AccountUser | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  // Google OAuth sign-in. Starts the provider redirect; the sign-in COMPLETES on
  // return via detectSessionInUrl + onAuthStateChange (same profile-load path as
  // email/password). Returns {ok,error} — ok means the redirect started.
  signInWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>; // 5i — re-fetch own profile after a save
  // Self-serve registration — mirrors App.tsx PublicAuth `reg` (738-758): signUp →
  // (if a session) createMyProfile → loadProfile (auth listener logs the user in).
  register: (f: RegisterFields) => Promise<RegisterResult>;
  // Self-serve delete — Phase 2 FULL WIPE via the admin-delete-user edge function
  // (mode "self"): server-side wipe of auth + all data → signOut → clear local keys.
  deleteAccount: () => Promise<{ ok: boolean; error?: string; code?: string }>;
}

const AUTH_STORAGE_KEY = "sf_supabase_auth"; // mirror of supabase.ts storageKey

export function useAuthSession(): UseAuthSession {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "anon");
  const [profile, setProfile] = useState<AccountUser | null>(null);
  const activeRef = useRef(true);
  // The user id whose profile is currently AUTHED (null until then). Backs the
  // same-user guard below — audit finding #1: supabase fires TOKEN_REFRESHED
  // ~every 50 min, and re-running the loading→authed flip for the SAME user
  // turned `authed` false across the async profile re-fetch, tearing down the
  // LIVE socket mid-live (lost comments in the gap) + re-firing every
  // enabled=authed data hook. Repro + regression: useAuthSession.tokenRefresh.test.
  const authedUserIdRef = useRef<string | null>(null);

  // Resolve a session's user id to a real profile (or anon).
  const loadProfile = useCallback(async (userId: string | null | undefined) => {
    if (!userId) {
      authedUserIdRef.current = null;
      if (activeRef.current) { setProfile(null); setStatus("anon"); }
      return;
    }
    const p = await getMyProfile(userId);
    if (!activeRef.current) return;
    authedUserIdRef.current = userId;
    setProfile(p);
    setStatus("authed");
  }, []);

  useEffect(() => {
    activeRef.current = true;
    if (!isSupabaseConfigured || !supabase) { setStatus("anon"); return; }
    const client = supabase;

    // (a) restore the persisted session on load
    void client.auth.getSession().then(({ data }) => {
      if (!activeRef.current) return;
      void loadProfile(data.session?.user?.id);
    });

    // (b) same-tab auth events
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (!activeRef.current) return;
      if (!session?.user) { authedUserIdRef.current = null; setProfile(null); setStatus("anon"); return; }
      // SAME-USER GUARD (finding #1): TOKEN_REFRESHED / USER_UPDATED for the
      // already-authed user must be a no-op — status stays "authed", so the
      // live socket and every enabled=authed hook keep running untouched.
      // A genuine user change (sign-in after sign-out, different user) still
      // goes through the full loading→loadProfile path below.
      if (session.user.id === authedUserIdRef.current) return;
      setStatus("loading");
      void loadProfile(session.user.id);
    });

    // (c) cross-tab sync (zone-6): production tab login/logout rewrites the
    // shared auth key — re-read the session so we never render stale auth.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_STORAGE_KEY) return;
      void client.auth.getSession().then(({ data }) => {
        if (!activeRef.current) return;
        void loadProfile(data.session?.user?.id);
      });
    };
    window.addEventListener("storage", onStorage);

    return () => {
      activeRef.current = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, error: "Sign-in is unavailable (Supabase not configured)." };
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return { ok: false, error: error.message };
    // onAuthStateChange flips status + loads the profile.
    return { ok: true };
  }, []);

  // Google OAuth — ADDED alongside signIn (email/password path untouched). Supabase
  // links a Google identity to an existing same-email user (verified email), so
  // existing sellers keep their data. redirectTo = the RUNNING origin so it works on
  // both sellerflowlive.com and www.sellerflowlive.com (both in Supabase's redirect
  // allow-list) — never hardcode a domain. On ok the browser redirects to Google;
  // the session lands on return via detectSessionInUrl + onAuthStateChange (which
  // loads the profile — that path is unchanged).
  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, error: "Sign-in is unavailable (Supabase not configured)." };
    }
    const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) { setProfile(null); setStatus("anon"); return; }
    await supabase.auth.signOut();
    // onAuthStateChange will fire SIGNED_OUT, but set immediately for snappy UI.
    setProfile(null);
    setStatus("anon");
  }, []);

  // 5i — refresh the signed-in user's own profile (after a self-edit save).
  const reloadProfile = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session?.user?.id);
  }, [loadProfile]);

  // Self-serve registration — same path as App.tsx PublicAuth `reg` (738-758).
  const register = useCallback(async (f: RegisterFields): Promise<RegisterResult> => {
    const invalid = validateRegistration(f);
    if (invalid) return { ok: false, error: invalid };
    if (!isSupabaseConfigured || !supabase) return { ok: false, error: "Registration is unavailable (service not configured)." };
    const cleanEmail = f.email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password: f.password });
    if (error) return { ok: false, error: mapSignUpError(error.message) };
    if (!data.user) return { ok: false, error: "Registration failed. Please try again." };
    // Email confirmation enabled → no session yet → cannot create the profile row
    // (RLS needs auth.uid()). Same branch as App.tsx (748-752).
    if (!data.session) return { ok: true, needsConfirm: true };
    try {
      await createMyProfile(data.user.id, cleanEmail, {
        // Store the NORMALIZED phone (clean 09xxxxxxxx) — register only reaches
        // here after validateRegistration passed, so it is a valid TW mobile.
        fullName: f.fullName.trim(), storeName: f.storeName.trim(), phone: validatePhone(f.phone, f.phoneCountry || DEFAULT_COUNTRY).national,
        tiktok: "", facebook: "", adminContactNote: "",
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not create your profile." };
    }
    // The auth listener already flipped status→authed (signUp persisted a session);
    // load the profile now so the dashboard renders the real account, not a fallback.
    await loadProfile(data.user.id);
    return { ok: true };
  }, [loadProfile]);

  // Self-serve delete — Phase 2 FULL WIPE via the admin-delete-user edge function
  // (mode "self"). The old client deleteUser() only removed the profile row and,
  // post-Phase-1 (admin-only DELETE policy), would be rejected by RLS. The edge
  // function wipes the auth account + ALL data server-side (admin/master blocked).
  const deleteAccount = useCallback(async (): Promise<{ ok: boolean; error?: string; code?: string }> => {
    const email = profile?.email;
    if (!email) return { ok: false, error: "Not signed in" };
    const r = await selfDeleteAccount();
    // Pass the guard `code` through so the DeleteAccount screen can gate what the
    // seller sees (safe guard messages vs a generic string) — item-5 containment.
    if (!r.ok) return { ok: false, error: r.error, code: r.code };
    // Clear the same local keys production clears (parity; harmless if absent here).
    for (const k of localKeysToClear(email)) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
    try { await supabase?.auth.signOut(); } catch { /* listener still flips to anon */ }
    if (activeRef.current) { setProfile(null); setStatus("anon"); }
    return { ok: true };
  }, [profile]);

  return { status, profile, configured: isSupabaseConfigured, signIn, signInWithGoogle, signOut, reloadProfile, register, deleteAccount };
}

// ── Pure registration helpers (no Supabase / React — unit-tested) ─────────────

// Mirrors App.tsx normalizePhone (254) / phoneDisplay (255).
export const normalizePhone = (value: string): string => String(value || "").replace(/\D/g, "");
export const phoneDisplay = (value: string): string => String(value || "").trim();

// SINGLE-SOURCE registration rule → an error CODE (or ""). Both the English
// backstop (validateRegistration, used by the register() hook) and the
// translated client layer (Signup via REG_ERROR_KEYS) derive from this, so the
// two can never diverge. Phone is validated INTERNATIONALLY via adapters/phone
// (libphonenumber) against the picked country (default TW). All fields required,
// password ≥ 6, password === confirm.
export type RegErrorCode = "" | "fields" | "phone" | "pw_len" | "pw_match";
export function registrationErrorCode(f: RegisterFields): RegErrorCode {
  if (!f.fullName.trim() || !f.storeName.trim() || !f.email.trim() || !f.password) return "fields";
  if (!validatePhone(f.phone, f.phoneCountry || DEFAULT_COUNTRY).valid) return "phone";
  if (f.password.length < 6) return "pw_len";
  if (f.password !== f.confirm) return "pw_match";
  return "";
}

// code → i18n key (translated client-facing errors, filled ×7).
export const REG_ERROR_KEYS: Record<Exclude<RegErrorCode, "">, string> = {
  fields: "rd_su_err_fields", phone: "rd_su_err_phone", pw_len: "rd_su_err_pw_len", pw_match: "rd_su_err_pw_match",
};

// English backstop for the register() hook (no `t` in a hook). Same shape/strings
// as before (parity) EXCEPT phone is now the Taiwan-mobile rule. Only reached if a
// caller bypasses the translated client validation — defense in depth.
const REG_ERROR_EN: Record<Exclude<RegErrorCode, "">, string> = {
  fields: "Please fill in all fields.",
  phone: "Enter a valid phone number.",
  pw_len: "Password must be at least 6 characters.",
  pw_match: "Passwords do not match.",
};
export function validateRegistration(f: RegisterFields): string {
  const code = registrationErrorCode(f);
  return code ? REG_ERROR_EN[code] : "";
}

// Mirrors App.tsx (746): existing-email detection.
export function mapSignUpError(message: string): string {
  return /already|registered|exists/i.test(message) ? "That email is already registered. Try logging in." : "Could not create your account. Please try again.";
}

// The exact localStorage keys App.tsx handleDeleteAccount clears (4213), keyed per
// seller (sellerIdOf = email.trim().toLowerCase()).
export function localKeysToClear(email: string): string[] {
  const id = email.trim().toLowerCase();
  const seller = (base: string) => `${base}:${id}`;
  return [
    "sf_session", "sf_session_user", "sf_comments", "sf_comment_archive", "sf_buyers", "sf_orders",
    seller("sf_comments"), seller("sf_comment_archive"), seller("sf_buyers"), seller("sf_orders"), seller("sf_printed"),
  ];
}

// ── Pure display helpers (no Supabase / React — unit-tested) ──────────────────

export interface ProfileDisplay {
  shopName: string;
  handle: string;
  planLabel: string;
  renewLabel: string; // e.g. "renews Jul 28" ("" when no/invalid expiry)
  planLine: string;   // e.g. "Pro plan · renews Jul 28"
  initials: string;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free", trial: "Trial", basic: "Basic", plus: "Plus", pro: "Pro", master: "Master",
};

export function planLabel(plan: string | undefined | null): string {
  const k = (plan || "").toLowerCase();
  if (PLAN_LABELS[k]) return PLAN_LABELS[k];
  return k ? k[0].toUpperCase() + k.slice(1) : "Free";
}

export function renewLabel(planExpiry: string | undefined | null): string {
  if (!planExpiry) return "";
  const d = new Date(planExpiry);
  if (isNaN(d.getTime())) return "";
  return "renews " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function handleFromProfile(profile: AccountUser | null): string {
  const tt = (profile?.profile.tiktok || "").trim();
  if (!tt) return "";
  return tt.startsWith("@") ? tt : "@" + tt;
}

// Production default currency is NT$ (TWD) — real sellers are Taiwan-based.
export const DEFAULT_CURRENCY = "TWD";

export function profileToDisplay(profile: AccountUser | null): ProfileDisplay | null {
  if (!profile) return null;
  const shopName = profile.profile.storeName || profile.profile.fullName || profile.email;
  const pl = planLabel(profile.plan);
  const rl = renewLabel(profile.planExpiry);
  return {
    shopName,
    handle: handleFromProfile(profile),
    planLabel: pl,
    renewLabel: rl,
    planLine: rl ? `${pl} plan · ${rl}` : `${pl} plan`,
    initials: deriveInitials(shopName),
  };
}
