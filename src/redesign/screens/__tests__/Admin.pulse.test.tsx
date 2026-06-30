// Business Pulse is WEB-ONLY: the "Live Pulse" control tile shows in a web browser
// (no Capacitor, no ?apk) and is HIDDEN in the app shell (Capacitor present →
// phone/APK/iOS). Drives isAppShell() via window.Capacitor.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Admin from "../Admin";
import { TProvider } from "../../i18n";

const setSearch = (s: string) => {
  Object.defineProperty(window, "location", { value: { ...window.location, search: s }, writable: true });
};
afterEach(() => {
  setSearch("");
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

const renderAdmin = () =>
  render(
    <TProvider lang="en">
      <Admin onOpenPanel={() => {}} cur="NT$" />
    </TProvider>,
  );

describe("Admin — Business Pulse web-only gate", () => {
  it("WEB (no Capacitor, no ?apk): shows the Live Pulse tile", () => {
    setSearch("");
    renderAdmin();
    expect(screen.getByText("Live Pulse")).toBeTruthy();
  });
  it("APK / phone shell (window.Capacitor present): hides the Live Pulse tile", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "android" };
    renderAdmin();
    expect(screen.queryByText("Live Pulse")).toBeNull();
    // the rest of the admin home still renders (User Base tile is platform-agnostic)
    expect(screen.getByText("User Base")).toBeTruthy();
  });
  it("iOS shell (Capacitor ios): also hides the Live Pulse tile", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "ios" };
    renderAdmin();
    expect(screen.queryByText("Live Pulse")).toBeNull();
  });
});
