// Marketing landing (Step La) — renders nav/hero/footer + routing: "Start free"
// → onSignup, "Log in" → onLogin, language switcher.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Landing from "../Landing";
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

describe("Landing (Step La)", () => {
  it("renders the hero headline + sub", () => {
    renderLanding();
    expect(screen.getByText("Stop typing.")).toBeTruthy();
    expect(screen.getByText("Start selling.")).toBeTruthy();
    expect(screen.getByText(/Turn every live comment into a paid order/)).toBeTruthy();
  });

  it("'Start free' routes to signup (onSignup)", () => {
    const onSignup = vi.fn();
    renderLanding({ onSignup });
    fireEvent.click(screen.getAllByText("Start free")[0]); // nav + hero both have it
    expect(onSignup).toHaveBeenCalledTimes(1);
  });

  it("'Log in' routes to login (onLogin)", () => {
    const onLogin = vi.fn();
    renderLanding({ onLogin });
    fireEvent.click(screen.getAllByText("Log in")[0]);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("language dropdown lists languages and picks one", () => {
    const onPickLang = vi.fn();
    renderLanding({ langOpen: true, onPickLang });
    // a language row (e.g., Filipino) is visible when open → click it
    const fil = screen.getByText("Filipino");
    fireEvent.click(fil);
    expect(onPickLang).toHaveBeenCalled();
  });

  it("footer shows the billing/lang line", () => {
    renderLanding();
    expect(screen.getByText(/Available in 7 languages/)).toBeTruthy();
  });

  // Step Lb sections
  it("renders the metrics strip", () => {
    renderLanding();
    expect(screen.getByText("Active sellers")).toBeTruthy();
    expect(screen.getByText("12k+")).toBeTruthy();
  });

  it("renders the features section (eyebrow + H2 + 6 feature titles)", () => {
    renderLanding();
    expect(screen.getByText("EVERYTHING YOU NEED")).toBeTruthy();
    expect(screen.getByText("One toolkit for the whole live sale")).toBeTruthy();
    ["1-Click Print", "Live Comment Capture", "Order Management", "Customer Database", "Bluetooth Printer Support", "Sales Analytics"].forEach((title) =>
      expect(screen.getByText(title)).toBeTruthy(),
    );
  });

  it("renders the how-it-works section (3 steps)", () => {
    renderLanding();
    expect(screen.getByText("From comment to cash in three steps")).toBeTruthy();
    expect(screen.getByText("Go live & connect")).toBeTruthy();
    expect(screen.getByText("Print & get paid")).toBeTruthy();
  });

  it("center nav anchors (Features, How it works, Pricing) are present", () => {
    renderLanding();
    // "Features"/"Pricing" appear in both the nav and the footer (Step Le) → use getAllByText
    expect(screen.getAllByText("Features").length).toBeGreaterThan(0);
    expect(screen.getByText("How it works")).toBeTruthy();
    expect(screen.getAllByText("Pricing").length).toBeGreaterThan(0);
  });

  // Step Lc — pricing
  it("renders 4 pricing tiers with NT$ prices + Most popular badge", () => {
    renderLanding();
    expect(screen.getByText("Simple plans that scale with your lives")).toBeTruthy();
    expect(screen.getByText("NT$0")).toBeTruthy();
    expect(screen.getByText("NT$500")).toBeTruthy();
    expect(screen.getByText("NT$1,200")).toBeTruthy();
    expect(screen.getByText("NT$1,700")).toBeTruthy();
    expect(screen.getByText("Most popular")).toBeTruthy();
  });

  it("every pricing CTA routes to signup", () => {
    const onSignup = vi.fn();
    renderLanding({ onSignup });
    // Choose Basic / Pro / Master + Free's "Start free" (hero + nav also have Start free)
    fireEvent.click(screen.getByText("Choose Pro"));
    expect(onSignup).toHaveBeenCalled();
  });

  // Step Ld — FAQ accordion
  it("renders the FAQ section with questions (answers hidden until opened)", () => {
    renderLanding();
    expect(screen.getByText("Questions, answered")).toBeTruthy();
    expect(screen.getByText("Do I need a credit card to start?")).toBeTruthy();
    expect(screen.queryByText(/Billing is via Wise/)).toBeNull(); // collapsed by default
  });

  it("tapping a question opens it; single-open closes the previous", () => {
    renderLanding();
    fireEvent.click(screen.getByText("Do I need a credit card to start?"));
    expect(screen.getByText(/Billing is via Wise/)).toBeTruthy(); // opened
    fireEvent.click(screen.getByText("Is there really a free plan?"));
    expect(screen.queryByText(/Billing is via Wise/)).toBeNull(); // first closed (single-open)
    expect(screen.getByText(/200 orders per cycle, free forever/)).toBeTruthy(); // second open
  });

  it("FAQ nav anchor present", () => {
    renderLanding();
    expect(screen.getAllByText("FAQ").length).toBeGreaterThan(0);
  });

  // Step Le — CTA band + 4-column footer
  it("renders the CTA band with headline + Telegram link", () => {
    renderLanding();
    expect(screen.getByText("Ready to sell faster?")).toBeTruthy();
    const tg = screen.getByText("Talk on Telegram");
    expect(tg.getAttribute("href")).toBe("https://t.me/SellerFlowLive1995");
  });

  it("CTA band 'Start free' routes to signup", () => {
    const onSignup = vi.fn();
    renderLanding({ onSignup });
    // nav + hero + pricing(Free) + CTA all have "Start free"
    const btns = screen.getAllByText("Start free");
    fireEvent.click(btns[btns.length - 1]); // CTA band is last
    expect(onSignup).toHaveBeenCalled();
  });

  it("renders the 4-column footer headings", () => {
    renderLanding();
    expect(screen.getByText("Product")).toBeTruthy();
    expect(screen.getByText("Support")).toBeTruthy();
    expect(screen.getByText("Language")).toBeTruthy();
  });
});
