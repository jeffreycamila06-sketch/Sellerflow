// Redesign analytics wrapper — no-ops without a PostHog key; maps identify props
// (email + plan/store_name/role) and forwards events when configured. posthog-js
// is mocked; the key is toggled via vi.stubEnv (enabled() reads env at call time).
import { describe, it, expect, vi, afterEach } from "vitest";

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
    // no VITE_PUBLIC_POSTHOG_KEY stubbed → enabled() is false
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
  it("identifySeller maps email + plan/store_name/role", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    identifySeller(profile());
    expect(identify).toHaveBeenCalledWith("Seller@X.com", { plan: "pro", store_name: "My Shop", role: "seller" });
  });
  it("role falls back to 'seller' when empty", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    identifySeller({ ...profile(), role: "" } as AccountUser);
    expect(identify).toHaveBeenCalledWith("Seller@X.com", expect.objectContaining({ role: "seller" }));
  });
  it("identifySeller no-ops when the profile has no email", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    identifySeller({ ...profile(), email: "" } as AccountUser);
    expect(identify).not.toHaveBeenCalled();
  });
  it("track forwards event + props; reset + init forward to posthog", () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    track("connect_success", { platform: "Facebook" });
    expect(capture).toHaveBeenCalledWith("connect_success", { platform: "Facebook" });
    resetAnalytics();
    expect(reset).toHaveBeenCalledTimes(1);
    initAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith("phc_test", expect.objectContaining({
      person_profiles: "identified_only", capture_pageview: true, capture_pageleave: true,
    }));
  });
});
