// Redesign analytics — thin, SSR-safe wrapper around posthog-js. A COPY of the old
// App.tsx tracking (basic parity: identify on auth, connect events, reset on
// logout; NO order event). This is the SINGLE posthog-js import in the redesign
// tree — RedesignApp + the entry call these helpers, never posthog directly.
//
// Every call no-ops when there is no VITE_PUBLIC_POSTHOG_KEY (preview / test /
// local without env) or no window (SSR), so the app never depends on analytics
// being configured. `enabled()` reads the env at CALL time so tests can toggle it.
import posthog from "posthog-js";
import type { AccountUser } from "../accountDb";

function enabled(): boolean {
  return typeof window !== "undefined" && !!import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
}

// Init — verbatim copy of the production config (old src/main.tsx). Called ONCE
// from the redesign entry (src/redesign/main.tsx) before render. No-op w/o a key.
export function initAnalytics(): void {
  if (!enabled()) return;
  posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string, {
    api_host: (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string) || "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
  });
}

// Seller identify — mirrors App.tsx:735/757 (email + plan/store_name/role).
export function identifySeller(profile: AccountUser): void {
  if (!enabled() || !profile?.email) return;
  posthog.identify(profile.email, {
    plan: profile.plan,
    store_name: profile.profile.storeName,
    role: profile.role || "seller",
  });
}

// Generic event — mirrors App.tsx posthog.capture(event, props).
export function track(event: string, props?: Record<string, unknown>): void {
  if (!enabled()) return;
  posthog.capture(event, props);
}

// Logout — mirrors App.tsx:4207 posthog.reset().
export function resetAnalytics(): void {
  if (!enabled()) return;
  posthog.reset();
}
