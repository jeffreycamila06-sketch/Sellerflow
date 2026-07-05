// Redesign preview entry (Phase 2). Loaded ONLY by redesign.html, mounted at
// /redesign.html. Completely separate from the production entry (src/main.tsx ->
// App.tsx), which is untouched. Imports the scoped tokens + redesign styles.
import { createRoot } from "react-dom/client";
import "../styles/design-tokens.css";
import "./redesign.css";
import RedesignApp from "./RedesignApp";
import { initAnalytics } from "./analytics";
import { applyIOSViewportZoomLock } from "./adapters/platform";

// iOS app shell: lock viewport zoom BEFORE first render — kills the WKWebView
// input-focus auto-zoom that clipped the layout on both edges and panned the
// header under the status bar (TestFlight display bug). No-op on Android/web.
applyIOSViewportZoomLock();

// PostHog analytics — production `/` loads THIS entry (index.html → redesign), so
// init must live here (the src/main.tsx PostHog only runs on the app.html rollback).
// No-op when VITE_PUBLIC_POSTHOG_KEY is absent. Single init for the redesign entry.
initAnalytics();

createRoot(document.getElementById("redesign-root")!).render(<RedesignApp />);
