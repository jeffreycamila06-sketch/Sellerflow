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
    // backgroundColor = brand indigo: shown while the remote site loads
    // (kills the white flash; white status-bar text stays readable over it).
    backgroundColor: "#4f46e5"
  },
  android: {
    // ⚠️ ANDROID SAFETY LOCK — empty allowlist = ZERO npm Capacitor plugins
    // ever sync into the Android project, so the plugins.StatusBar block
    // below is structurally unreachable on Android (even on a future Android
    // rebuild). Verified against Capacitor 8.3.4 cli/src/plugin.ts:
    // `getIncludedPluginPackages(...) ?? getDependencies(...)` — an EMPTY
    // array is used as-is (nullish coalescing), it does NOT fall back to
    // package.json. Android's SellerFlowPrinterPlugin is a local class
    // registered manually in MainActivity — not npm-scanned, unaffected.
    // iOS has no includePlugins → falls back to package.json → StatusBar in.
    includePlugins: []
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#f5f3ef",
      androidScaleType: "CENTER_CROP",
      showSpinner: false
    },
    // iOS "Android model" (the fix for the broken status-bar integration):
    // overlaysWebView:false makes the StatusBar plugin natively RESIZE the
    // WKWebView to start BELOW the status bar and paint a native indigo
    // surface behind it — the same OS-level split the Android window manager
    // does (where the display is perfect). Applied at LAUNCH by the plugin's
    // native load() (works for the remote server.url shell, persists across
    // reloads, handles rotation). Config — NOT a runtime JS call — because
    // capacitorViewDidAppear re-applies these values on every VC appear and
    // would revert a JS-only setting. env(safe-area-inset-top) then reports
    // 0 in-page, exactly like Android, so the web layer needs NO changes.
    // Android never reads this block (includePlugins lock above).
    // style "DARK" = the plugin's Style.Dark = WHITE text for dark
    // backgrounds (verified in style(fromString:) — "dark"→.lightContent;
    // the tempting "light" would give BLACK text).
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: "#4f46e5",
      style: "DARK"
    }
  }
};

export default config;
