// Redesign preview entry (Phase 2). Loaded ONLY by redesign.html, mounted at
// /redesign.html. Completely separate from the production entry (src/main.tsx ->
// App.tsx), which is untouched. Imports the scoped tokens + redesign styles.
import { createRoot } from "react-dom/client";
import "../styles/design-tokens.css";
import "./redesign.css";
import RedesignApp from "./RedesignApp";
import { initAnalytics } from "./analytics";
import { applyIOSShellClass, applyIOSStatusBarStyle, applyIOSViewportZoomLock } from "./adapters/platform";

// iOS app shell display setup, BEFORE first render (all three no-op on
// Android/web): the sfl-ios-shell class turns on the 16px input floor (the
// real fix for the WKWebView input-focus auto-zoom), the viewport zoom lock
// stays as the Ionic-standard backstop, and the StatusBar plugin call sets
// white status-bar text over the edge-to-edge purple header.
applyIOSShellClass();
applyIOSViewportZoomLock();
applyIOSStatusBarStyle();

// PostHog analytics — production `/` loads THIS entry (index.html → redesign), so
// init must live here (the src/main.tsx PostHog only runs on the app.html rollback).
// No-op when VITE_PUBLIC_POSTHOG_KEY is absent. Single init for the redesign entry.
initAnalytics();

createRoot(document.getElementById("redesign-root")!).render(<RedesignApp />);
