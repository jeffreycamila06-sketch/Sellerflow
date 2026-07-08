// ExpiryModal — per-tier render, the platform split (Android "plan/renew" vs iOS
// "account/contact support"), iOS 3.1.1 copy safety, ✕ dismiss, and the shared
// slide gesture driving onComplete.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExpiryModal from "../ExpiryModal";
import type { ExpiryTier } from "../../adapters/planExpiryModal";
import { TProvider } from "../../i18n";

const renderModal = (over: { tier?: ExpiryTier; daysLeft?: number; ios?: boolean; onDismiss?: () => void; onComplete?: () => void } = {}) =>
  render(
    <TProvider lang="en">
      <ExpiryModal
        tier={over.tier ?? "7d"}
        daysLeft={over.daysLeft ?? 7}
        ios={over.ios ?? false}
        onDismiss={over.onDismiss ?? (() => {})}
        onComplete={over.onComplete ?? (() => {})}
      />
    </TProvider>,
  );

afterEach(() => vi.restoreAllMocks());
function mockTrackWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width, height: 56, top: 0, left: 0, right: width, bottom: 56, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

describe("ExpiryModal", () => {
  it("Android/web variant: plan + renew wording, actual day count", () => {
    renderModal({ tier: "3d", daysLeft: 3, ios: false });
    expect(screen.getByText("Your plan expires in 3 days")).toBeTruthy();
    expect(screen.getByText(/Renew to keep your live sessions/)).toBeTruthy();
    expect(screen.getByText("Slide to renew")).toBeTruthy();
  });

  it("today + expired tiers use the fixed headlines", () => {
    const { unmount } = renderModal({ tier: "1d", daysLeft: 1 });
    expect(screen.getByText("Your plan expires today")).toBeTruthy();
    unmount();
    renderModal({ tier: "expired", daysLeft: 0 });
    expect(screen.getByText("Your plan has expired")).toBeTruthy();
  });

  it("iOS variant swaps to account + contact-support wording", () => {
    renderModal({ tier: "7d", daysLeft: 7, ios: true });
    expect(screen.getByText("Your account expires in 7 days")).toBeTruthy();
    expect(screen.getByText(/Contact support to keep your account active/)).toBeTruthy();
    expect(screen.getByText("Slide to contact support")).toBeTruthy();
  });

  it("iOS copy stays 3.1.1-safe (no plan/renew/pay/subscribe/price/upgrade), every tier", () => {
    for (const tier of ["7d", "3d", "1d", "expired"] as ExpiryTier[]) {
      const { unmount } = renderModal({ tier, daysLeft: tier === "7d" ? 7 : tier === "3d" ? 3 : tier === "1d" ? 1 : 0, ios: true });
      const text = document.body.innerHTML.toLowerCase();
      for (const bad of ["plan", "renew", "subscribe", "subscription", "price", "upgrade", "$", "pay"]) {
        expect(text.includes(bad)).toBe(false);
      }
      unmount();
    }
  });

  it("✕ always present (no force mode) and calls onDismiss", () => {
    const onDismiss = vi.fn();
    renderModal({ onDismiss });
    fireEvent.click(screen.getByTestId("expiry-close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("sliding past threshold fires onComplete (renew/support redirect)", () => {
    mockTrackWidth(300); // maxTravel 250
    const onComplete = vi.fn();
    renderModal({ onComplete });
    const knob = screen.getByTestId("expiry-knob");
    fireEvent.pointerDown(knob, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 245 });
    fireEvent.pointerUp(window, { clientX: 245 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
