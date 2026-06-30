// Platform detection for iOS App Store compliance (Guideline 2.1b / 3.1.1). On the
// iOS app we hide/neutralize ALL payment/subscription/pricing UI so there is no paid
// digital content visible; Android + web keep everything. Mirrors the Capacitor check
// in src/main.tsx. `?ios=1` lets us verify the hidden/neutral state in a plain browser
// before resubmitting (the real Capacitor.getPlatform()==="ios" only fires in the app).
export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    if (cap?.getPlatform?.() === "ios") return true;
    return new URLSearchParams(window.location.search).has("ios");
  } catch {
    return false;
  }
}
