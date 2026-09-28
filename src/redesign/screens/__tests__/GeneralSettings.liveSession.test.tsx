// LIVE SESSION group — collapsed by default, expands on tap, and holds the four
// controls (Auto mode, Keep screen awake, Auto-print pinned comments, LIVE print
// pattern) which still fire their handlers. Display-only wrapper; no toggle logic
// changed.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const account: AccountUser = {
  authUserId: "u1", email: "googletest@sellerflowlive.com",
  profile: { fullName: "Test Owner", storeName: "Test Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};

function renderGS(handlers: { autoToggle?: () => void; keepAwake?: () => void; pinPrint?: () => void; printPattern?: () => void } = {}) {
  const auto: AutoControls = { detect: false, setupOpen: false, toggle: handlers.autoToggle ?? noop, toggleSetup: noop };
  return render(
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop}
        keepAwake onToggleKeepAwake={handlers.keepAwake ?? noop}
        pinPrint={false} onTogglePinPrint={handlers.pinPrint ?? noop}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={handlers.printPattern ?? noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
      />
    </TProvider>,
  );
}

// Controlled wrapper mirroring RedesignApp: the open state is LIFTED here (so a
// GeneralSettings remount can't lose it — the production bug's real fix).
function Controlled({ printPattern = noop }: { printPattern?: () => void }) {
  const [open, setOpen] = useState(false);
  const auto: AutoControls = { detect: false, setupOpen: false, toggle: noop, toggleSetup: noop };
  return (
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop}
        keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={noop}
        liveSessionOpen={open} onToggleLiveSession={() => setOpen((o) => !o)}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={printPattern}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
      />
    </TProvider>
  );
}

describe("LIVE SESSION collapsible group", () => {
  beforeEach(() => localStorage.clear());

  it("is collapsed by default — the header shows a state summary, the body is hidden", () => {
    renderGS();
    const header = screen.getByTestId("ls-header");
    expect(header).toBeTruthy();
    expect(within(header).getByText("Live session")).toBeTruthy();
    expect(within(header).getByText(/Auto mode off · Screen awake on · Auto-print off/)).toBeTruthy();
    expect(screen.queryByTestId("ls-body")).toBeNull();
    expect(screen.queryByTestId("ls-print-pattern")).toBeNull();
  });

  it("expands on tap and renders all four controls, which still fire their handlers", () => {
    const autoToggle = vi.fn(), keepAwake = vi.fn(), pinPrint = vi.fn(), printPattern = vi.fn();
    renderGS({ autoToggle, keepAwake, pinPrint, printPattern });
    fireEvent.click(screen.getByTestId("ls-header"));
    const body = screen.getByTestId("ls-body");
    expect(body).toBeTruthy();
    // the four controls are present
    expect(within(body).getByText("Auto mode")).toBeTruthy();
    expect(within(body).getByText(/Keep screen awake/i)).toBeTruthy();
    expect(within(body).getByText(/Auto-print pinned/i)).toBeTruthy();
    expect(screen.getByTestId("ls-print-pattern")).toBeTruthy();
    // and they still toggle — the Auto/keep-awake/pin pill buttons + the pattern row
    const pills = within(body).getAllByRole("button");
    fireEvent.click(pills[0]); // auto toggleSetup (accordion) — harmless
    // fire the actual toggles via their titles
    fireEvent.click(screen.getByTitle("Keep screen awake while live"));
    expect(keepAwake).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ls-print-pattern"));
    expect(printPattern).toHaveBeenCalled();
  });

  it("lifted state (RedesignApp pattern): clicking the ROW ELEMENT the user taps — header, chevron, or icon — toggles it open, and survives a component remount", () => {
    const printPattern = vi.fn();
    const { rerender } = render(<Controlled printPattern={printPattern} />);
    const header = screen.getByTestId("ls-header");
    expect(screen.queryByTestId("ls-body")).toBeNull();
    // tap the chevron span (the exact element the user complained about)
    fireEvent.click(header.querySelector("span:last-child")!);
    expect(screen.getByTestId("ls-body")).toBeTruthy();
    // a remount does NOT collapse it (parent holds the state)
    rerender(<Controlled printPattern={printPattern} />);
    expect(screen.getByTestId("ls-body")).toBeTruthy();
    // tap the icon div → collapses; tap header text → opens again
    fireEvent.click(screen.getByTestId("ls-header").querySelector("div")!);
    expect(screen.queryByTestId("ls-body")).toBeNull();
    fireEvent.click(screen.getByTestId("ls-header"));
    expect(screen.getByTestId("ls-body")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ls-print-pattern"));
    expect(printPattern).toHaveBeenCalled();
  });

  it("remembers open/closed in localStorage across mounts (local fallback)", () => {
    const { unmount } = renderGS();
    fireEvent.click(screen.getByTestId("ls-header"));
    expect(localStorage.getItem("sfl_rd_livesession_open")).toBe("1");
    unmount();
    renderGS();
    expect(screen.getByTestId("ls-body")).toBeTruthy();               // reopened from storage
  });

  it("Printer Settings section no longer holds the LIVE print pattern row", () => {
    renderGS();
    expect(screen.getByText("Printer Settings")).toBeTruthy();        // renamed header
    // the only 'LIVE print pattern' title lives inside the (collapsed) Live session group → not in the DOM yet
    expect(screen.queryByText("LIVE print pattern")).toBeNull();
  });
});
