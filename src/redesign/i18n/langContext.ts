// Current-language context, split out from index.tsx so the hook lives in a
// component-free module (keeps react-refresh/only-export-components happy — the
// i18n index already mixes a component with helpers; we don't add to that).
// Exposes the NORMALIZED Lang so language-agnostic DATA (an auto-translated
// broadcast's message_i18n map) renders in the seller's own language, reactively
// — a language switch re-renders through this context exactly like useT().
import { createContext, useContext } from "react";
import type { Lang } from "../../translations";

export const LangContext = createContext<Lang>("en");

export function useLang(): Lang {
  return useContext(LangContext);
}
