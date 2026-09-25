// Current-language context, split out from index.tsx so the hook lives in a
// component-free module (keeps react-refresh/only-export-components happy — the
// i18n index already mixes a component with helpers; we don't add to that).
// Exposes the NORMALIZED Lang so language-agnostic DATA (an auto-translated
// broadcast's message_i18n map) renders in the seller's own language, reactively
// — a language switch re-renders through this context exactly like useT().
import { createContext, useContext } from "react";
import type { Lang } from "../../translations";

// The redesign's language set = production's 7 + redesign-only additions ("bg",
// 2026-09-26 — Bulgarian seller). translations.ts stays untouched ("import
// only"): a redesign-only lang has NO production-base strings, so buildT falls
// back to English for the 4 production keys the redesign still uses.
export type RedesignLang = Lang | "bg";

export const LangContext = createContext<RedesignLang>("en");

export function useLang(): RedesignLang {
  return useContext(LangContext);
}
