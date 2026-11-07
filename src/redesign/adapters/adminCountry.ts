// ADMIN-ONLY country label per user (flag + name in the Admin lists).
//
// Which country is shown, in this order (resolveUserCountry):
//   1. the admin's own pick  — table public.admin_user_country (sql/143), admin-only RLS
//   2. the saved signup country — seller_profiles.country
//   3. a guess from the phone shape — display only, NEVER written anywhere
//   4. unknown → the "Hindi alam" pill
//
// ⚠️ seller_profiles.country decides the seller's MARKET (market.ts: currency, TW-only
// tools). The admin pick NEVER touches it — it lives in its own table, which nothing on
// the seller side reads. Nothing here writes seller_profiles.
import { useCallback, useEffect, useState } from "react";
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";
import { isSupabaseConfigured, supabase } from "../../supabase";

export type CountrySource = "admin" | "saved" | "phone" | "unknown";
export interface ResolvedCountry { iso: string | null; source: CountrySource }

// "tw" / " TW " → "TW"; anything that is not two letters → null.
export function normIso(v: string | null | undefined): string | null {
  const c = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

// Countries sharing one calling code ("+1" = US, CA, …) → no single answer unless the
// full number says which (libphonenumber does that for valid numbers).
function soleCountryForCode(code: string): string | null {
  const hits = getCountries().filter((c) => { try { return getCountryCallingCode(c) === code; } catch { return false; } });
  return hits.length === 1 ? hits[0] : null;
}

// Guess from the phone SHAPE (display only):
//   • starts with "+"        → the country of that calling code
//   • digits only, "09"+8    → Taiwan (10 digits)
//   • digits only, "09"+9    → Philippines (11 digits)
//   • anything else          → null (unknown)
// "Digits only" = the number typed without "+"; spaces/dashes are ignored.
export function guessCountryFromPhone(phone: string | null | undefined): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.startsWith("+")) {
    try {
      const p = parsePhoneNumberFromString("+" + digits);
      if (p?.country) return p.country;
      if (p?.countryCallingCode) return soleCountryForCode(p.countryCallingCode);
    } catch { /* junk → unknown */ }
    return null;
  }
  if (/[^\d\s\-().]/.test(raw)) return null; // letters or other symbols → not a phone shape
  if (digits.startsWith("09") && digits.length === 10) return "TW";
  if (digits.startsWith("09") && digits.length === 11) return "PH";
  return null;
}

export function resolveUserCountry(o: { adminPick?: string | null; saved?: string | null; phone?: string | null }): ResolvedCountry {
  const pick = normIso(o.adminPick);
  if (pick) return { iso: pick, source: "admin" };
  const saved = normIso(o.saved);
  if (saved) return { iso: saved, source: "saved" };
  const guess = normIso(guessCountryFromPhone(o.phone));
  if (guess) return { iso: guess, source: "phone" };
  return { iso: null, source: "unknown" };
}

// English country name (admin-only screen). Falls back to the code.
let displayNames: Intl.DisplayNames | null | undefined;
export function countryName(iso: string): string {
  if (displayNames === undefined) {
    try { displayNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch { displayNames = null; }
  }
  try { return displayNames?.of(iso) || iso; } catch { return iso; }
}

export interface AdminCountryOption { iso: string; name: string }
// Quick buttons in the picker ("Madalas").
export const FREQUENT_COUNTRIES = ["TW", "PH", "US"] as const;

let allCountriesCache: AdminCountryOption[] | null = null;
export function allCountryOptions(): AdminCountryOption[] {
  if (!allCountriesCache) {
    allCountriesCache = (getCountries() as CountryCode[])
      .map((iso) => ({ iso: iso as string, name: countryName(iso) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return allCountriesCache;
}

// Picker search: name contains, or exact code ("ca", "us"). Names that START with the
// query come first ("Can" → Canada before … "Vatican"-style matches).
export function searchCountries(list: AdminCountryOption[], query: string): AdminCountryOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const hits = list.filter((c) => c.name.toLowerCase().includes(q) || c.iso.toLowerCase() === q);
  const starts = (c: AdminCountryOption) => (c.iso.toLowerCase() === q || c.name.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.slice().sort((a, b) => starts(a) - starts(b));
}

// ── DB (admin only; RLS on the table does the real gate) ────────────────────────
export async function loadAdminCountries(): Promise<{ ok: boolean; map: Record<string, string> }> {
  if (!isSupabaseConfigured) return { ok: false, map: {} };
  try {
    const { data, error } = await supabase.from("admin_user_country").select("user_id, country");
    if (error) return { ok: false, map: {} };
    const map: Record<string, string> = {};
    for (const r of (data || []) as { user_id?: unknown; country?: unknown }[]) {
      const id = typeof r.user_id === "string" ? r.user_id : "";
      const c = normIso(typeof r.country === "string" ? r.country : null);
      if (id && c) map[id] = c;
    }
    return { ok: true, map };
  } catch { return { ok: false, map: {} }; }
}

// iso = null → clear (back to automatic).
export async function saveAdminCountry(userId: string, iso: string | null): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured || !userId) return { ok: false };
  try {
    const c = normIso(iso);
    const { error } = c
      ? await supabase.from("admin_user_country").upsert({ user_id: userId, country: c, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      : await supabase.from("admin_user_country").delete().eq("user_id", userId);
    return { ok: !error };
  } catch { return { ok: false }; }
}

// One read when the admin panel opens (zero poll). save() updates the map in place so
// the list changes without a reload.
export function useAdminCountries(enabled: boolean): { picks: Record<string, string>; save: (userId: string, iso: string | null) => Promise<{ ok: boolean }> } {
  const [picks, setPicks] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadAdminCountries().then((r) => { if (alive && r.ok) setPicks(r.map); });
    return () => { alive = false; };
  }, [enabled]);
  const save = useCallback(async (userId: string, iso: string | null) => {
    const r = await saveAdminCountry(userId, iso);
    if (r.ok) {
      const c = normIso(iso);
      setPicks((m) => { const n = { ...m }; if (c) n[userId] = c; else delete n[userId]; return n; });
    }
    return r;
  }, []);
  return { picks, save };
}
