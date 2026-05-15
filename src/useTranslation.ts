// useTranslation.ts
// Drop this in src/ — import useLang from this file in App.tsx instead

import { useState, useEffect } from "react";
import { TRANSLATIONS, type Lang, type T } from "./translations";

const LISTENERS: Set<() => void> = new Set();
let currentLang: Lang = (localStorage.getItem("sf_lang")?.replace(/"/g, "") as Lang) || "en";

export function setGlobalLang(lang: Lang) {
  currentLang = lang;
  localStorage.setItem("sf_lang", JSON.stringify(lang));
  LISTENERS.forEach(fn => fn());
}

export function useTranslation(): { t: T; lang: Lang; setLang: (l: Lang) => void } {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1);
    LISTENERS.add(fn);
    return () => { LISTENERS.delete(fn); };
  }, []);

  return {
    t: TRANSLATIONS[currentLang],
    lang: currentLang,
    setLang: setGlobalLang,
  };
}

export type { Lang, T };