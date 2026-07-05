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

// ── iOS native-quality display (canonical Capacitor pattern) ────────────────
// The iOS shell is FULL-BLEED (`ios.contentInset` = default "never" — the
// "always" experiment and its hasNativeTopInset() heuristic are gone): the
// WKWebView draws behind the status bar, viewport-fit=cover keeps
// env(safe-area-inset-*) live, and the app root paints a var(--header-bg)
// backdrop under the status bar so every screen's header runs edge-to-edge.
// The three helpers below are called once from main.tsx before first render.

// iOS WKWebView auto-ZOOMS the page when a focused <input> has font-size <16px.
// Once zoomed, the layout pans: content clips on BOTH edges and the header
// slides under the status bar. PRIMARY fix: the html.sfl-ios-shell CSS floor
// bumps every redesign input/select/textarea to 16px, removing the trigger at
// the source (redesign.css). This viewport lock stays as the BACKSTOP — it is
// the exact tag the official Ionic/Capacitor app templates ship, and WKWebView
// (unlike Safari, which ignores user-scalable since iOS 10) honors it. Web
// browsers never get it (no Capacitor, no ?ios → no-op), so browser
// accessibility zoom is preserved everywhere else.
export const IOS_LOCKED_VIEWPORT = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
export function applyIOSViewportZoomLock(): boolean {
  if (typeof document === "undefined" || !isIOS()) return false;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return false;
  meta.setAttribute("content", IOS_LOCKED_VIEWPORT);
  return true;
}

// Height of the app-root status-bar backdrop (RedesignApp). Pure env(), NO
// pixel floor, NO platform branch: iOS full-bleed resolves it to the real
// status-bar inset (purple runs edge-to-edge); Android WebView draws BELOW its
// status bar so the inset is 0 → ZERO height → the backdrop paints nothing
// (Android/desktop visuals byte-identical to before). Guarded by tests.
export const STATUS_BAR_BACKDROP_HEIGHT = "env(safe-area-inset-top)";

// Root class gating the iOS-shell-only CSS (the 16px input floor). On the
// <html> element (NOT [data-redesign]) so plain descendant selectors work.
// isIOS() includes the ?ios=1 browser override → the input sizing is
// previewable in a desktop browser before an iOS build exists.
export const IOS_SHELL_CLASS = "sfl-ios-shell";
export function applyIOSShellClass(): boolean {
  if (typeof document === "undefined" || !isIOS()) return false;
  document.documentElement.classList.add(IOS_SHELL_CLASS);
  return true;
}

// White status-bar text (clock/battery) over the purple header via the
// @capacitor/status-bar plugin — "DARK" = the plugin's Style.Dark = light text
// for dark backgrounds. The plugin JS is injected by the native bridge even for
// remote-loaded pages (server.url thin shell), same as SellerFlowPrinter.
// Feature-detected: a binary without the plugin (or Android/web) is a clean
// no-op, so this needs no npm dependency and never throws. The native config
// (`plugins.StatusBar.style: "DARK"`) already sets the style at launch; this
// call is the in-page mirror so a config-less binary still ends up white.
type StatusBarPlugin = { setStyle?: (o: { style: string }) => Promise<void> };
export function applyIOSStatusBarStyle(): boolean {
  if (!isCapacitorIOS()) return false;
  try {
    const sb = (window as unknown as { Capacitor?: { Plugins?: { StatusBar?: StatusBarPlugin } } })
      .Capacitor?.Plugins?.StatusBar;
    if (!sb?.setStyle) return false;
    void sb.setStyle({ style: "DARK" }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
