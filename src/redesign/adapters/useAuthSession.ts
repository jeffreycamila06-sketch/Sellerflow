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
import { getMyProfile, type AccountUser } from "../../accountDb";
import { initials as deriveInitials } from "../data";

export type AuthStatus = "loading" | "authed" | "anon";

export interface UseAuthSession {
  status: AuthStatus;
  profile: AccountUser | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const AUTH_STORAGE_KEY = "sf_supabase_auth"; // mirror of supabase.ts storageKey

export function useAuthSession(): UseAuthSession {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "anon");
  const [profile, setProfile] = useState<AccountUser | null>(null);
  const activeRef = useRef(true);

  // Resolve a session's user id to a real profile (or anon).
  const loadProfile = useCallback(async (userId: string | null | undefined) => {
    if (!userId) {
      if (activeRef.current) { setProfile(null); setStatus("anon"); }
      return;
    }
    const p = await getMyProfile(userId);
    if (!activeRef.current) return;
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
      if (!session?.user) { setProfile(null); setStatus("anon"); return; }
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

  const signOut = useCallback(async () => {
    if (!supabase) { setProfile(null); setStatus("anon"); return; }
    await supabase.auth.signOut();
    // onAuthStateChange will fire SIGNED_OUT, but set immediately for snappy UI.
    setProfile(null);
    setStatus("anon");
  }, []);

  return { status, profile, configured: isSupabaseConfigured, signIn, signOut };
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
  free: "Free", trial: "Trial", basic: "Basic", pro: "Pro", master: "Master",
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
