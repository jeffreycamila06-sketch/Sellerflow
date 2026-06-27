// Surface B — Dashboard channel chip dropdown footer: Refresh + Connect/Disconnect/
// Connecting (3-state). Verifies the footer buttons render per state and call the
// handlers. (The real connect/disconnect wiring lives in RedesignApp; here we assert
// the chip UI contract.)
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Dashboard from "../Dashboard";
import { TProvider } from "../../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const noop = () => {};
const base = {
  comments: [], cur: "NT$",
  ttOpen: true, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop, onRefreshTT: noop, onRefreshFB: noop,
  ttAccounts: ["maria_shops"], fbAccounts: [] as string[],
  sessionDays: 1, sessionOpen: false, onToggleSession: noop, onPickSession: noop,
  printed: {}, entId: null, entPrice: "", onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Partial<typeof base> = {}) =>
  render(<TProvider lang="en"><Dashboard {...base} {...over} /></TProvider>);

describe("Dashboard channel chip footer (surface B)", () => {
  it("not connected → Refresh + Connect; handlers fire", () => {
    const onRefreshTT = vi.fn(), onConnectTT = vi.fn();
    renderDash({ onRefreshTT, onConnectTT });
    fireEvent.click(screen.getByText("Refresh"));
    fireEvent.click(screen.getByText("Connect"));
    expect(onRefreshTT).toHaveBeenCalledTimes(1);
    expect(onConnectTT).toHaveBeenCalledTimes(1);
  });
  it("connecting → button shows 'Connecting…'", () => {
    renderDash({ ttConnecting: true });
    expect(screen.getByText("Connecting…")).toBeTruthy();
  });
  it("connected → button flips to 'Disconnect' (Refresh still present)", () => {
    renderDash({ ttConnected: true });
    expect(screen.getByText("Disconnect")).toBeTruthy();
    expect(screen.getByText("Refresh")).toBeTruthy();
  });
  it("refreshing → Refresh button shows 'Refreshing…' and is disabled", () => {
    renderDash({ refreshing: true });
    const btn = screen.getByText("Refreshing…").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
