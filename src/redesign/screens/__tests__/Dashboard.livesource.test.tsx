// Option E (owner-gated) — liveSourceMode replaces the 3 chips with ONE compact "Live
// source" button that opens the sheet. Off (everyone else) = the classic 3-chip header,
// byte-for-byte unchanged (the chips still render, no compact button).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Dashboard from "../Dashboard";
import { TProvider } from "../../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const noop = () => {};
const base = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onRefreshTT: noop,
  ttAccounts: ["maria_shops"], fbAccounts: ["fbpage_one"],
  printed: {}, entId: null, entPrice: "", onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Dashboard {...base} {...over} /></TProvider>);

describe("Dashboard — Live Source gating (Option E)", () => {
  it("liveSourceMode OFF → classic chips (open dropdown works), NO compact button", () => {
    renderDash({ ttOpen: true }); // open the TikTok chip dropdown
    expect(screen.queryByTestId("livesource-button")).toBeNull();
    expect(screen.getByText("TIKTOK ACCOUNT")).toBeTruthy(); // classic chip dropdown renders
  });

  it("liveSourceMode ON → ONE compact button, chips gone; tap opens the sheet", () => {
    const onOpenSourceSheet = vi.fn();
    // even with ttOpen:true, the classic dropdown must NOT render (chips replaced).
    renderDash({ liveSourceMode: true, ttOpen: true, liveSourcePlatform: "TikTok", liveSourceName: "@maria_shops", onOpenSourceSheet });
    const btn = screen.getByTestId("livesource-button");
    expect(btn.textContent).toContain("@maria_shops");
    expect(screen.queryByText("TIKTOK ACCOUNT")).toBeNull();
    fireEvent.click(btn);
    expect(onOpenSourceSheet).toHaveBeenCalledTimes(1);
  });
});
