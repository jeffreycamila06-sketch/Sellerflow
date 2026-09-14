// APK / native-shell detection for the public marketing landing gate.
// The landing must NEVER appear in the app shell: the APK loads "/" (or
// /redesign.html) with window.Capacitor injected, and the prod APK also carries
// ?apk=. Web browsers have NEITHER signal → they get the landing when logged out.
// Two signals = airtight (mirrors the old App.tsx isNativeApp gate).
export function isAppShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if ((window as unknown as { Capacitor?: unknown }).Capacitor) return true;
    return new URLSearchParams(window.location.search).has("apk");
  } catch {
    return false;
  }
}

// Logged-out destination: the app login for the APK shell, the marketing landing
// for web browsers.
export function anonScreen(): "login" | "landing" {
  return isAppShell() ? "login" : "landing";
}

// Narrow (phone/tablet) viewport — used to hide the Parcel Scan 賣貨便 export on
// mobile (export is laptop-only; a mis-tap on a phone marks rows exported and
// they vanish from the laptop file). 768px = the standard mobile/tablet cutoff;
// laptops are wider. matchMedia first (jsdom-mockable), innerWidth fallback.
export function isNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (typeof window.matchMedia === "function") return window.matchMedia("(max-width: 768px)").matches;
    return typeof window.innerWidth === "number" && window.innerWidth <= 768;
  } catch {
    return false;
  }
}
