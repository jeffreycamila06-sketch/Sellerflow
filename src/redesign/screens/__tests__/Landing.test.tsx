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
});
