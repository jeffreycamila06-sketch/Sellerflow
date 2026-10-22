// Redesign analytics wrapper — no-ops without a PostHog key; maps identify props
// (email + plan/store_name/role) and forwards events when configured. posthog-js
// is mocked; the key is toggled via vi.stubEnv (enabled() reads env at call time).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const { init, identify, capture, reset } = vi.hoisted(() => ({
  init: vi.fn(), identify: vi.fn(), capture: vi.fn(), reset: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: { init, identify, capture, reset } }));

import { initAnalytics, identifySeller, track, resetAnalytics } from "../analytics";
import type { AccountUser } from "../../accountDb";

const profile = (): AccountUser => ({
  authUserId: "a", email: "Seller@X.com",
  profile: { fullName: "S", storeName: "My Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
});

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("analytics — no-op when no PostHog key", () => {
  it("init / identify / track / reset never touch posthog", () => {
    // Force "no key" — a developer's local .env may set VITE_PUBLIC_POSTHOG_KEY, and
    // Vite loads it into import.meta.env for tests too. Empty string = disabled.
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "");
    initAnalytics();
    identifySeller(profile());
    track("connect_attempt", { platform: "TikTok" });
    resetAnalytics();
    expect(init).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe("analytics — when VITE_PUBLIC_POSTHOG_KEY is set", () => {
  it("identifySeller identifies by the auth user id (never the email) + plan/store_name/role", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    identifySeller(profile());
    expect(identify).toHaveBeenCalledWith("a", { plan: "pro", store_name: "My Shop", role: "seller" });
    expect(JSON.stringify(identify.mock.calls)).not.toContain("Seller@X.com");
  });
  it("role falls back to 'seller' when empty", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    identifySeller({ ...profile(), role: "" } as unknown as AccountUser);
    expect(identify).toHaveBeenCalledWith("a", expect.objectContaining({ role: "seller" }));
  });
  it("identifySeller no-ops when the profile has no auth user id", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    identifySeller({ ...profile(), authUserId: "" } as AccountUser);
    expect(identify).not.toHaveBeenCalled();
  });
  it("the rollback entry (src/main.tsx) no longer initialises PostHog — one init, in the redesign", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    expect(main).not.toMatch(/posthog-js|posthog\.init|import posthog/);
    expect(readFileSync("src/redesign/main.tsx", "utf8")).toContain("initAnalytics()");
  });
  it("track forwards event + props; reset + init forward to posthog", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    track("connect_success", { platform: "Facebook" });
    expect(capture).toHaveBeenCalledWith("connect_success", { platform: "Facebook" });
    resetAnalytics();
    expect(reset).toHaveBeenCalledTimes(1);
    initAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
    // Audit Oct 13 (6): no autocapture / recording / screen text — buyer data stays out of PostHog.
    expect(init.mock.calls[0][1]).toMatchObject({ autocapture: false, disable_session_recording: true, mask_all_text: true });
    expect(init).toHaveBeenCalledWith("phc_test", expect.objectContaining({
      person_profiles: "identified_only", capture_pageview: true, capture_pageleave: true,
    }));
  });
});
