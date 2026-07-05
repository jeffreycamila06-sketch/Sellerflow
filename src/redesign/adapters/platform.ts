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

// REAL Capacitor iOS app only (not the ?ios=1 browser override) — for checks
// that depend on the actual WKWebView environment (e.g. native content insets),
// where a desktop-browser preview would measure garbage.
export function isCapacitorIOS(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    return cap?.getPlatform?.() === "ios";
  } catch {
    return false;
  }
}

// The iOS shell ships `ios.contentInset: "always"` (mobile/capacitor.config.ts),
// so the WKWebView scroll view ALREADY reserves the status-bar area natively.
// In that mode the in-page safe-area spacer must collapse to 0 — otherwise the
// header gets a DOUBLE inset (the ~100px blank gap seen on TestFlight after the
// zoom lock exposed the real layout). Detection: with native insets the layout
// viewport is SHORTER than the physical screen by roughly top+bottom insets
// (>30pt); a full-bleed webview (contentInset "never") leaves them equal.
// ADAPTIVE: if a future iOS build drops "always", this returns false and the
// env() spacer takes over — either native config renders correctly with no
// coordinated web deploy. Callers should snapshot the value ONCE at mount
// (keyboard-driven innerHeight changes must not flip the spacer mid-session).
export function hasNativeTopInset(): boolean {
  if (!isCapacitorIOS()) return false;
  try {
    return window.screen.height - window.innerHeight > 30;
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
