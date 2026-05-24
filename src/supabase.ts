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
