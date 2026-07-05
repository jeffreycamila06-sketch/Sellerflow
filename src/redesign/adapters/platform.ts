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

// iOS WKWebView auto-ZOOMS the page when a focused <input> has font-size <16px
// (the redesign uses 13–14px inputs everywhere). Once zoomed, the layout pans:
// content clips on BOTH edges, the whole page scrolls horizontally, and the
// header slides under the status bar — the TestFlight display bug. Android
// WebView and desktop browsers never auto-zoom, so this is iOS-only.
// Fix: on the iOS app shell ONLY, lock the viewport zoom (an app, not a web
// page — pinch-zoom lock is standard for Capacitor shells). Web/Safari users
// are untouched (no Capacitor, no ?ios → no-op), so browser accessibility
// zoom is preserved everywhere else.
export const IOS_LOCKED_VIEWPORT = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
export function applyIOSViewportZoomLock(): boolean {
  if (typeof document === "undefined" || !isIOS()) return false;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return false;
  meta.setAttribute("content", IOS_LOCKED_VIEWPORT);
  return true;
}
