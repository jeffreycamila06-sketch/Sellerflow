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
