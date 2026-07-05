import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sellerflow.live",
  appName: "SellerFlow",
  webDir: "www",
  server: {
    url: "https://www.sellerflowlive.com/?apk=20260523-dark-mobile",
    cleartext: false,
    androidScheme: "https"
  },
  ios: {
    // contentInset stays at the DEFAULT "never" (full-bleed): the WKWebView
    // draws behind the status bar and the web layer handles the safe area via
    // viewport-fit=cover + env(safe-area-inset-*) — the canonical Capacitor
    // pattern. ("always" pushed the whole page down natively → the white
    // strip above the purple header on TestFlight. Do not bring it back.)
    // backgroundColor = brand indigo: shown while the remote site loads
    // (kills the white flash; white status-bar text stays readable over it).
    backgroundColor: "#4f46e5"
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#f5f3ef",
      androidScaleType: "CENTER_CROP",
      showSpinner: false
    }
    // ⚠️ Do NOT add a `StatusBar` block here: plugins config is read by BOTH
    // platforms at sync time, so a future Android rebuild would silently pick
    // it up (e.g. white Android status-bar icons). The iOS launch default
    // lives in Info.plist (UIStatusBarStyle — iOS-only file) and the runtime
    // style comes from the iOS-gated applyIOSStatusBarStyle() JS call.
  }
};

export default config;
