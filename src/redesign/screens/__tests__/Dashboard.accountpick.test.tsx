// Account-pick UX contract: tapping an account row = SELECT only (fires onPickTT, does
// NOT toggle/close the dropdown, does NOT connect); the check (✓) renders on the ttIdx row;
// Connect fires onConnectTT. The "stays open on pick / closes on Connect" behavior lives in
// RedesignApp (switchAccount = select-only; doConnect closes) — here we assert the screen
// contract that makes it possible (pick never calls onToggle/onConnect).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Dashboard from "../Dashboard";
import { TProvider } from "../../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const noop = () => {};
const base = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop, onRefreshTT: noop, onRefreshFB: noop,
  ttAccounts: ["maria_shops", "grace_lim"], fbAccounts: ["fbpage_one", "fbpage_two"],
  sessionDays: 1, sessionOpen: false, onToggleSession: noop, onPickSession: noop,
  printed: {}, entId: null, entPrice: "", onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Partial<typeof base> = {}) =>
  render(<TProvider lang="en"><Dashboard {...base} {...over} /></TProvider>);
// Scope to the dropdown PANEL (parent of its header). The chip button also shows the
// selected account name, so a global getByText would be ambiguous — within(panel) excludes it.
const ttPanel = () => screen.getByText("TIKTOK ACCOUNT").parentElement as HTMLElement;
const fbPanel = () => screen.getByText("FACEBOOK PAGE / GROUP").parentElement as HTMLElement;
const rowIn = (panel: HTMLElement, name: string) => within(panel).getByText(name).closest("button") as HTMLButtonElement;

describe("Dashboard account pick = select-only (TikTok)", () => {
  it("tapping a row fires onPickTT(i) and does NOT toggle or connect", () => {
    const onPickTT = vi.fn(), onToggleTT = vi.fn(), onConnectTT = vi.fn();
    renderDash({ ttOpen: true, onPickTT, onToggleTT, onConnectTT });
    fireEvent.click(rowIn(ttPanel(), "grace_lim"));
    expect(onPickTT).toHaveBeenCalledWith(1);
    expect(onToggleTT).not.toHaveBeenCalled(); // dropdown not closed by a pick
    expect(onConnectTT).not.toHaveBeenCalled(); // pick never connects
    // rows still rendered (dropdown stays open — controlled by ttOpen, unchanged by a pick)
    expect(within(ttPanel()).getByText("maria_shops")).toBeTruthy();
    expect(within(ttPanel()).getByText("grace_lim")).toBeTruthy();
  });

  it("the check (✓) renders on the selected (ttIdx) row only", () => {
    renderDash({ ttOpen: true, ttIdx: 1 });
    expect(within(rowIn(ttPanel(), "grace_lim")).getByText("✓")).toBeTruthy();
    expect(within(rowIn(ttPanel(), "maria_shops")).queryByText("✓")).toBeNull();
  });

  it("Connect fires onConnectTT", () => {
    const onConnectTT = vi.fn();
    renderDash({ ttOpen: true, onConnectTT });
    fireEvent.click(screen.getByText("Connect"));
    expect(onConnectTT).toHaveBeenCalledTimes(1);
  });
});

describe("Dashboard account pick = select-only (Facebook)", () => {
  it("tapping a FB row fires onPickFB(i), no toggle/connect", () => {
    const onPickFB = vi.fn(), onToggleFB = vi.fn(), onConnectFB = vi.fn();
    renderDash({ fbOpen: true, onPickFB, onToggleFB, onConnectFB });
    fireEvent.click(rowIn(fbPanel(), "fbpage_two"));
    expect(onPickFB).toHaveBeenCalledWith(1);
    expect(onToggleFB).not.toHaveBeenCalled();
    expect(onConnectFB).not.toHaveBeenCalled();
  });

  it("FB check (✓) on selected row", () => {
    renderDash({ fbOpen: true, fbIdx: 1 });
    expect(within(rowIn(fbPanel(), "fbpage_two")).getByText("✓")).toBeTruthy();
    expect(within(rowIn(fbPanel(), "fbpage_one")).queryByText("✓")).toBeNull();
  });
});
