// Redesign i18n plumbing — Step 2 (PLUMBING ONLY, no screen strings yet).
// REUSES production's translation data (translations.ts) without editing it:
//   • imports TRANSLATIONS / type Lang / type T (import-only; never edit
//     translations.ts / useTranslation.ts / lib)
//   • normalizeLang() shims the redesign picker's lowercase "zh-tw" → "zh-TW"
//   • REDESIGN_STRINGS holds NEW redesign-only keys (filled per-screen during
//     extraction); production keys are reused verbatim, never duplicated here
//   • buildT() merges production keys + the redesign supplement (supplement wins)
//   • TProvider/useT expose the merged `t` via context (no prop-drilling across
//     the ~20 screens)
//
// ⚠️ NEW-KEY RULE (see CLAUDE.md): any new zh-TW / other-language string added to
// REDESIGN_STRINGS during extraction is a DRAFT until a native speaker verifies it.
// Reused production keys carry production's existing (verified-where-done) values;
// zh-TW/th/id fall back to English wherever production hasn't translated yet
// (matches production — not a redesign regression).
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { TRANSLATIONS, type Lang, type T } from "../../translations";

// Merged dictionary: production keys (typed T) + arbitrary new redesign keys.
export type RedesignT = T & Record<string, string>;

// The 7 production languages. The redesign picker uses lowercase "zh-tw".
const VALID_LANGS: Lang[] = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"];

// Map a redesign picker code → a production Lang. "zh-tw" → "zh-TW"; case-insensitive;
// unknown → "en". Pure, unit-tested.
export function normalizeLang(code: string): Lang {
  const c = (code || "").trim().toLowerCase();
  if (c === "zh-tw") return "zh-TW";
  return VALID_LANGS.find((l) => l.toLowerCase() === c) ?? "en";
}

export type RedesignStrings = Record<Lang, Record<string, string>>;

// NEW redesign-only keys, added per-screen during extraction. Starts empty.
// DO NOT put reused production keys here. New zh-TW/other values are DRAFTS pending
// native verification (collected per-screen for Jeff's Taiwan reviewer).
export const REDESIGN_STRINGS: RedesignStrings = {
  en: {}, fil: {}, zh: {}, "zh-TW": {}, vi: {}, th: {}, id: {},
};

// Pure merge — the supplement (new keys) wins over the production base. Exposed for tests.
export function applySupplement(base: T, supp: Record<string, string>): RedesignT {
  return { ...base, ...supp } as RedesignT;
}

// Build the merged dictionary for a redesign language code. `supplement` is
// injectable for tests; defaults to the real REDESIGN_STRINGS.
export function buildT(lang: string, supplement: RedesignStrings = REDESIGN_STRINGS): RedesignT {
  const norm = normalizeLang(lang);
  return applySupplement(TRANSLATIONS[norm], supplement[norm] || {});
}

const TContext = createContext<RedesignT | null>(null);

export function TProvider({ lang, children }: { lang: string; children: ReactNode }) {
  const value = useMemo(() => buildT(lang), [lang]);
  return <TContext.Provider value={value}>{children}</TContext.Provider>;
}

export function useT(): RedesignT {
  const ctx = useContext(TContext);
  if (!ctx) throw new Error("useT must be used within <TProvider>");
  return ctx;
}
