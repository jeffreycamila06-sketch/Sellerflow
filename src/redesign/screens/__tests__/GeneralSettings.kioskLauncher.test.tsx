// "Copy kiosk command" button in the "Laptop auto-print setup" card: visible for
// admin + the allowlisted email, hidden for other users, the whole card web-only
// (absent in the app shell), and the copy writes the exact Windows command.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import { KIOSK_COMMAND_WINDOWS } from "../../adapters/kioskLauncher";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

// Control isAppShell per test (default web = false).
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
const CARD = "Silent auto-print on a laptop";

describe("GeneralSettings — copy kiosk command", () => {
  beforeEach(() => { shell.v = false; localStorage.clear(); });

  it("web + admin → button visible", () => {
    renderGS(acct({ role: "admin" }));
    expect(screen.getByText(CARD)).toBeTruthy();
    expect(screen.getByText(BTN)).toBeTruthy();
  });

  it("web + allowlisted email (googletest@gmail.com) → button visible", () => {
    renderGS(acct({ email: "googletest@gmail.com" }));
    expect(screen.getByText(BTN)).toBeTruthy();
  });

  it("web + ordinary seller → card shows but NO button", () => {
    renderGS(acct());
    expect(screen.getByText(CARD)).toBeTruthy(); // card renders as-is
    expect(screen.queryByText(BTN)).toBeNull();  // no copy button
  });

  it("app shell → the whole laptop-print card (and button) is absent", () => {
    shell.v = true;
    renderGS(acct({ role: "admin" }));
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
