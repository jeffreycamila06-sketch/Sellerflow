// Settings hub — "Need help? Contact us" support card (2026-07-24): sits directly
// ABOVE Delete Account, opens a Telegram-contact modal with a secondary "Next time"
// (closes, no nav) + a primary "Proceed" that is a REAL iOS-safe anchor to TELEGRAM_URL.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SettingsHub from "../SettingsHub";
import { TProvider, buildT } from "../../i18n";
import { TELEGRAM_URL } from "../../../lib/telegram";

const LANGS_ALL = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"];

const noop = () => {};
const renderHub = (isAdmin = false) =>
  render(
    <TProvider lang="en">
      <SettingsHub
        onGeneral={noop} onCustomers={noop} onAdmin={noop} onSales={noop}
        onShipping={noop} onCustomerData={noop} onLegal={noop} onDelete={noop}
        onLogout={noop} isAdmin={isAdmin}
      />
    </TProvider>,
  );
const t = buildT("en") as unknown as Record<string, string>;

describe("SettingsHub — Need help? support card", () => {
  it("renders the support card directly ABOVE the Delete Account card", () => {
    renderHub();
    const labels = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim());
    const help = labels.findIndex((x) => x.includes(t.rd_sh_help));
    const del = labels.findIndex((x) => x.includes(t.rd_sh_delete));
    expect(help).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThanOrEqual(0);
    expect(help).toBe(del - 1); // immediately above Delete Account
  });

  it("does not render the modal until the card is tapped", () => {
    renderHub();
    expect(screen.queryByTestId("support-modal")).toBeNull();
  });

  it("tapping the card opens the modal with the friendly body line", () => {
    renderHub();
    fireEvent.click(screen.getByText(t.rd_sh_help));
    expect(screen.getByTestId("support-modal")).toBeTruthy();
    expect(screen.getByText(t.rd_help_body)).toBeTruthy();
  });

  it("'Next time' closes the modal with NO navigation (a plain button, not an anchor)", () => {
    renderHub();
    fireEvent.click(screen.getByText(t.rd_sh_help));
    const later = screen.getByTestId("support-later");
    expect(later.tagName).toBe("BUTTON");
    expect(later.getAttribute("href")).toBeNull();
    fireEvent.click(later);
    expect(screen.queryByTestId("support-modal")).toBeNull();
  });

  it("'Proceed' is a REAL iOS-safe anchor to TELEGRAM_URL (target=_blank, rel noreferrer+noopener)", () => {
    renderHub();
    fireEvent.click(screen.getByText(t.rd_sh_help));
    const proceed = screen.getByTestId("support-proceed");
    expect(proceed.tagName).toBe("A");
    expect(proceed.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(proceed.getAttribute("target")).toBe("_blank");
    const rel = proceed.getAttribute("rel") || "";
    expect(rel).toContain("noreferrer");
    expect(rel).toContain("noopener");
  });

  it("tapping 'Proceed' closes the modal (established ContactSupportPopup convention)", () => {
    renderHub();
    fireEvent.click(screen.getByText(t.rd_sh_help));
    fireEvent.click(screen.getByTestId("support-proceed"));
    expect(screen.queryByTestId("support-modal")).toBeNull();
  });

  it("all new i18n keys are filled in all 7 languages", () => {
    const keys = ["rd_sh_help", "rd_help_body", "rd_help_later", "rd_help_proceed"];
    for (const lang of LANGS_ALL) {
      const tt = buildT(lang) as unknown as Record<string, string>;
      for (const k of keys) expect(tt[k] && tt[k].trim().length, `${k}/${lang}`).toBeTruthy();
      if (lang !== "en") expect(tt.rd_sh_help).not.toBe(t.rd_sh_help); // genuinely translated, not en fallback
    }
  });
});

// ── Addendum (2026-07-24): highlight the card — WHITE card, accent-FILLED badge
// with a FINITE 3-beat pulse on mount. Only the badge changes; other cards untouched.
describe("SettingsHub — Need help? highlighted badge", () => {
  it("the card stays WHITE (surface), not a full accent card", () => {
    renderHub();
    const card = screen.getByTestId("help-card");
    expect(card.style.background).toContain("var(--surface)"); // same as every other tile
    expect(card.style.background).not.toContain("var(--accent)");
  });

  it("the icon BADGE is accent-FILLED (var(--accent) bg + var(--accent-text) glyph) via tokens", () => {
    renderHub();
    const badge = screen.getByTestId("help-badge");
    expect(badge.style.background).toBe("var(--accent)");   // filled, not the light --accent-soft other cards use
    expect(badge.style.color).toBe("var(--accent-text)");   // token, not a hardcoded color
  });

  it("the badge carries the FINITE beat class (sfl-anim-beat3), and only the badge does", () => {
    renderHub();
    expect(screen.getByTestId("help-badge").className).toContain("sfl-anim-beat3");
    // the label + card button themselves are not animated
    expect(screen.getByTestId("help-card").className).not.toContain("sfl-anim-beat3");
  });
});

describe("redesign.css — .sfl-anim-beat3 is finite + fully motion-gated", () => {
  const css = readFileSync(join(__dirname, "../../redesign.css"), "utf-8");
  const rule = (css.match(/\[data-redesign\]\s*\.sfl-anim-beat3\s*\{[^}]*\}/) || [""])[0];

  it("defined with the shared sflBeat keyframe and iteration-count 3 (NOT infinite)", () => {
    expect(rule).toContain("sflBeat");
    expect(rule).toMatch(/ease-in-out\s+3\b/); // finite iteration count = 3
    expect(rule).not.toContain("infinite");
  });
  it("gated by the [data-motion=off] kill switch", () => {
    expect(css).toContain('[data-redesign][data-motion="off"] .sfl-anim-beat3');
  });
  it("gated by prefers-reduced-motion", () => {
    const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toContain(".sfl-anim-beat3");
  });
});
