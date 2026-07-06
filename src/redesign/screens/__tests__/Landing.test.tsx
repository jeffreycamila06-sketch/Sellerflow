// Marketing landing v2 — blueprint design-landing/sellerflow-landing-preview.html.
// Asserts routing (CTAs → signup, Log in → login, guides → signup), the REAL
// store links, the no-prices rule (Jeff decision), the as-is stats row, section
// presence, FAQ single-open, and the Telegram help fab.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Landing, { PLAY_URL, APPSTORE_URL } from "../Landing";
import { TProvider } from "../../i18n";

const noop = () => {};
const renderLanding = (over: { onLogin?: () => void; onSignup?: () => void; onPickLang?: (c: string) => void; langOpen?: boolean } = {}) =>
  render(
    <TProvider lang="en">
      <Landing
        onLogin={over.onLogin ?? noop}
        onSignup={over.onSignup ?? noop}
        lang="en"
        langOpen={over.langOpen ?? false}
        onToggleLang={noop}
        onPickLang={over.onPickLang ?? noop}
      />
    </TProvider>,
  );

describe("Landing v2", () => {
  it("renders the hero headline + sub", () => {
    renderLanding();
    expect(screen.getByText(/Turn every live comment into a/)).toBeTruthy();
    expect(screen.getByText("paid order.")).toBeTruthy();
    expect(screen.getByText(/so you sell, not scribble/)).toBeTruthy();
  });

  it("'Try it for free' CTAs route to signup (hero + final CTA)", () => {
    const onSignup = vi.fn();
    renderLanding({ onSignup });
    const ctas = screen.getAllByText("Try it for free →");
    expect(ctas.length).toBe(2); // hero + final CTA band
    fireEvent.click(ctas[0]);
    fireEvent.click(ctas[1]);
    expect(onSignup).toHaveBeenCalledTimes(2);
  });

  it("nav 'Create free account' routes to signup; 'Log in' routes to login", () => {
    const onSignup = vi.fn(); const onLogin = vi.fn();
    renderLanding({ onSignup, onLogin });
    fireEvent.click(screen.getByText("Create free account"));
    fireEvent.click(screen.getByText("Log in"));
    expect(onSignup).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("store badges link to the REAL Play Store and App Store URLs (hero + CTA + footer)", () => {
    renderLanding();
    const links = Array.from(document.querySelectorAll("a"));
    const play = links.filter((a) => a.getAttribute("href") === PLAY_URL);
    const ios = links.filter((a) => a.getAttribute("href") === APPSTORE_URL);
    expect(PLAY_URL).toBe("https://play.google.com/store/apps/details?id=com.sellerflow.live");
    expect(APPSTORE_URL).toBe("https://apps.apple.com/app/id6783770354");
    expect(play.length).toBeGreaterThanOrEqual(3); // hero badge + CTA badge + footer link
    expect(ios.length).toBeGreaterThanOrEqual(3);
  });

  it("NO prices anywhere (Jeff decision) — no NT$ plan prices, no plan cards", () => {
    renderLanding();
    for (const price of ["NT$0", "NT$500", "NT$1,200", "NT$1,700"]) {
      expect(screen.queryByText(price)).toBeNull();
    }
    expect(screen.queryByText("Most popular")).toBeNull();
    expect(screen.queryByText(/\/mo/)).toBeNull();
  });

  it("existing stats row stays as-is (12k+ / 1.4M / <2s / 4.9★)", () => {
    renderLanding();
    ["12k+", "1.4M", "<2s", "4.9★"].forEach((v) => expect(screen.getByText(v)).toBeTruthy());
    expect(screen.getByText("Active sellers")).toBeTruthy();
  });

  it("renders the 3 how-it-works steps", () => {
    renderLanding();
    ["Connect your live", "Comments become orders", "Print & ship"].forEach((s) =>
      expect(screen.getAllByText(s).length).toBeGreaterThan(0),
    );
  });

  it("renders the dashboard assembly stage + bento feature titles", () => {
    renderLanding();
    expect(document.getElementById("sflDashStage")).toBeTruthy();
    ["Auto-capture every \"mine\"", "Buyer numbers that match your bags", "Thermal printing",
      "7-11 shipping export", "Raffle games", "Sales reports", "7 languages", "Works on every device"]
      .forEach((ti) => expect(screen.getByText(ti)).toBeTruthy());
  });

  it("FAQ: single-open accordion, answers hidden until opened", () => {
    renderLanding();
    expect(screen.getByText("Can I try it for free?")).toBeTruthy();
    expect(screen.queryByText(/no credit card needed/)).toBeNull();
    fireEvent.click(screen.getByText("Can I try it for free?"));
    expect(screen.getByText(/no credit card needed/)).toBeTruthy();
    fireEvent.click(screen.getByText("How do I pay for a plan?"));
    expect(screen.queryByText(/no credit card needed/)).toBeNull(); // first closed (single-open)
    expect(screen.getByText(/Via Wise transfer/)).toBeTruthy();
  });

  it("renders the localized testimonials", () => {
    renderLanding();
    expect(screen.getByText(/even when the comments fly/)).toBeTruthy();
    expect(screen.getByText("Cherry · Fashion live seller")).toBeTruthy();
    expect(screen.getByText("Mrs. Ho · Home goods")).toBeTruthy();
  });

  it("guide cards route to signup (guides live in-app, post-login)", () => {
    const onSignup = vi.fn();
    renderLanding({ onSignup });
    fireEvent.click(screen.getByText("Printer setup"));
    expect(onSignup).toHaveBeenCalledTimes(1);
  });

  it("help fab + footer Telegram links point at @SellerFlowLive1995", () => {
    renderLanding();
    const fab = screen.getByText(/Need help\? Message us/);
    expect(fab.getAttribute("href")).toBe("https://t.me/SellerFlowLive1995");
  });

  it("video slot renders as a poster placeholder with the demo caption", () => {
    renderLanding();
    expect(screen.getByText(/2-minute demo/)).toBeTruthy();
  });

  it("seller-photo slot falls back gracefully when the asset is missing", () => {
    renderLanding();
    const img = document.querySelector("img.sfl-l2-sellerimg") as HTMLImageElement;
    expect(img).toBeTruthy(); // tries /landing-seller.jpg first
    fireEvent.error(img);     // asset missing → fallback frame with localized note
    expect(screen.getByText(/photo coming soon/)).toBeTruthy();
  });

  it("language dropdown lists languages and picks one", () => {
    const onPickLang = vi.fn();
    renderLanding({ langOpen: true, onPickLang });
    fireEvent.click(screen.getByText("Filipino"));
    expect(onPickLang).toHaveBeenCalled();
  });

  it("footer shows Made in Taiwan + the real privacy link", () => {
    renderLanding();
    expect(screen.getByText(/Made in Taiwan/)).toBeTruthy();
    expect(screen.getByText("Privacy").getAttribute("href")).toBe("/privacy/");
  });
});
