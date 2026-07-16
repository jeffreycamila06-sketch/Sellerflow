// SINGLE-SOURCE international phone validation (replaces the Taiwan-only
// validateTaiwanPhone). A country context is REQUIRED because a local number is
// ambiguous — "09…" is a valid Taiwan mobile (10 digits) AND a valid Philippine
// mobile (11 digits); only the picked country disambiguates. Backed by
// libphonenumber-js/min (all 245 countries, ~30KB gz, static import → sync so the
// reactive button-gate + the register() backstop stay synchronous).
//
// STORAGE = clean NATIONAL-local digits (e.g. "0912345678"), NOT E.164 — this
// matches the existing rows' format exactly, so there is ZERO migration and the
// admin phone search (normPhone) keeps working unchanged. Country is used only for
// validation, never stored (same as today).
import { isValidPhoneNumber, parsePhoneNumber, getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";

// Pinned to the top of the picker — the 7 app languages + the countries actually
// seen in the seller base. Taiwan is the DEFAULT (majority of existing sellers).
export const CORE_COUNTRIES: CountryCode[] = ["TW", "PH", "VN", "TH", "ID", "CN", "SG", "MY"];
export const DEFAULT_COUNTRY = "TW";

// PURE validator. Any libphonenumber throw (empty / garbage input) → invalid, never
// crashes. `national` = the clean local-format digits for storage.
export function validatePhone(input: string, country: string): { valid: boolean; national: string } {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!raw || !country) return { valid: false, national: digits };
  try {
    const cc = country as CountryCode;
    if (!isValidPhoneNumber(raw, cc)) return { valid: false, national: digits };
    const parsed = parsePhoneNumber(raw, cc);
    const national = parsed ? parsed.formatNational().replace(/\D/g, "") : digits;
    return { valid: true, national };
  } catch {
    return { valid: false, national: digits };
  }
}

// Flag emoji from an ISO-3166 alpha-2 code (two regional-indicator symbols). No
// data table — computed from the letters.
export function flagOf(iso: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso)) return "";
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export interface CountryOption { iso: string; name: string; dial: string; flag: string }

// Every country, with names LOCALIZED for the app language via Intl.DisplayNames
// (no per-language country-name translation table needed). Core countries pinned
// on top; the rest sorted by localized name. Memoize per lang at the call site.
export function listCountries(lang: string): CountryOption[] {
  let display: Intl.DisplayNames | null = null;
  try { display = new Intl.DisplayNames([lang || "en"], { type: "region" }); }
  catch { try { display = new Intl.DisplayNames(["en"], { type: "region" }); } catch { display = null; } }
  const all = getCountries();
  const opt = (iso: string): CountryOption => {
    let dial: string;
    try { dial = "+" + getCountryCallingCode(iso as CountryCode); } catch { dial = ""; }
    let name: string;
    try { name = display?.of(iso) || iso; } catch { name = iso; }
    return { iso, name, dial, flag: flagOf(iso) };
  };
  const core = CORE_COUNTRIES.filter((c) => all.includes(c)).map(opt);
  const rest = all.filter((c) => !CORE_COUNTRIES.includes(c as CountryCode)).map(opt).sort((a, b) => a.name.localeCompare(b.name));
  return [...core, ...rest];
}

// Case-insensitive filter for the picker search (name / ISO / dial).
export function filterCountries(list: CountryOption[], query: string): CountryOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const qd = q.replace(/[^\d+]/g, "");
  return list.filter((c) => c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q) || (qd.length > 0 && c.dial.includes(qd)));
}
