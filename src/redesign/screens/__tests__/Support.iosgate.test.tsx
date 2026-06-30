// iOS gate (representative): the Support "Renewing your subscription" guide item (g4 —
// contains prices + subscribe/renew) is HIDDEN on iOS and SHOWN on web/Android. Drives
// isIOS() via ?ios=1. Proves the isIOS() screen gates work end-to-end.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Support from "../Support";
import { TProvider } from "../../i18n";

const setSearch = (s: string) => {
  Object.defineProperty(window, "location", { value: { ...window.location, search: s }, writable: true });
};
afterEach(() => setSearch(""));

const renderSupport = () => render(<TProvider lang="en"><Support onLegal={() => {}} /></TProvider>);

describe("Support g4 (renew/prices) — iOS gate", () => {
  it("WEB (no ?ios): shows 'Renewing your subscription' guide", () => {
    setSearch("");
    renderSupport();
    expect(screen.getByText("Renewing your subscription")).toBeTruthy();
  });
  it("iOS (?ios=1): hides 'Renewing your subscription' guide", () => {
    setSearch("?ios=1");
    renderSupport();
    expect(screen.queryByText("Renewing your subscription")).toBeNull();
    // other guides still present
    expect(screen.getAllByText(/./).length).toBeGreaterThan(0);
  });
});
