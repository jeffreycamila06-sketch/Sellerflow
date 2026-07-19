// ExpiryModal — per-tier render, platform split (Android "plan"/"Renew now" vs
// iOS "account"/"Contact support"), iOS 3.1.1 copy safety, ✕ dismiss, and the
// action rendered as a REAL anchor to the Telegram support link (onAction =
// dismissal side-effect on tap; the href does the opening natively).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExpiryModal from "../ExpiryModal";
import type { ExpiryTier } from "../../adapters/planExpiryModal";
import { TProvider } from "../../i18n";
import { TELEGRAM_URL } from "../../../lib/telegram";

const TG = TELEGRAM_URL;
const renderModal = (over: { tier?: ExpiryTier; daysLeft?: number; ios?: boolean; onDismiss?: () => void; onAction?: () => void } = {}) =>
  render(
    <TProvider lang="en">
      <ExpiryModal
        tier={over.tier ?? "7d"}
        daysLeft={over.daysLeft ?? 7}
        ios={over.ios ?? false}
        onDismiss={over.onDismiss ?? (() => {})}
        onAction={over.onAction ?? (() => {})}
      />
    </TProvider>,
  );

describe("ExpiryModal", () => {
  it("Android/web variant: plan + Renew now, actual day count", () => {
    renderModal({ tier: "3d", daysLeft: 3, ios: false });
    expect(screen.getByText("Your plan expires in 3 days")).toBeTruthy();
    expect(screen.getByText(/Renew to keep your live sessions/)).toBeTruthy();
    expect(screen.getByText("Renew now")).toBeTruthy();
  });

  it("today + expired tiers use the fixed headlines", () => {
    const { unmount } = renderModal({ tier: "1d", daysLeft: 1 });
    expect(screen.getByText("Your plan expires today")).toBeTruthy();
    unmount();
    renderModal({ tier: "expired", daysLeft: 0 });
    expect(screen.getByText("Your plan has expired")).toBeTruthy();
  });

  it("iOS variant swaps to account + Contact support wording", () => {
    renderModal({ tier: "7d", daysLeft: 7, ios: true });
    expect(screen.getByText("Your account expires in 7 days")).toBeTruthy();
    expect(screen.getByText(/Contact support to keep your account active/)).toBeTruthy();
    expect(screen.getByText("Contact support")).toBeTruthy();
  });

  it("action is a real anchor to the Telegram support link", () => {
    renderModal({ tier: "7d" });
    const a = screen.getByTestId("expiry-action");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(TG);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer");
  });

  it("tapping the action fires onAction (dismissal side-effect)", () => {
    const onAction = vi.fn();
    renderModal({ onAction });
    fireEvent.click(screen.getByTestId("expiry-action"));
    expect(onAction).toHaveBeenCalledTimes(1);
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
});
