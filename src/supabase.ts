import { createClient } from "@supabase/supabase-js";

const cleanEnv = (value: string | undefined) => (value || "").trim().replace(/^["']|["']$/g, "");

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey =
  cleanEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);

const supabaseKeySource = cleanEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  ? "publishable"
  : cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)
    ? "anon"
    : "missing";

export const supabaseConfigHint = `${supabaseKeySource}:${supabaseAnonKey ? `...${supabaseAnonKey.slice(-4)}` : "none"}`;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "sf_supabase_auth",
      },
    })
  : null;

// Parcel-checker extension (owner-only) hook: supabase-js STOPS its auto-refresh
// ticker while the tab is hidden, so a backgrounded SFL worker tab lets the token
// expire (~1h) and never renews it. This lets the extension's MAIN-world helper
// ask THIS one client (not a second one — a second refresher rotates the shared
// refresh_token and signs the user out) to refresh the session in place, so the
// worker gets a fresh token WITHOUT reloading the tab. It only refreshes; it
// never returns the token to the page (same-origin scripts already see the
// session in localStorage, so this adds no new capability). Returns whether a
// session exists (false = actually logged out).
if (supabase && typeof window !== "undefined") {
  (window as unknown as { __sflEnsureFreshSession?: () => Promise<boolean> }).__sflEnsureFreshSession = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (!s) return false;
      // refresh when within 2 min of expiry; the client serializes refreshes under
      // an internal lock, so this can't race the (paused) auto-refresh ticker.
      if (typeof s.expires_at === "number" && s.expires_at * 1000 < Date.now() + 120_000) {
        await supabase.auth.refreshSession();
      }
      return true;
    } catch {
      return false;
    }
  };
}
