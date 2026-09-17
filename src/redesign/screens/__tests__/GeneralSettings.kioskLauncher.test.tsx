// "Laptop auto-print" card in GeneralSettings. The WHOLE card (label, steps,
// command + Copy button, Mac note) is gated on canSeeKioskLauncher — admins +
// KIOSK_LAUNCHER_EMAILS ONLY. Not eligible → NO card at all, on BOTH web and phone
// (the old web-only !isAppShell gate is gone: visibility is account-only now).
// Copy still writes the exact Windows command.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import { KIOSK_COMMAND_WINDOWS } from "../../adapters/kioskLauncher";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

// The card no longer reads isAppShell (visibility is account-only). This mock lets
// us prove the phone shell makes NO difference to the gate — eligible users see it
// on phone too, and a regression that re-added a web-only gate would fail below.
const shell = { v: false };
vi.mock("../../adapters/appShell", async (orig) => ({ ...(await (orig() as Promise<object>)), isAppShell: () => shell.v }));

const auto: AutoControls = { detect: false, setupOpen: false, toggle: () => {}, toggleSetup: () => {} };
const acct = (over: Partial<AccountUser> = {}): AccountUser => ({
  authUserId: "u1", email: "seller@example.com",
  profile: { fullName: "S", storeName: "Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller", ...over,
});
const noop = () => {};
const renderGS = (account: AccountUser | null) => render(
  <TProvider lang="en">
    <GeneralSettings
      theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
      auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop}
      printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop}
      account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
    />
  </TProvider>,
);
const BTN = "Copy kiosk command";
const CARD = "Silent auto-print on a laptop"; // rd_wp_setup_title — unique card marker

describe("GeneralSettings — laptop auto-print card (admin + allowlist only)", () => {
  beforeEach(() => { shell.v = false; localStorage.clear(); });

  it("web + admin → whole card + Copy button visible", () => {
    renderGS(acct({ role: "admin" }));
    expect(screen.getByText(CARD)).toBeTruthy();
    expect(screen.getByText(BTN)).toBeTruthy();
  });

  it("web + allowlisted email (googletest@gmail.com) → whole card + button visible", () => {
    renderGS(acct({ email: "googletest@gmail.com" }));
    expect(screen.getByText(CARD)).toBeTruthy();
    expect(screen.getByText(BTN)).toBeTruthy();
  });

  it("web + ordinary seller → NO card at all (no label, no steps, no button)", () => {
    renderGS(acct());
    expect(screen.queryByText(CARD)).toBeNull();
    expect(screen.queryByText(BTN)).toBeNull();
  });

  it("phone (app shell) + ordinary seller → still NO card", () => {
    shell.v = true;
    renderGS(acct());
    expect(screen.queryByText(CARD)).toBeNull();
    expect(screen.queryByText(BTN)).toBeNull();
  });

  it("phone (app shell) + admin → card VISIBLE (no longer web-only)", () => {
    shell.v = true;
    renderGS(acct({ role: "admin" }));
    expect(screen.getByText(CARD)).toBeTruthy();
    expect(screen.getByText(BTN)).toBeTruthy();
  });

  it("phone (app shell) + allowlisted email → card VISIBLE", () => {
    shell.v = true;
    renderGS(acct({ email: "googletest@gmail.com" }));
    expect(screen.getByText(CARD)).toBeTruthy();
  });

  it("logged-out (null account) → NO card", () => {
    renderGS(null);
    expect(screen.queryByText(CARD)).toBeNull();
    expect(screen.queryByText(BTN)).toBeNull();
  });

  it("clicking Copy writes the exact Windows command to the clipboard + shows 'Copied ✓'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderGS(acct({ role: "admin" }));
    fireEvent.click(screen.getByText(BTN));
    expect(writeText).toHaveBeenCalledWith(KIOSK_COMMAND_WINDOWS);
    expect(await screen.findByText("Copied ✓")).toBeTruthy();
  });

  it("the read-only command input is present as the manual-copy fallback", () => {
    renderGS(acct({ role: "admin" }));
    const input = screen.getByLabelText("Kiosk command") as HTMLInputElement;
    expect(input.value).toBe(KIOSK_COMMAND_WINDOWS);
    expect(input.readOnly).toBe(true);
  });
});
